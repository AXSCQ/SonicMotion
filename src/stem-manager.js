/**
 * SyncAudioManager — Manages loading and synchronized playback of master audio + silent stems.
 * 
 * The master track plays through speakers.
 * Each stem is loaded, muted, and tightly synced to the master's clock.
 */
import { EnergyAnalyzer } from './energy-analyzer.js';

/**
 * The per-frame data of one stem, in the same shape everywhere
 * (onFrame, getValue, the effects loop).
 * @param {EnergyAnalyzer} ea
 */
export function stemData(ea) {
    return { value: ea.value, level: ea.level, onset: ea.onset, bands: ea.bands, trend: ea.trend };
}

/** Data of a stem at rest (before the first frame, or after pause). */
export const SILENT_STEM = Object.freeze({
    value: 0, level: -Infinity, onset: 0,
    bands: { bass: { value: 0, punch: 0, onset: 0 }, mid: { value: 0, punch: 0, onset: 0 }, treble: { value: 0, punch: 0, onset: 0 } },
    trend: { fast: 0, slow: 0, rising: 0, drop: 0 },
});

export class SyncAudioManager {
    constructor() {
        this.ctx = null;
        /** @type {HTMLAudioElement|null} */
        this.masterAudio = null;
        this.masterSource = null;

        /** @type {Map<string, StemEntry>} */
        this.stems = new Map();

        this.isPlaying = false;
        this._volume = 1.0;

        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
    }

    // ---- Event Emitter ----

