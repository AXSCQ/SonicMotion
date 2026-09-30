/**
 * EffectsController — Scans the DOM for [data-sonic] attributes and applies 
 * visual animations synchronized with stem intensities.
 */
import { EFFECTS, registerEffect, clearTransforms } from './effects/index.js';

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
            // Optional band: 'bass', 'mid', 'treble'. Omit (or null) for global energy.
            const band = el.getAttribute('data-sonic-band') || null;

            this.bind(el, {
                effect: effectName,
                stem: stemName,
                threshold: threshold,
                intensity: intensity,
                band: band,
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
                    band: config.band ?? null,  // 'bass' | 'mid' | 'treble' | null (global)
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
            clearTransforms(b.element);
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
        this._running = true;
    }

    stop() {
        this._running = false;
        // Gracefully reset all elements
        for (const binding of this._bindings) {
            binding.effectFn(binding.element, 0, binding.config);
            binding.config.currentValue = 0;
        }
    }

    /**
     * Apply one frame of stem data to every binding. Called by the
     * SonicMotion loop right after the stems are analyzed.
     * @param {Map<string, {value, bands}>} stemData
     */
    tick(stemData) {
        if (!this._running) return;
        stemData = stemData ?? (this._stemDataFn ? this._stemDataFn() : new Map());

        // 'master' (the default track of [data-sonic]) is not analyzed on its
        // own: it follows the loudest stem of the frame
        let master = null;
        const masterOf = () => {
            if (master) return master;
            for (const d of stemData.values()) if (!master || d.value > master.value) master = d;
            return master;
        };

        for (const binding of this._bindings) {
            const data = stemData.get(binding.stem) ?? (binding.stem === 'master' ? masterOf() : undefined);

            // Resolve intensity: support band notation 'bass', 'mid', 'treble'
            // and sub-field notation 'bass.punch', 'mid.punch', 'treble.punch'.
            // Falls back to global stem energy if no band is specified.
            let rawIntensity = 0;
            if (data) {
                const band = binding.config.band;
                if (band && data.bands) {
                    // Support dot-notation: "bass.punch" → data.bands.bass.punch
                    const dotIdx = band.indexOf('.');
                    if (dotIdx !== -1) {
                        const bandName = band.slice(0, dotIdx);   // 'bass'
                        const subField = band.slice(dotIdx + 1);  // 'punch'
                        const bandObj = data.bands[bandName];
                        rawIntensity = (bandObj && bandObj[subField] !== undefined)
                            ? bandObj[subField]
                            : 0;
                    } else {
                        // Simple band name: 'bass' → data.bands.bass.value (or legacy number)
                        const bandObj = data.bands[band];
                        if (bandObj !== undefined) {
                            rawIntensity = (typeof bandObj === 'object')
                                ? (bandObj.value ?? 0)
                                : bandObj; // backward compat if still a plain number
                        }
                    }
                } else {
                    rawIntensity = data.value;
                }
            }


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
    }

    get availableEffects() {
        return Object.keys(EFFECTS);
    }
}
