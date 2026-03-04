/**
 * StemManager — Manages loading and playback of master audio + silent stem analysis.
 * 
 * The master track plays through speakers.
 * Each stem is loaded, muted, and only analyzed for energy levels.
 */
import { EnergyAnalyzer } from './energy-analyzer.js';

export class StemManager {
    constructor() {
        this.ctx = null;
        /** @type {HTMLAudioElement|null} */
        this.masterAudio = null;
        this.masterSource = null;

        /** @type {Map<string, StemEntry>} */
        this.stems = new Map();

        this.isPlaying = false;
        this._frequencyBuffers = new Map();
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
     * @param {string|File|Blob} source - URL or File
     */
    loadMaster(source) {
        this._init();

        // Clean previous master
        if (this.masterSource) {
            try { this.masterSource.disconnect(); } catch (e) { /* */ }
        }
        if (this.masterAudio) {
            this.masterAudio.pause();
        }

        if (source instanceof File || source instanceof Blob) {
            const url = URL.createObjectURL(source);
            this.masterAudio = new Audio(url);
            this.masterAudio.addEventListener('loadeddata', () => URL.revokeObjectURL(url), { once: true });
        } else if (typeof source === 'string') {
            this.masterAudio = new Audio(source);
        }

        this.masterAudio.crossOrigin = 'anonymous';
        this.masterSource = this.ctx.createMediaElementSource(this.masterAudio);
        // Master connects to destination → it's audible
        this.masterSource.connect(this.ctx.destination);
    }

    /**
     * Add a stem for silent analysis
     * @param {string} name - Stem name (e.g. 'kick', 'vocals', 'bass')
     * @param {string|File|Blob} source - URL or File
     */
    addStem(name, source) {
        this._init();

        // Clean previous stem with same name
        if (this.stems.has(name)) {
            this.removeStem(name);
        }

        let audio;
        if (source instanceof File || source instanceof Blob) {
            const url = URL.createObjectURL(source);
            audio = new Audio(url);
            audio.addEventListener('loadeddata', () => URL.revokeObjectURL(url), { once: true });
        } else if (typeof source === 'string') {
            audio = new Audio(source);
        }

        audio.crossOrigin = 'anonymous';
        // IMPORTANT: Stem audio is muted — we don't want to hear it
        audio.muted = true;
        audio.volume = 0;

        const mediaSource = this.ctx.createMediaElementSource(audio);
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 1024; // Smaller FFT for performance (stems don't need high resolution)
        analyser.smoothingTimeConstant = 0.7;

        // Connect: source → analyser → (nowhere, not to destination!)
        // The analyser can read data without the audio going to speakers
        mediaSource.connect(analyser);
        // We need to connect to a silent gain node to keep the audio processing alive
        const silentGain = this.ctx.createGain();
        silentGain.gain.value = 0;
        analyser.connect(silentGain);
        silentGain.connect(this.ctx.destination);

        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const energyAnalyzer = new EnergyAnalyzer();

        this.stems.set(name, {
            name,
            audio,
            mediaSource,
            analyser,
            silentGain,
            frequencyData,
            energyAnalyzer,
            currentValue: 0,
            currentBeat: { isBeat: false, beatIntensity: 0, bpm: 0 }
        });
    }

    /**
     * Remove a stem
     * @param {string} name
     */
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
     * Load a folder of files. Detects master + stems by filename.
     * Files named "master.*" become the master track.
     * All other audio files become stems named by their filename (without extension).
     * @param {FileList|File[]} files
     */
    loadFolder(files) {
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'webm', 'm4a'];
        let masterFile = null;
        const stemFiles = [];

        for (const file of files) {
            // Check if it's an audio file
            const ext = file.name.split('.').pop().toLowerCase();
            if (!audioExts.includes(ext) && !file.type.startsWith('audio/')) continue;

            const baseName = file.name.replace(/\.[^.]+$/, '').toLowerCase();

            if (baseName === 'master' || baseName === 'original' || baseName === 'full') {
                masterFile = file;
            } else {
                stemFiles.push({ name: baseName, file });
            }
        }

        if (!masterFile) {
            console.warn('SonicMotion: No master file found. Name your complete track "master.mp3" (or "original"/"full").');
            // If no master found, use the first file as master
            if (stemFiles.length > 0) {
                const first = stemFiles.shift();
                masterFile = first.file;
                console.warn(`SonicMotion: Using "${first.name}" as master track.`);
            }
        }

        if (masterFile) {
            this.loadMaster(masterFile);
        }

        for (const { name, file } of stemFiles) {
            this.addStem(name, file);
        }

        return {
            master: masterFile ? masterFile.name : null,
            stems: stemFiles.map(s => s.name)
        };
    }

