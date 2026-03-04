/**
 * SonicMotion.js v2 — Stem-Based Audio-Reactive UI Library
 * 
 * Users provide pre-separated audio stems. The master track plays audibly,
 * while individual stems are analyzed silently to drive CSS effects.
 * 
 * Usage:
 *   const sm = SonicMotion.create({
 *     master: '/audio/master.mp3',
 *     stems: { kick: '/audio/kick.mp3', vocals: '/audio/vocals.mp3' }
 *   });
 *   sm.bind('.hero', { effect: 'pulse', stem: 'kick', intensity: 0.5 });
 *   sm.play();
 * 
 * @version 2.0.0
 * @license MIT
 */

import { StemManager } from './stem-manager.js';
import { EffectsController } from './effects-controller.js';
import { EFFECTS, registerEffect } from './effects/index.js';

class SonicMotionInstance {
    /**
     * @param {object} config
     * @param {string} config.master - URL or file for the audible master track
     * @param {object} config.stems - { stemName: URL/file } pairs
     */
    constructor(config = {}) {
        this._stemManager = new StemManager();
        this._effects = new EffectsController();
        this._onFrameCallbacks = [];
        this._animating = false;

        // Wire effects to stem data
        this._effects.setDataSource(() => this._stemManager.update());

        // Load if config provided
        if (config.master) {
            this._stemManager.loadMaster(config.master);
        }
        if (config.stems) {
            for (const [name, source] of Object.entries(config.stems)) {
                this._stemManager.addStem(name, source);
            }
        }
    }

    // ---- Public API ----

    /**
     * Bind elements to a stem-driven effect
     * @param {string|Element} selector 
     * @param {object} config - { effect: string, stem: string, intensity?: number, ... }
     * @returns {SonicMotionInstance}
     */
    bind(selector, config) {
        this._effects.bind(selector, config);
        return this;
    }

    /**
     * Unbind by ID
     */
    unbind(id) {
        this._effects.unbind(id);
        return this;
    }

    /**
     * Remove all bindings
     */
    unbindAll() {
        this._effects.unbindAll();
        return this;
    }

    /**
     * Load a folder of files (master + stems auto-detected)
     * @param {FileList|File[]} files
     * @returns {{ master: string|null, stems: string[] }}
     */
    loadFolder(files) {
        return this._stemManager.loadFolder(files);
    }

    /**
     * Load master audio
     * @param {string|File} source
     */
    loadMaster(source) {
        this._stemManager.loadMaster(source);
        return this;
    }

    /**
     * Add a stem
     * @param {string} name
     * @param {string|File} source
     */
    addStem(name, source) {
        this._stemManager.addStem(name, source);
        return this;
    }

    /**
     * Register a beat callback for a specific stem
     * @param {string} stemName
     * @param {Function} callback
     * @returns {Function} unsubscribe
     */
    onBeat(stemName, callback) {
        return this._stemManager.onBeat(stemName, callback);
    }

    /**
     * Register a per-frame callback with all stem data
     * @param {Function} callback - (Map<string, { value, isBeat, beatIntensity, bpm }>) => void
     * @returns {Function} unsubscribe
     */
    onFrame(callback) {
        this._onFrameCallbacks.push(callback);
        return () => {
            const i = this._onFrameCallbacks.indexOf(callback);
            if (i !== -1) this._onFrameCallbacks.splice(i, 1);
        };
    }

    /**
     * Play master + stems
     */
    play() {
        this._stemManager.play();
        this._startLoop();
    }

    /**
     * Pause
     */
    pause() {
        this._stemManager.pause();
    }

    /**
     * Stop and reset
     */
    stop() {
        this._stopLoop();
        this._stemManager.stop();
        this._effects.unbindAll();
    }

    /**
     * Seek to time (seconds)
     */
    seek(time) {
        this._stemManager.seek(time);
    }

    /**
     * Destroy instance
     */
    destroy() {
        this._stopLoop();
        this._effects.unbindAll();
        this._stemManager.destroy();
        this._onFrameCallbacks = [];
    }

    /**
     * Get current energy value for a stem
     * @param {string} stemName
     * @returns {number} 0-1
     */
    getValue(stemName) {
        return this._stemManager.getValue(stemName);
    }

    /**
     * Get all stem names
     * @returns {string[]}
     */
    get stemNames() {
        return this._stemManager.getStemNames();
    }

    /**
     * Get current time
     */
    get currentTime() {
        return this._stemManager.currentTime;
    }

    /**
     * Get duration
     */
    get duration() {
        return this._stemManager.duration;
    }

    /**
     * Get master audio element
     */
    get audioElement() {
        return this._stemManager.masterAudio;
    }

    /**
     * Available effects
     */
    get effects() {
        return this._effects.availableEffects;
    }

    /**
     * Register a custom effect
     */
    registerEffect(name, fn) {
        registerEffect(name, fn);
    }

    // ---- Private ----

    _startLoop() {
        if (this._animating) return;
        this._animating = true;
        this._effects.start();
        this._frameLoop();
    }

    _stopLoop() {
        this._animating = false;
        this._effects.stop();
    }

    _frameLoop() {
        if (!this._animating) return;

        // The effects controller already calls stemManager.update() via its data source
        // We just need to fire onFrame callbacks with the latest data
        if (this._onFrameCallbacks.length > 0) {
            const data = {};
            for (const name of this._stemManager.getStemNames()) {
                const stem = this._stemManager.stems.get(name);
                if (stem) {
                    data[name] = {
                        value: stem.currentValue,
                        ...stem.currentBeat
                    };
                }
            }
            data._time = this._stemManager.currentTime;
            data._duration = this._stemManager.duration;

            for (const cb of this._onFrameCallbacks) {
                try { cb(data); } catch (e) { /* ignore */ }
            }
        }

        requestAnimationFrame(() => this._frameLoop());
    }
}

// ---- Static Factory ----
const SonicMotion = {
    /**
     * Create a new SonicMotion instance
     * @param {object} config - { master: string, stems: { name: source } }
     * @returns {SonicMotionInstance}
     */
    create(config = {}) {
        return new SonicMotionInstance(config);
    },

    registerEffect(name, fn) {
        registerEffect(name, fn);
    },

    get effects() {
        return Object.keys(EFFECTS);
    },

    version: '2.0.0'
};

export default SonicMotion;
export { SonicMotionInstance, SonicMotion };
