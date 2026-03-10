/**
 * SyncAudioManager — Manages loading and synchronized playback of master audio + silent stems.
 * 
 * The master track plays through speakers.
 * Each stem is loaded, muted, and tightly synced to the master's clock.
 */
import { EnergyAnalyzer } from './energy-analyzer.js';

export class SyncAudioManager {
    constructor() {
        this.ctx = null;
        /** @type {HTMLAudioElement|null} */
        this.masterAudio = null;
        this.masterSource = null;

        /** @type {Map<string, StemEntry>} */
        this.stems = new Map();

        this.isPlaying = false;
    }

    /**
     * Initialize AudioContext (must be called after user gesture)
     */
    _init() {
        if (this.ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
    }

    /**
     * Load master audio (the track that plays audibly)
     */
    loadMaster(source) {
        this._init();

        if (this.masterSource) {
            try { this.masterSource.disconnect(); } catch (e) { /* */ }
        }
        if (this.masterAudio) {
            this.masterAudio.pause();
            this.masterAudio.removeEventListener('timeupdate', this._onMasterTimeUpdate);
            this.masterAudio.removeEventListener('seeking', this._onMasterSeeking);
        }

        const url = source instanceof File || source instanceof Blob ? URL.createObjectURL(source) : source;
        this.masterAudio = new Audio(url);

        if (source instanceof File || source instanceof Blob) {
            this.masterAudio.addEventListener('loadeddata', () => URL.revokeObjectURL(url), { once: true });
        }

        this.masterAudio.crossOrigin = 'anonymous';
        this.masterSource = this.ctx.createMediaElementSource(this.masterAudio);
        this.masterSource.connect(this.ctx.destination); // Audible!

        // Hook up sync events
        this._onMasterTimeUpdate = this._onMasterTimeUpdate.bind(this);
        this._onMasterSeeking = this._onMasterSeeking.bind(this);
        this.masterAudio.addEventListener('timeupdate', this._onMasterTimeUpdate);
        this.masterAudio.addEventListener('seeking', this._onMasterSeeking);
    }

    /**
     * Add a stem track for silent tracking
     * @param {string} name - Stem identifier
     * @param {string|File|Blob} source - Audio source
     * @param {object} [options] - Options
     * @param {number} [options.noiseFloor=0.08] - RMS noise gate threshold (0.0 to 1.0). Signals below this are treated as silence.
     */
    addStem(name, source, options = {}) {
        this._init();

        if (this.stems.has(name)) this.removeStem(name);

        const url = source instanceof File || source instanceof Blob ? URL.createObjectURL(source) : source;
        const audio = new Audio(url);

        if (source instanceof File || source instanceof Blob) {
            audio.addEventListener('loadeddata', () => URL.revokeObjectURL(url), { once: true });
        }

        audio.crossOrigin = 'anonymous';
        audio.preload = 'metadata';
        // Note: Do NOT set audio.muted = true or audio.volume = 0 here.
        // In Chrome/Edge, doing so will output silence to the MediaElementAudioSourceNode.
        // The stem is already silenced by the silentGain node below this.

        const mediaSource = this.ctx.createMediaElementSource(audio);
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512; // Fast response for global volume
        // Lower smoothing = faster response to silence. 0.3 prevents ghost energy
        // from lingering between frames. We also do our own smoothing in EnergyAnalyzer.
        analyser.smoothingTimeConstant = 0.3;

        mediaSource.connect(analyser); // Connect to analyser
        // Do NOT connect analyser to destination

        // Hack for some browsers to keep analyzing muted invisible tabs
        const silentGain = this.ctx.createGain();
        silentGain.gain.value = 0;
        analyser.connect(silentGain);
        silentGain.connect(this.ctx.destination);

        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const energyAnalyzer = new EnergyAnalyzer({ noiseFloor: options.noiseFloor });

        this.stems.set(name, {
            name,
            audio,
            mediaSource,
            analyser,
            silentGain,
            frequencyData,
            energyAnalyzer,
            currentValue: 0
        });
    }

    removeStem(name) {
        const stem = this.stems.get(name);
        if (!stem) return;
        stem.audio.pause();
        try { stem.mediaSource.disconnect(); } catch (e) { /* */ }
        try { stem.analyser.disconnect(); } catch (e) { /* */ }
        try { stem.silentGain.disconnect(); } catch (e) { /* */ }
        this.stems.delete(name);
    }

    /**
     * Update all stem analyzers and handle drift correction
     */
    update() {
        const results = new Map();

        // Continuous Drift Correction during the loop
        if (this.isPlaying && this.masterAudio && !this.masterAudio.seeking) {
            const masterTime = this.masterAudio.currentTime;

            for (const [name, stem] of this.stems) {
                // If a stem drifts more than 50ms from master, force sync it
                if (Math.abs(stem.audio.currentTime - masterTime) > 0.05) {
                    stem.audio.currentTime = masterTime;
                }
            }
        }

        for (const [name, stem] of this.stems) {
            stem.analyser.getByteFrequencyData(stem.frequencyData);
            const value = stem.energyAnalyzer.analyze(stem.frequencyData);
            const bands = stem.energyAnalyzer.bands;
            stem.currentValue = value;
            stem.currentBands = bands;
            results.set(name, { value, bands });
        }

        return results;
    }

    async play() {
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        const promises = [];

        // Ensure stems are at the right master time before playing
        if (this.masterAudio) {
            this._syncStemsToMaster();
            promises.push(this.masterAudio.play());
        }

        for (const [, stem] of this.stems) {
            promises.push(stem.audio.play().catch(e => {
                console.warn(`SonicMotion: Could not play stem '${stem.name}'`, e);
            }));
        }

        try {
            await Promise.allSettled(promises);
            this.isPlaying = true;
        } catch (e) {
            console.error("SonicMotion: Playback error", e);
        }
    }

    pause() {
        if (this.masterAudio) this.masterAudio.pause();
        for (const [, stem] of this.stems) {
            stem.audio.pause();
        }
        this.isPlaying = false;
    }

    seek(time) {
        if (this.masterAudio) {
            this.masterAudio.currentTime = time;
            // The seeking event listener will handle the stems
        }
    }

    stop() {
        this.pause();
        this.seek(0);
        for (const [, stem] of this.stems) {
            stem.energyAnalyzer.reset();
        }
    }

    // --- Synchronization Handlers ---

    _onMasterTimeUpdate() {
        // Just keep the clock steady
    }

    _onMasterSeeking() {
        // When user explicitly drags the tracker or seeks
        this._syncStemsToMaster();
    }

    _syncStemsToMaster() {
        if (!this.masterAudio) return;
        const targetTime = this.masterAudio.currentTime;
        for (const [, stem] of this.stems) {
            stem.audio.currentTime = targetTime;
        }
    }

    // --- Getters ---

    get duration() { return this.masterAudio ? this.masterAudio.duration || 0 : 0; }
    get currentTime() { return this.masterAudio ? this.masterAudio.currentTime || 0 : 0; }
    getStemNames() { return Array.from(this.stems.keys()); }

    destroy() {
        this.stop();
        if (this.masterAudio) {
            this.masterAudio.removeEventListener('timeupdate', this._onMasterTimeUpdate);
            this.masterAudio.removeEventListener('seeking', this._onMasterSeeking);
        }
        if (this.masterSource) try { this.masterSource.disconnect(); } catch (e) { /* */ }
        for (const [name] of this.stems) this.removeStem(name);
        if (this.ctx) this.ctx.close();
        this.ctx = null;
        this.masterAudio = null;
    }
}