    on(event, callback) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(callback);
        return () => this._listeners.get(event)?.delete(callback);
    }

    _emit(event, data) {
        const cbs = this._listeners.get(event);
        if (cbs) for (const cb of cbs) { try { cb(data); } catch (e) { /* */ } }
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
        this.masterAudio.volume = this._volume;
        this.masterSource = this.ctx.createMediaElementSource(this.masterAudio);
        this.masterSource.connect(this.ctx.destination); // Audible!

        // Hook up sync events
        this._onMasterTimeUpdate = this._onMasterTimeUpdate.bind(this);
        this._onMasterSeeking = this._onMasterSeeking.bind(this);
        this._onMasterEnded = () => {
            this.isPlaying = false;
            this._emit('ended');
        };
        this.masterAudio.addEventListener('timeupdate', this._onMasterTimeUpdate);
        this.masterAudio.addEventListener('seeking', this._onMasterSeeking);
        this.masterAudio.addEventListener('ended', this._onMasterEnded);
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
        // 'auto': a stem that only loaded its metadata starts late when play()
        // is called and has to be re-seeked to catch up with the master.
        audio.preload = 'auto';
        // Note: Do NOT set audio.muted = true or audio.volume = 0 here.
        // In Chrome/Edge, doing so will output silence to the MediaElementAudioSourceNode.
        // The stem is already silenced by the silentGain node below this.

        const mediaSource = this.ctx.createMediaElementSource(audio);
        const analyser = this.ctx.createAnalyser();
        // 2048 bins → ~23 Hz per bin at 48 kHz: enough resolution for a real
        // 20–250 Hz bass band. The level is measured on the latest ~20 ms of
        // samples, so the bigger FFT does not slow the energy down.
        analyser.fftSize = 2048;
        // No smoothing from the browser: EnergyAnalyzer smooths in time and
        // needs the raw spectrum for onset detection.
        analyser.smoothingTimeConstant = 0;

        mediaSource.connect(analyser); // Connect to analyser
        // Do NOT connect analyser to destination

        // Hack for some browsers to keep analyzing muted invisible tabs
        const silentGain = this.ctx.createGain();
        silentGain.gain.value = 0;
        analyser.connect(silentGain);
        silentGain.connect(this.ctx.destination);

        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const energyAnalyzer = new EnergyAnalyzer({
            noiseFloor: options.noiseFloor,
            gateDb: options.gateDb,
            minOnsetGapMs: options.minOnsetGapMs,
            onsetThreshold: options.onsetThreshold,
        });

        this.stems.set(name, {
            name,
            audio,
            mediaSource,
            analyser,
            silentGain,
            frequencyData,
            timeData: new Float32Array(analyser.fftSize),
            freqDb: new Float32Array(analyser.frequencyBinCount),
            energyAnalyzer,
            currentValue: 0,
            volume: 0
        });
    }

    /**
     * Set an individual stem's audible volume (0.0 to 1.0).
     * By default stems are silent (analysis-only) and the master track carries
     * the audio. Raising a stem's volume routes its signal to the speakers,
     * enabling true per-stem mixing. Combine with setVolume(0) on the master
     * so the audible mix comes exclusively from the stems (the muted master
     * keeps acting as the sync clock).
     */
    setStemVolume(name, vol) {
        const stem = this.stems.get(name);
        if (!stem) return false;
        const v = Math.max(0, Math.min(1, Number(vol) || 0));
        stem.silentGain.gain.value = v;
        stem.volume = v;
        return true;
    }

    getStemVolume(name) {
        const stem = this.stems.get(name);
        return stem ? stem.volume : null;
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
                // If a stem drifts from master, force sync it. Silent
                // (analysis-only) stems can be re-seeked aggressively; an
                // audible stem (per-stem mixing) gets a wider tolerance,
                // since every seek is heard as a click/stutter.
                const tolerance = stem.volume > 0 ? 0.25 : 0.05;
                if (Math.abs(stem.audio.currentTime - masterTime) > tolerance) {
                    stem.audio.currentTime = masterTime;
                }
            }
        }

        const nowMs = performance.now();
        const sampleRate = this.ctx ? this.ctx.sampleRate : 48000;
        for (const [name, stem] of this.stems) {
            const ea = stem.energyAnalyzer;
            if (this.isPlaying) {
                stem.analyser.getFloatTimeDomainData(stem.timeData);
                stem.analyser.getFloatFrequencyData(stem.freqDb);
                // byte spectrum kept for getSpectrum() (visualizers)
                stem.analyser.getByteFrequencyData(stem.frequencyData);
                ea.analyze({ timeData: stem.timeData, freqDb: stem.freqDb, sampleRate, nowMs });
            } else {
                ea.idle(nowMs);
            }
            const data = stemData(ea);
            stem.currentValue = data.value;
            stem.currentBands = data.bands;
            stem.currentTrend = data.trend;
            stem.currentData = data;
            results.set(name, data);
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
            this._emit('play');
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
        this._emit('pause');
    }

    seek(time) {
        if (this.masterAudio) {
            this.masterAudio.currentTime = time;
            this._emit('seek', time);
        }
    }

    /**
     * Seek by percentage (0.0 to 1.0)
     */
    seekPercent(pct) {
        if (this.masterAudio && this.masterAudio.duration) {
            this.seek(pct * this.masterAudio.duration);
        }
    }

    stop() {
        this.pause();
        this.seek(0);
        for (const [, stem] of this.stems) {
            stem.energyAnalyzer.reset();
        }
        this._emit('stop');
    }

    /**
     * Set master volume (0.0 to 1.0)
     */
    setVolume(vol) {
        const v = Number(vol);
        this._volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
        if (this.masterAudio) this.masterAudio.volume = this._volume;
    }

    getVolume() {
        return this._volume;
    }

    // --- Synchronization Handlers ---

    _onMasterTimeUpdate() {
        this._emit('timeupdate', {
            currentTime: this.masterAudio?.currentTime || 0,
            duration: this.masterAudio?.duration || 0
        });
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
            this.masterAudio.removeEventListener('ended', this._onMasterEnded);
        }
        if (this.masterSource) try { this.masterSource.disconnect(); } catch (e) { /* */ }
        for (const [name] of this.stems) this.removeStem(name);
        if (this.ctx) this.ctx.close();
        this._listeners.clear();
        this.ctx = null;
        this.masterAudio = null;
    }
}
