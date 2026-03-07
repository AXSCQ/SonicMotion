/**
 * EnergyAnalyzer — Calculates the raw intensity/volume of a stem track.
 * Converts frequency data into a robust, smoothed 0.0 to 1.0 multiplier.
 */
export class EnergyAnalyzer {
    constructor() {
        this._value = 0; // Smoothed final output (0 to 1)
        this._peakAmp = 0; // Local peak tracking for automatic gain control
        this._agcDecay = 0.998; // Very slow decay for the peak tracker
    }

    /**
     * Transforms raw frequency bins into a single normalized intensity value.
     * @param {Uint8Array} frequencyData 
     * @returns {number} 0.0 to 1.0
     */
    analyze(frequencyData) {
        if (!frequencyData || frequencyData.length === 0) {
            return this._value = 0;
        }

        let sumSquare = 0;
        for (let i = 0; i < frequencyData.length; i++) {
            const val = frequencyData[i] / 255;
            sumSquare += val * val;
        }

        // Root Mean Square for true perceptual volume
        let rms = Math.sqrt(sumSquare / frequencyData.length);

        // Simple Automatic Gain Control (AGC) - If this track is quiet naturally, boost it 
        // to still utilize the 0-1 range. If it's loud, scale it correctly.
        if (rms > this._peakAmp) {
            this._peakAmp = rms;
        } else {
            this._peakAmp *= this._agcDecay;
        }

        const normalized = this._peakAmp > 0.01 ? Math.min(1.0, rms / this._peakAmp) : rms;

        // Apply a power curve so loud parts pop visually while quiet parts remain low
        const curved = Math.pow(normalized, 1.8);

        // Attack/Release enveloping for visual smoothness
        if (curved > this._value) {
            // Fast attack: Visually snap instantly when sound hits
            this._value += (curved - this._value) * 0.7;
        } else {
            // Slower release: Visually fade out slightly when sound drops
            this._value += (curved - this._value) * 0.15;
        }

        return this._value;
    }

    get value() {
        return this._value;
    }

    reset() {
        this._value = 0;
        this._peakAmp = 0;
    }
}
