/**
 * EnergyAnalyzer — Calculates audio intensity for a stem track.
 * Outputs a global energy value (0–1) PLUS three frequency bands:
 *   - bass    (~20 Hz – 250 Hz, bottom 10% of bins)
 *   - mid     (~250 Hz – 4 kHz, bins 10%–50%)
 *   - treble  (~4 kHz – 20 kHz, top 50% of bins)
 *
 * Every band has its own:
 *   • Noise gate — signals below `noiseFloor` output 0.0 exactly
 *   • Independent peak tracker — AGC only chases real audio, not silence
 *   • Smoothed attack/release envelope
 *   • Punch (onset detection) — spikes only on sudden energy increases (transients)
 *     e.g. bass.punch peaks sharply on a kick hit, then fast-decays to zero.
 *
 * The global `value` is a weighted blend of all three bands prioritising bass + mid.
 */
export class EnergyAnalyzer {
    /**
     * @param {object} options
     * @param {number} [options.noiseFloor=0.08] - RMS noise gate (0.0–1.0).
     *   Below this threshold, all bands output 0.0. Raise to reduce sensitivity.
     */
    constructor(options = {}) {
        this._noiseFloor = options.noiseFloor ?? 0.08;
        this._agcDecay = 0.998;

        // Global energy state
        this._value = 0;
        this._peakAmp = 0;

        // Per-band state — each band tracks its own peak, smoothed value and punch
        this._bands = {
            bass: { _value: 0, _peak: 0, _punch: 0 },
            mid: { _value: 0, _peak: 0, _punch: 0 },
            treble: { _value: 0, _peak: 0, _punch: 0 },
        };

        // Raw RMS from previous frame — used to compute onset delta
        this._prevRaw = { bass: 0, mid: 0, treble: 0 };
    }