    /**
     * Update all stem analyzers (call every frame)
     * @returns {Map<string, { value: number, isBeat: boolean, beatIntensity: number, bpm: number }>}
     */
    update() {
        const results = new Map();

        for (const [name, stem] of this.stems) {
            stem.analyser.getByteFrequencyData(stem.frequencyData);
            const result = stem.energyAnalyzer.analyze(stem.frequencyData);
            stem.currentValue = result.value;
            stem.currentBeat = result;
            results.set(name, result);
        }

        return results;
    }

    /**
     * Get the current energy value for a specific stem
     * @param {string} name
     * @returns {number} 0-1
     */
    getValue(name) {
        const stem = this.stems.get(name);
        return stem ? stem.currentValue : 0;
    }

    /**
     * Get all stem names
     * @returns {string[]}
     */
    getStemNames() {
        return Array.from(this.stems.keys());
    }

    /**
     * Register a beat callback for a specific stem
     * @param {string} stemName
     * @param {Function} callback
     * @returns {Function} unsubscribe
     */
    onBeat(stemName, callback) {
        const stem = this.stems.get(stemName);
        if (!stem) {
            console.warn(`SonicMotion: Stem "${stemName}" not found.`);
            return () => { };
        }
        return stem.energyAnalyzer.onBeat(callback);
    }

    /**
     * Play master + all stems (synchronized)
     */
    play() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const playPromises = [];

        if (this.masterAudio) {
            playPromises.push(this.masterAudio.play());
        }

        // Play all stems silently (they need to play for the analyser to work)
        for (const [, stem] of this.stems) {
            stem.audio.muted = true;
            stem.audio.volume = 0;
            playPromises.push(stem.audio.play());
        }

        // Synchronize: once master starts, sync all stems to master time
        if (this.masterAudio) {
            Promise.all(playPromises).then(() => {
                this._syncStems();
            }).catch(e => {
                console.warn('SonicMotion: Play error', e);
            });
        }

        this.isPlaying = true;
    }

    /**
     * Pause all
     */
    pause() {
        if (this.masterAudio) this.masterAudio.pause();
        for (const [, stem] of this.stems) {
            stem.audio.pause();
        }
        this.isPlaying = false;
    }

    /**
     * Stop all (reset to beginning)
     */
    stop() {
        this.pause();
        if (this.masterAudio) this.masterAudio.currentTime = 0;
        for (const [, stem] of this.stems) {
            stem.audio.currentTime = 0;
            stem.energyAnalyzer.reset();
        }
    }

    /**
     * Sync all stems to master's current time
     */
    _syncStems() {
        if (!this.masterAudio) return;
        const masterTime = this.masterAudio.currentTime;
        for (const [, stem] of this.stems) {
            if (Math.abs(stem.audio.currentTime - masterTime) > 0.1) {
                stem.audio.currentTime = masterTime;
            }
        }
    }

    /**
     * Seek to a specific time
     * @param {number} time - Time in seconds
     */
    seek(time) {
        if (this.masterAudio) this.masterAudio.currentTime = time;
        for (const [, stem] of this.stems) {
            stem.audio.currentTime = time;
        }
    }

    /**
     * Get master audio duration
     */
    get duration() {
        return this.masterAudio ? this.masterAudio.duration || 0 : 0;
    }

    /**
     * Get master audio current time
     */
    get currentTime() {
        return this.masterAudio ? this.masterAudio.currentTime || 0 : 0;
    }

    /**
     * Destroy everything
     */
    destroy() {
        this.stop();
        if (this.masterSource) {
            try { this.masterSource.disconnect(); } catch (e) { /* */ }
        }
        for (const [name] of this.stems) {
            this.removeStem(name);
        }
        if (this.ctx) {
            this.ctx.close();
        }
        this.ctx = null;
        this.masterAudio = null;
        this.masterSource = null;
        this.stems.clear();
    }
}
