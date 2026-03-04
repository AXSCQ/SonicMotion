/**
 * EnergyAnalyzer — Analyzes the overall energy/level of an audio signal.
 * Used per-stem to get a single 0-1 value representing how loud/active that stem is.
 */
export class EnergyAnalyzer {
    constructor() {
        // Smoothed output value
        this._value = 0;
        // Beat detection state
        this._historySize = 43; // ~1 second at 60fps
        this._energyHistory = new Float32Array(this._historySize);
        this._historyIndex = 0;
        this._historyFilled = false;
        this._isBeat = false;
        this._beatIntensity = 0;
        this._lastBeatTime = 0;
        this._beatCallbacks = [];
        // BPM
        this._beatTimes = [];
        this._bpm = 0;
    }

    /**
     * Register a beat callback for this stem
     * @param {Function} cb - ({ intensity, bpm }) => void
     * @returns {Function} unsubscribe
     */
    onBeat(cb) {
        this._beatCallbacks.push(cb);
        return () => {
            const i = this._beatCallbacks.indexOf(cb);
            if (i !== -1) this._beatCallbacks.splice(i, 1);
        };
    }

    /**
     * Analyze frequency data from an AnalyserNode and return energy value
     * @param {Uint8Array} frequencyData
     * @returns {{ value: number, isBeat: boolean, beatIntensity: number, bpm: number }}
     */
    analyze(frequencyData) {
        if (!frequencyData || frequencyData.length === 0) {
            return { value: 0, isBeat: false, beatIntensity: 0, bpm: 0 };
        }

        // Calculate RMS energy across all frequencies
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < frequencyData.length; i++) {
            const v = frequencyData[i] / 255;
            sum += v * v;
            if (v > peak) peak = v;
        }
        const rms = Math.sqrt(sum / frequencyData.length);

        // Mix RMS + peak for responsiveness
        const raw = rms * 0.6 + peak * 0.4;

        // Power curve for more contrast
        const curved = Math.pow(raw, 1.6);

        // Attack/release smoothing
        if (curved > this._value) {
            this._value += (curved - this._value) * 0.55; // fast attack
        } else {
            this._value += (curved - this._value) * 0.12; // slow release
        }

        // ---- Beat detection ----
        const energy = this._value;
        this._isBeat = false;
        this._beatIntensity = 0;

        // Add to history
        this._energyHistory[this._historyIndex] = energy;
        this._historyIndex = (this._historyIndex + 1) % this._historySize;
        if (this._historyIndex === 0) this._historyFilled = true;

        const histLen = this._historyFilled ? this._historySize : this._historyIndex;
        let avg = 0;
        for (let i = 0; i < histLen; i++) avg += this._energyHistory[i];
        avg /= histLen || 1;

        const now = performance.now();
        const timeSinceLast = now - this._lastBeatTime;

        if (energy > avg * 1.4 && energy > 0.12 && timeSinceLast > 150) {
            this._isBeat = true;
            this._beatIntensity = Math.min(1, (energy - avg) / (avg || 0.01));
            this._lastBeatTime = now;

            // BPM tracking
            this._beatTimes.push(now);
            if (this._beatTimes.length > 20) this._beatTimes.shift();
            this._estimateBPM();

            // Fire callbacks
            const data = { intensity: this._beatIntensity, bpm: this._bpm };
            for (const cb of this._beatCallbacks) {
                try { cb(data); } catch (e) { /* ignore */ }
            }
        }

        return {
            value: this._value,
            isBeat: this._isBeat,
            beatIntensity: this._beatIntensity,
            bpm: this._bpm
        };
    }

    _estimateBPM() {
        if (this._beatTimes.length < 4) return;
        const intervals = [];
        for (let i = 1; i < this._beatTimes.length; i++) {
            intervals.push(this._beatTimes[i] - this._beatTimes[i - 1]);
        }
        const filtered = intervals.filter(i => i > 200 && i < 2000);
        if (filtered.length < 2) return;
        const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;
        this._bpm = Math.round(60000 / avg);
    }

    get value() { return this._value; }
    get isBeat() { return this._isBeat; }

    reset() {
        this._value = 0;
        this._energyHistory.fill(0);
        this._historyIndex = 0;
        this._historyFilled = false;
        this._isBeat = false;
        this._beatIntensity = 0;
        this._lastBeatTime = 0;
        this._beatTimes = [];
        this._bpm = 0;
    }
}
