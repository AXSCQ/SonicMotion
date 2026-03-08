/**
 * EffectsController — Scans the DOM for [data-sonic] attributes and applies 
 * visual animations synchronized with stem intensities.
 */
import { EFFECTS, registerEffect } from './effects/index.js';

export class EffectsController {
    constructor() {
        /** @type {Array<Binding>} */
        this._bindings = [];
        this._rafId = null;
        this._running = false;
        /** @type {Function|null} - Returns Map<stemName, { value }> */
        this._stemDataFn = null;

        this.registerEffect = registerEffect;
    }

    /**
     * Set the stem data source function
     * @param {Function} fn - Returns Map<string, { value }>
     */
    setDataSource(fn) {
        this._stemDataFn = fn;
    }

    /**
     * Scan the document for all elements with the data-sonic attribute
     */
    parseDOM() {
        this.unbindAll(); // Clean previous bindings
        const elements = document.querySelectorAll('[data-sonic]');

        elements.forEach(el => {
            const effectName = el.getAttribute('data-sonic');
            const stemName = el.getAttribute('data-sonic-track') || 'master';
            // Default threshold is 0 (reacts to any sound)
            const threshold = parseFloat(el.getAttribute('data-sonic-threshold')) || 0;
            // Default intensity is 0.5 for scaling the effect
            const intensity = parseFloat(el.getAttribute('data-sonic-intensity')) || 0.5;

            this.bind(el, {
                effect: effectName,
                stem: stemName,
                threshold: threshold,
                intensity: intensity
            });
        });

        console.log(`SonicMotion: Bound ${this._bindings.length} elements from DOM.`);
    }

    /**
     * Bind elements to a stem-driven effect
     */
    bind(selector, config) {
        let elements = [];
        if (typeof selector === 'string') {
            elements = Array.from(document.querySelectorAll(selector));
        } else if (selector instanceof NodeList || Array.isArray(selector)) {
            elements = Array.from(selector);
        } else if (selector instanceof Element) {
            elements = [selector];
        }

        if (elements.length === 0) return null;

        const id = `sm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        elements.forEach((el) => {
            // Optimize browser rendering path for these elements
            el.style.willChange = 'transform, opacity, filter, box-shadow';

            // Allow smooth releasing when threshold drops
            el.style.transition = 'transform 0.1s ease-out, opacity 0.1s ease-out, filter 0.1s ease-out, box-shadow 0.1s ease-out';

            const binding = {
                id,
                element: el,
                effectName: config.effect,
                effectFn: EFFECTS[config.effect],
                stem: config.stem,
                config: {
                    threshold: config.threshold ?? 0,
                    intensity: config.intensity ?? 0.5,
                    // Track current value independently for smooth easing
                    currentValue: 0
                }
            };

            if (!binding.effectFn) {
                console.warn(`SonicMotion: Unknown effect "${config.effect}"`);
                return;
            }

            this._bindings.push(binding);
        });

        return id;
    }

    unbindAll() {
        for (const b of this._bindings) {
            b.element.style.willChange = '';
            b.element.style.transition = '';
            b.element.style.transform = '';
            b.element.style.opacity = '';
            b.element.style.filter = '';
            b.element.style.boxShadow = '';
        }
        this._bindings = [];
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._loop();
    }

    stop() {
        this._running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        // Gracefully reset all elements
        for (const binding of this._bindings) {
            binding.effectFn(binding.element, 0, binding.config);
            binding.config.currentValue = 0;
        }
    }

    /**
     * Main animation loop
     */
    _loop() {
        if (!this._running) return;

        // Fetch the latest intensities for all stems
        const stemData = this._stemDataFn ? this._stemDataFn() : new Map();

        // // Debug logging (approx every 60 frames / 1 sec)
        // if (Math.random() < 0.02) {
        //     const printData = {};
        //     for (const [key, val] of stemData.entries()) printData[key] = val.value.toFixed(3);
        //     console.log("SonicMotion Debug Energy:", printData);
        // }

        for (const binding of this._bindings) {
            const data = stemData.get(binding.stem);
            const rawIntensity = data ? data.value : 0;
            const threshold = binding.config.threshold;

            let targetValue = 0;

            // Only trigger if the sound exceeds the user's defined threshold
            if (rawIntensity > threshold) {
                // Calculate how far past the threshold we are (0.0 to 1.0)
                // E.g. Thresh 0.8, Vol 0.9 -> (0.9 - 0.8) / (1 - 0.8) = 0.5 intensity multiplier
                const usableRange = 1.0 - threshold;
                if (usableRange > 0) {
                    targetValue = (rawIntensity - threshold) / usableRange;
                }
            }

            // Smooth the visual output to prevent jittering when dancing around threshold
            if (targetValue > binding.config.currentValue) {
                // Attack
                binding.config.currentValue += (targetValue - binding.config.currentValue) * 0.8;
            } else {
                // Release
                binding.config.currentValue += (targetValue - binding.config.currentValue) * 0.2;
            }

            // Apply to DOM
            binding.effectFn(binding.element, binding.config.currentValue, binding.config);
        }

        this._rafId = requestAnimationFrame(() => this._loop());
    }

    get availableEffects() {
        return Object.keys(EFFECTS);
    }
}
