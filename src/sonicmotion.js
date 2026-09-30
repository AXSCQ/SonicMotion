/**
 * SonicMotion.js v3 — Audio-Reactive UI using Master Track and Muted Stems
 * 
 * Users provide a master audio track that plays audibly, and stems that are analyzed silently
 * to drive CSS effects triggered by data-sonic HTML attributes and intensity thresholds.
 * 
 * @version 3.0.0
 */

import { SyncAudioManager, stemData, SILENT_STEM } from './stem-manager.js';
import { EffectsController } from './effects-controller.js';
import { EFFECTS, registerEffect } from './effects/index.js';

class SonicMotionInstance {
    constructor(config = {}) {
        this._audioManager = new SyncAudioManager();
        this._effects = new EffectsController();
        this._onFrameCallbacks = [];
        this._animating = false;
        // The analysers read the audio BEFORE it reaches the speakers: what
        // they see is heard `outputLatency` later (≈ 40–50 ms on Windows,
        // 150–300 ms over Bluetooth). With compensation on, every frame of
        // data (and _time) is delivered when its sound is actually heard.
        this._compensateLatency = config.compensateLatency ?? true;
        this._frameQueue = [];

        // Load if config provided
        if (config.master) {
            this._audioManager.loadMaster(config.master);
        }
        if (config.stems) {
            for (const [name, val] of Object.entries(config.stems)) {
                // Support both shorthand { stems: { kick: 'url' } }
                // and options form { stems: { kick: { src: 'url', noiseFloor: 0.15 } } }
                if (typeof val === 'string' || val instanceof File || val instanceof Blob) {
                    this._audioManager.addStem(name, val);
                } else if (val && val.src) {
                    this._audioManager.addStem(name, val.src, val);
                }
            }
        }
    }

    // ---- Public API ----

    /**
     * Parse the entire document for [data-sonic] elements and bind them automatically.
     */
    initDOM() {
        this._effects.parseDOM();
        return this;
    }

    /**
     * Programmatically bind elements to a stem-driven effect
     * @param {string|Element} selector 
     * @param {object} config - { effect: string, stem: string, threshold: number }
     */
    bind(selector, config) {
        this._effects.bind(selector, config);
        return this;
    }

    unbindAll() {
        this._effects.unbindAll();
        return this;
    }

    /**
     * Load master audio
     */
    loadMaster(source) {
        this._audioManager.loadMaster(source);
        return this;
    }

    /**
     * Add a silent tracking stem
     * @param {string} name - Stem identifier
     * @param {string|File|Blob} source - Audio source URL, File, or Blob
     * @param {object} [options] - Options
     * @param {number} [options.noiseFloor=0.05] - `value` below this (0–1) is reported as 0.
     *   Raise it (e.g. 0.15) if a stem reacts to quiet background sound.
     * @param {number} [options.gateDb=-60] - RMS below this (dBFS) is silence.
     * @param {number} [options.onsetThreshold=2] - onset sensitivity: higher = fewer,
     *   surer onsets (3 suits sustained bass lines).
     * @param {number} [options.minOnsetGapMs=80] - minimum time between two onsets.
     */
    addStem(name, source, options = {}) {
        this._audioManager.addStem(name, source, options);
        return this;
    }

    /**
     * Register a callback to fire every frame with all tracking data
     */
    onFrame(callback) {
        this._onFrameCallbacks.push(callback);
        return () => {
            const i = this._onFrameCallbacks.indexOf(callback);
            if (i !== -1) this._onFrameCallbacks.splice(i, 1);
        };
    }

    play() {
        const p = this._audioManager.play();
        this._startLoop();
        return p || Promise.resolve();
    }

    pause() {
        this._audioManager.pause();
        // nothing changes while paused: stop the analysis/effects loops too
        // (play() restarts them)
        this._stopLoop();
        // one last silent frame, so onFrame listeners settle to rest instead
        // of freezing on the energy of the instant the music stopped
        if (this._onFrameCallbacks.length > 0) {
            const data = {};
            for (const name of this._audioManager.getStemNames()) data[name] = SILENT_STEM;
            data._time = this._audioManager.currentTime;
            data._duration = this._audioManager.duration;
            for (const cb of this._onFrameCallbacks) {
                try { cb(data); } catch (e) { /* */ }
            }
        }
    }

    stop() {
        this._stopLoop();
        this._audioManager.stop();
        this._effects.unbindAll();
    }

    seek(time) {
        this._audioManager.seek(time);
    }

    seekPercent(pct) {
        this._audioManager.seekPercent(pct);
    }

    /**
     * Set volume.
     *  - setVolume(0.8)            → master track volume
     *  - setVolume('vocals', 0.8)  → individual stem volume (per-stem mixing)
     */
    setVolume(stemOrVol, maybeVol) {
        if (typeof stemOrVol === 'string') {
            this._audioManager.setStemVolume(stemOrVol, maybeVol);
        } else {
            this._audioManager.setVolume(stemOrVol);
        }
        return this;
    }

    /**
     * Set an individual stem's audible volume (0.0 to 1.0).
     * Combine with setVolume(0) to mute the master and mix from stems only.
     */
    setStemVolume(name, vol) {
        this._audioManager.setStemVolume(name, vol);
        return this;
    }

