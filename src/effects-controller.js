/**
 * EffectsController — Manages bindings between DOM elements and stem-driven effects.
 * Runs the animation loop and applies effects each frame.
 */
import { EFFECTS, registerEffect } from './effects/index.js';

export class EffectsController {
    constructor() {
        /** @type {Array<Binding>} */
        this._bindings = [];
        this._rafId = null;
        this._running = false;
        /** @type {Function|null} - Returns Map<stemName, { value, isBeat, beatIntensity }> */
        this._stemDataFn = null;
        this._phaseCounter = 0;

        this.registerEffect = registerEffect;
    }

    /**
     * Set the stem data source function
     * @param {Function} fn - Returns Map<string, { value, isBeat, beatIntensity }>
     */
    setDataSource(fn) {
        this._stemDataFn = fn;
    }

    /**
     * Bind elements to a stem-driven effect
     * @param {string|Element|NodeList} selector
     * @param {string|object} effectOrConfig - Effect name or config with { effect, stem, intensity }
     * @returns {string} Binding ID
     */
    bind(selector, effectOrConfig) {
        const config = typeof effectOrConfig === 'string'
            ? { effect: effectOrConfig }
            : { ...effectOrConfig };

        config.stem = config.stem || null; // stem name is required
        config.intensity = config.intensity ?? 0.5;
        config.effect = config.effect || 'pulse';

        let elements = [];
        if (typeof selector === 'string') {
            elements = Array.from(document.querySelectorAll(selector));
        } else if (selector instanceof Element) {
            elements = [selector];
        } else if (selector instanceof NodeList || Array.isArray(selector)) {
            elements = Array.from(selector);
        }

        if (elements.length === 0) {
            console.warn(`SonicMotion: No elements found for "${selector}"`);
            return null;
        }

        elements.forEach(el => {
            el.style.willChange = 'transform, opacity, filter, box-shadow';
        });

        const id = `sm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        elements.forEach((el, i) => {
            const binding = {
                id,
                element: el,
                effectName: config.effect,
                effectFn: EFFECTS[config.effect],
                stem: config.stem,
                config: {
                    ...config,
                    _phase: this._phaseCounter + (i * Math.PI * 0.4)
                }
            };

            if (!binding.effectFn) {
                console.warn(`SonicMotion: Unknown effect "${config.effect}"`);
                return;
            }

            this._bindings.push(binding);
        });

        this._phaseCounter += Math.PI * 0.7;
        return id;
    }

    /**
     * Remove bindings by ID
     */
    unbind(id) {
        this._bindings = this._bindings.filter(b => {
            if (b.id === id) {
                b.element.style.willChange = '';
                b.element.style.transform = '';
                b.element.style.opacity = '';
                b.element.style.filter = '';
                b.element.style.boxShadow = '';
                return false;
            }
            return true;
        });
    }

    /**
     * Remove all bindings
     */
    unbindAll() {
        for (const b of this._bindings) {
            b.element.style.willChange = '';
            b.element.style.transform = '';
            b.element.style.opacity = '';
            b.element.style.filter = '';
            b.element.style.boxShadow = '';
        }
        this._bindings = [];
    }

    /**
     * Start animation loop
     */
    start() {
        if (this._running) return;
        this._running = true;
        this._loop();
    }

    /**
     * Stop animation loop
     */
    stop() {
        this._running = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /**
     * Main animation loop
     */
    _loop() {
        if (!this._running) return;

        // Get stem data
        const stemData = this._stemDataFn ? this._stemDataFn() : new Map();

        for (const binding of this._bindings) {
            // Get the value from the bound stem
            const data = binding.stem ? stemData.get(binding.stem) : null;
            let value = data ? data.value : 0;

            // Boost on beat
            if (data && data.isBeat) {
                value = Math.min(1, value + data.beatIntensity * 0.3);
            }

            binding.effectFn(binding.element, value, binding.config);
        }

        this._rafId = requestAnimationFrame(() => this._loop());
    }

    get availableEffects() {
        return Object.keys(EFFECTS);
    }
}
