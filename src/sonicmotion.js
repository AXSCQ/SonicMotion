/**
 * SonicMotion.js v3 — Audio-Reactive UI using Master Track and Muted Stems
 * 
 * Users provide a master audio track that plays audibly, and stems that are analyzed silently
 * to drive CSS effects triggered by data-sonic HTML attributes and intensity thresholds.
 * 
 * @version 3.0.0
 */

import { SyncAudioManager } from './stem-manager.js';
import { EffectsController } from './effects-controller.js';
import { EFFECTS, registerEffect } from './effects/index.js';

class SonicMotionInstance {
    constructor(config = {}) {
        this._audioManager = new SyncAudioManager();
        this._effects = new EffectsController();
        this._onFrameCallbacks = [];
        this._animating = false;

        // Wire effects to continuous stem data
        this._effects.setDataSource(() => this._audioManager.update());

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
     * @param {number} [options.noiseFloor=0.08] - Noise gate threshold (0.0–1.0). Signals
     *   below this RMS level are treated as silence and produce zero output. Raise this
     *   value (e.g. 0.15) if a stem is too reactive to quiet background noise.
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

    setVolume(vol) {
        this._audioManager.setVolume(vol);
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

    getValue(stemName) {
        const stem = this._audioManager.stems.get(stemName);
        if (!stem) return null;
        return {
            value: stem.currentValue,
            bands: stem.currentBands ?? { bass: 0, mid: 0, treble: 0 }
        };
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
        this._effects.stop();
    }

    _frameLoop() {
        if (!this._animating) return;

        if (this._onFrameCallbacks.length > 0) {
            const data = {};
            for (const name of this._audioManager.getStemNames()) {
                const stem = this._audioManager.stems.get(name);
                if (stem) {
                    data[name] = {
                        value: stem.currentValue,
                        bands: stem.currentBands ?? { bass: 0, mid: 0, treble: 0 }
                    };
                }
            }
            data._time = this._audioManager.currentTime;
            data._duration = this._audioManager.duration;

            for (const cb of this._onFrameCallbacks) {
                try { cb(data); } catch (e) { /* */ }
            }
        }

        requestAnimationFrame(() => this._frameLoop());
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
    version: '4.0.0',
    formatTime: SonicMotionInstance.formatTime
};

export default SonicMotion;
export { SonicMotionInstance, SonicMotion };