    getStemVolume(name) {
        return this._audioManager.getStemVolume(name);
    }

    /**
     * Switch to per-stem mixing mode: mutes the master track (it keeps
     * driving the clock) and raises every stem to the given volume.
     */
    enableStemMix(initialVolume = 1.0) {
        this._audioManager.setVolume(0);
        for (const name of this._audioManager.getStemNames()) {
            this._audioManager.setStemVolume(name, initialVolume);
        }
        return this;
    }

    getVolume() {
        return this._audioManager.getVolume();
    }

    /**
     * Subscribe to events: 'play', 'pause', 'stop', 'seek', 'timeupdate', 'ended'
     * @returns {Function} unsubscribe function
     */
    on(event, callback) {
        return this._audioManager.on(event, callback);
    }

    destroy() {
        this._stopLoop();
        this._effects.unbindAll();
        this._audioManager.destroy();
        this._onFrameCallbacks = [];
    }

    /**
     * Latest data of a stem: { value, level, onset, bands, trend } — the same
     * shape onFrame receives. Null for an unknown stem.
     */
    getValue(stemName) {
        const stem = this._audioManager.stems.get(stemName);
        if (!stem) return null;
        return stem.currentData ?? SILENT_STEM;
    }

    /**
     * Raw spectrum of a stem for this frame (Uint8Array, 0–255 per FFT bin),
     * e.g. to feed SonicWave's equalizer/spectrum renderers. It is the live
     * buffer: copy it if you need to keep it past the current frame.
     */
    getSpectrum(stemName) {
        const stem = this._audioManager.stems.get(stemName);
        return stem ? stem.frequencyData : null;
    }

    get stemNames() {
        return this._audioManager.getStemNames();
    }

    get isPlaying() {
        return this._audioManager.isPlaying;
    }

    get currentTime() {
        return this._audioManager.currentTime;
    }

    /**
     * Output latency being compensated, in seconds (0 when compensation is
     * off or the browser does not report it).
     */
    get latency() {
        if (!this._compensateLatency) return 0;
        const ctx = this._audioManager.ctx;
        if (!ctx) return 0;
        const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        return Number.isFinite(lat) ? Math.min(0.5, Math.max(0, lat)) : 0;
    }

    /**
     * The second of the song that is being HEARD right now (currentTime minus
     * the output latency, while playing). Use it for anything shown in sync
     * with the music: lyrics, timed events.
     */
    get audibleTime() {
        const t = this._audioManager.currentTime;
        return this._audioManager.isPlaying ? Math.max(0, t - this.latency) : t;
    }

    get duration() {
        return this._audioManager.duration;
    }

    get audioElement() {
        return this._audioManager.masterAudio;
    }

    get effects() {
        return this._effects.availableEffects;
    }

    registerEffect(name, fn) {
        registerEffect(name, fn);
    }

    /**
     * Format seconds to MM:SS string
     */
    static formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ---- Internal Animation Loop ----

    _startLoop() {
        if (this._animating) return;
        this._animating = true;
        this._effects.start(); // Starts the DOM UI animations
        this._frameLoop();     // Starts the custom per-frame callbacks
    }

    _stopLoop() {
        this._animating = false;
        this._frameQueue = [];
        // cancel the pending frame so a quick pause→play can't leave two loops running
        if (this._frameRaf) cancelAnimationFrame(this._frameRaf);
        this._frameRaf = null;
        this._effects.stop();
    }

    /**
     * One loop for everything, in order: analyze the stems (and keep them in
     * sync), apply the DOM effects, then call onFrame — all with the data of
     * this same frame (analysis and callbacks used to run in two separate
     * loops, so a callback could get the previous frame).
     */
    _frameLoop() {
        if (!this._animating) return;

        const now = performance.now();
        const fresh = { at: now, results: this._audioManager.update(), time: this._audioManager.currentTime };

        // Latency compensation: queue the frame and deliver the newest one
        // whose sound is already coming out of the speakers.
        let frame = fresh;
        const latMs = this.latency * 1000;
        if (latMs > 0) {
            const q = this._frameQueue;
            q.push(fresh);
            while (q.length > 1 && q[1].at <= now - latMs) q.shift();
            frame = q[0].at <= now - latMs ? q[0] : null;
        }

        if (frame) this._effects.tick(frame.results);

        if (frame && this._onFrameCallbacks.length > 0) {
            const data = {};
            for (const [name, d] of frame.results) data[name] = d;
            data._time = frame.time;
            data._latency = this.latency;
            data._duration = this._audioManager.duration;

            for (const cb of this._onFrameCallbacks) {
                try { cb(data); } catch (e) { /* */ }
            }
        }

        this._frameRaf = requestAnimationFrame(() => this._frameLoop());
    }
}

// ---- Static Factory ----
const SonicMotion = {
    create(config = {}) {
        return new SonicMotionInstance(config);
    },
    registerEffect(name, fn) {
        registerEffect(name, fn);
    },
    get effects() {
        return Object.keys(EFFECTS);
    },
    version: '4.2.0',
    formatTime: SonicMotionInstance.formatTime
};

export default SonicMotion;
export { SonicMotionInstance, SonicMotion, stemData };
