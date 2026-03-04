/**
 * Built-in effects for SonicMotion.js
 * Each effect is a function: (element, value, config) => void
 * - value: 0.0 to 1.0 (the audio band intensity)
 * - config: { intensity, ... } user-defined config
 */

/**
 * Scale — element pulses in size with audio
 */
function scale(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const min = 1;
    const max = 1 + intensity * 0.6;
    const s = min + value * (max - min);
    element.style.transform = mergeTransform(element, 'scale', `scale(${s})`);
}

/**
 * Pulse — scale + opacity change
 */
function pulse(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const s = 1 + value * intensity * 0.4;
    const opacity = 0.6 + value * 0.4;
    element.style.transform = mergeTransform(element, 'scale', `scale(${s})`);
    element.style.opacity = opacity;
}

/**
 * Rotate — continuous rotation driven by audio
 */
function rotate(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const maxDeg = intensity * 30;
    const deg = value * maxDeg;
    element.style.transform = mergeTransform(element, 'rotate', `rotate(${deg}deg)`);
}

/**
 * Shake — trembling/vibrating effect
 */
function shake(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const maxPx = intensity * 8;
    const x = (Math.random() - 0.5) * 2 * value * maxPx;
    const y = (Math.random() - 0.5) * 2 * value * maxPx;
    element.style.transform = mergeTransform(element, 'translate', `translate(${x}px, ${y}px)`);
}

/**
 * Glow — box-shadow or text-shadow that pulses
 */
function glow(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const color = config.color || '99, 102, 241'; // indigo
    const radius = value * intensity * 40;
    const spread = value * intensity * 15;
    const alpha = value * 0.8;
    element.style.boxShadow = `0 0 ${radius}px ${spread}px rgba(${color}, ${alpha})`;
}

/**
 * Wave — sinusoidal vertical movement
 */
function wave(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const maxY = intensity * 20;
    const phase = config._phase || 0;
    const y = Math.sin(performance.now() * 0.003 + phase) * value * maxY;
    element.style.transform = mergeTransform(element, 'translateY', `translateY(${y}px)`);
}

/**
 * Color — hue-shift based on audio energy
 */
function color(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const hueShift = value * intensity * 360;
    element.style.filter = `hue-rotate(${hueShift}deg)`;
}

/**
 * Blur — reactive blur effect
 */
function blur(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    // Invert: more energy = less blur (or vice versa, configurable)
    const invert = config.invert ?? false;
    const maxBlur = intensity * 10;
    const blurVal = invert ? (1 - value) * maxBlur : value * maxBlur;
    element.style.filter = `blur(${blurVal}px)`;
}

/**
 * Float — gentle floating up/down motion
 */
function float(element, value, config) {
    const intensity = config.intensity ?? 0.5;
    const maxY = intensity * 15;
    const time = performance.now() * 0.002;
    const phase = config._phase || 0;
    const y = Math.sin(time + phase) * maxY * (0.3 + value * 0.7);
    const r = Math.sin(time * 0.7 + phase) * 3 * value;
    element.style.transform = mergeTransform(element, 'translateY', `translateY(${y}px) rotate(${r}deg)`);
}

// ---- Transform helper ----
// We track transforms per-type to avoid overwriting other transform effects
const _transformMap = new WeakMap();

function mergeTransform(element, type, transformStr) {
    if (!_transformMap.has(element)) {
        _transformMap.set(element, {});
    }
    const transforms = _transformMap.get(element);
    transforms[type] = transformStr;
    return Object.values(transforms).join(' ');
}

// Export all effects as a registry
export const EFFECTS = {
    scale,
    pulse,
    rotate,
    shake,
    glow,
    wave,
    color,
    blur,
    float
};

/**
 * Register a custom effect
 * @param {string} name
 * @param {Function} fn - (element, value, config) => void
 */
export function registerEffect(name, fn) {
    EFFECTS[name] = fn;
}