    /**
     * Analyze a full frequency data array and compute global + per-band values.
     * @param {Uint8Array} frequencyData — raw bytes from AnalyserNode (0–255)
     * @returns {number} global energy 0.0–1.0 (same as `this.value`)
     */
    analyze(frequencyData) {
        if (!frequencyData || frequencyData.length === 0) {
            this._value = 0;
            this._resetBands();
            return 0;
        }

        const len = frequencyData.length;

        // ── Frequency bin ranges (by proportion of total bins) ──────────────
        // With fftSize=512 → 256 bins covering 0–(sampleRate/2) ≈ 0–22 kHz
        //   bass:   bins 0 → 10%  ≈ 0–2.2 kHz  (most perceptual bass energy lives here)
        //   mid:    bins 10%→ 50% ≈ 2.2–11 kHz
        //   treble: bins 50%→100% ≈ 11–22 kHz
        const bassEnd = Math.floor(len * 0.10);
        const midEnd = Math.floor(len * 0.50);

        // ── Calculate RMS for each slice ─────────────────────────────────────
        const rmsGlobal = this._rms(frequencyData, 0, len);
        const rmsBass = this._rms(frequencyData, 0, bassEnd);
        const rmsMid = this._rms(frequencyData, bassEnd, midEnd);
        const rmsTreble = this._rms(frequencyData, midEnd, len);

        // ── Global noise gate ───────────────────────────────────────────────
        if (rmsGlobal < this._noiseFloor) {
            // Snap all values toward zero quickly
            this._value *= 0.85;
            if (this._value < 0.001) this._value = 0;
            this._decayBands();
            return this._value;
        }

        // ── Onset / Punch detection (transient) ──────────────────────────────
        // Punch = positive delta between current and previous raw RMS, amplified.
        // This spikes only at the instant of a hit (e.g. kick, snare) and
        // fast-decays, so it does NOT react to sustained sounds like pads or bass lines.
        const punchGain = 5.0;  // amplify the delta so small hits still register
        const bassPunchRaw = Math.max(0, rmsBass - this._prevRaw.bass) * punchGain;
        const midPunchRaw = Math.max(0, rmsMid - this._prevRaw.mid) * punchGain;
        const treblePunchRaw = Math.max(0, rmsTreble - this._prevRaw.treble) * punchGain;

        // Hold the peak, then fast-decay (×0.55 per frame ≈ gone in ~10 frames)
        this._bands.bass._punch = Math.max(Math.min(1, bassPunchRaw), this._bands.bass._punch * 0.55);
        this._bands.mid._punch = Math.max(Math.min(1, midPunchRaw), this._bands.mid._punch * 0.55);
        this._bands.treble._punch = Math.max(Math.min(1, treblePunchRaw), this._bands.treble._punch * 0.55);

        // Store raw values for next frame delta
        this._prevRaw.bass = rmsBass;
        this._prevRaw.mid = rmsMid;
        this._prevRaw.treble = rmsTreble;

        // ── Global energy ────────────────────────────────────────────────────
        this._value = this._processValue(rmsGlobal, this, 2.5);

        // ── Per-band energy ──────────────────────────────────────────────────
        // Each band has its own floor: use a fraction of the global floor so
        // bands can still be individually quiet even when the global passes the gate.
        const bandFloor = this._noiseFloor * 0.6;

        this._bands.bass._value = this._processBand(rmsBass, this._bands.bass, bandFloor, 2.2);
        this._bands.mid._value = this._processBand(rmsMid, this._bands.mid, bandFloor, 2.5);
        this._bands.treble._value = this._processBand(rmsTreble, this._bands.treble, bandFloor, 2.8);

        return this._value;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /**
     * Root Mean Square over a slice of frequencyData (values normalized 0–1)
     */
    _rms(data, start, end) {
        let sum = 0;
        const count = end - start;
        for (let i = start; i < end; i++) {
            const v = data[i] / 255;
            sum += v * v;
        }
        return count > 0 ? Math.sqrt(sum / count) : 0;
    }

    /**
     * Process a raw RMS value through noise gate + AGC + power curve + envelope.
     * Stores state on `stateObj` (must have `_value` and `_peak` properties).
     * @param {number} curve   — power curve exponent (higher = more contrast)
     */
    _processBand(rms, stateObj, floor, curve) {
        if (rms < floor) {
            stateObj._value *= 0.85;
            if (stateObj._value < 0.001) stateObj._value = 0;
            return stateObj._value;
        }

        // AGC — only chase peaks above the noise floor
        if (rms > stateObj._peak) {
            stateObj._peak = rms;
        } else {
            stateObj._peak *= this._agcDecay;
        }

        const normalized = stateObj._peak > floor
            ? Math.min(1.0, rms / stateObj._peak)
            : 0;

        const curved = Math.pow(normalized, curve);

        // Attack / release
        if (curved > stateObj._value) {
            stateObj._value += (curved - stateObj._value) * 0.7;
        } else {
            stateObj._value += (curved - stateObj._value) * 0.15;
        }

        return stateObj._value;
    }

    /**
     * Process the global value using the main `this._peakAmp` tracker.
     */
    _processValue(rms, self, curve) {
        if (rms > self._peakAmp) {
            self._peakAmp = rms;
        } else {
            self._peakAmp *= self._agcDecay;
        }

        const normalized = self._peakAmp > self._noiseFloor
            ? Math.min(1.0, rms / self._peakAmp)
            : 0;

        const curved = Math.pow(normalized, curve);

        if (curved > self._value) {
            self._value += (curved - self._value) * 0.7;
        } else {
            self._value += (curved - self._value) * 0.15;
        }

        return self._value;
    }

    /** Fast-release all band values toward zero (used inside the noise gate) */
    _decayBands() {
        for (const b of Object.values(this._bands)) {
            b._value = (b._value ?? 0) * 0.85;
            if (b._value < 0.001) b._value = 0;
            b._punch = (b._punch ?? 0) * 0.55;  // punch decays even faster
            if (b._punch < 0.001) b._punch = 0;
        }
    }

    /** Hard-zero all band values */
    _resetBands() {
        for (const b of Object.values(this._bands)) {
            b._value = 0;
            b._peak = 0;
            b._punch = 0;
        }
        this._prevRaw = { bass: 0, mid: 0, treble: 0 };
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Global energy (0–1) */
    get value() { return this._value; }

    /**
     * Frequency band energies and punch (onset transient) values, each 0–1.
     * - `value`: sustained energy in the band (smoothed)
     * - `punch`: transient spike at the moment of a hit (fast-decaying)
     *            Use `bass.punch` for kick drums, `treble.punch` for hi-hats.
     * @returns {{ bass: {value, punch}, mid: {value, punch}, treble: {value, punch} }}
     */
    get bands() {
        return {
            bass: { value: this._bands.bass._value ?? 0, punch: this._bands.bass._punch ?? 0 },
            mid: { value: this._bands.mid._value ?? 0, punch: this._bands.mid._punch ?? 0 },
            treble: { value: this._bands.treble._value ?? 0, punch: this._bands.treble._punch ?? 0 },
        };
    }

    /** Get or set the noise gate threshold (0–1) */
    get noiseFloor() { return this._noiseFloor; }
    set noiseFloor(val) { this._noiseFloor = Math.max(0, Math.min(1, val)); }

    reset() {
        this._value = 0;
        this._peakAmp = 0;
        this._resetBands();
    }
}
