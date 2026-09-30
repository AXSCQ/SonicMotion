/**
 * EnergyAnalyzer — audio intensity of one stem, frame by frame.
 *
 * Input per frame (from an AnalyserNode with smoothingTimeConstant = 0):
 *   - timeData: Float32Array, the latest samples (getFloatTimeDomainData)
 *   - freqDb:   Float32Array, dB per FFT bin (getFloatFrequencyData)
 *
 * Output:
 *   - value  (0–1): loudness of the stem relative to its own recent peak
 *                   (automatic gain), from the TRUE signal RMS in dBFS.
 *   - level  (dBFS): the raw RMS level, for callers that want absolutes.
 *   - bands  bass (20–250 Hz) · mid (250 Hz–4 kHz) · treble (4–16 kHz),
 *            each { value, punch, onset } — bands are real frequency ranges,
 *            computed from the sample rate and FFT size.
 *   - onset  (0–1): > 0 only on the frame the stem attacks (a note, a hit,
 *            a syllable): spectral flux over an adaptive threshold. Strength
 *            is how far the flux went over the threshold.
 *   - trend  { fast, slow, rising, drop } of `value`.
 *
 * Why it changed (v4.2): the previous version took an "RMS" of the 0–255 dB
 * bytes of getByteFrequencyData (a mean of decibels, not energy), its "bass"
 * band covered 0–2.4 kHz, and its automatic gain amplified any stem up to 1
 * — a nearly silent stem (bleed at −62 dBFS) looked as loud as a real one.
 *
 * All smoothing is time-based (ms), so it behaves the same at 30 or 144 fps.
 */

const BANDS = {
    bass: [20, 250],
    mid: [250, 4000],
    treble: [4000, 16000],
};

// Loudness window of `value`: the top RANGE_DB below the running peak map to 0–1.
const RANGE_DB = 30;
// A stem whose peak never gets above this is treated as quiet, not normalized
// up to 1 (bleed of other instruments in a stem that has no instrument).
const REF_MIN_PEAK_DB = -24;
// Running peak falls this fast after loud passages (dB per second).
const PEAK_DECAY_DB_S = 1.5;
// Envelope time constants.
const ATTACK_MS = 12;
const RELEASE_MS = 90;
// Onset detector: flux must exceed mean(flux over ONSET_WINDOW_MS) × ONSET_K
// plus a small absolute margin, at most once per `minOnsetGapMs`.
// ONSET_K = 2 came out best for voice and melody (F ≈ 0.91–0.94 against the
// real attacks of 12 stems, simulated at 60 fps); plucked/sustained bass
// does better with onsetThreshold 3 and minOnsetGapMs 120.
const ONSET_WINDOW_MS = 400;
const ONSET_K = 2;

const dbToPow = (db) => (db === -Infinity || Number.isNaN(db) ? 0 : Math.pow(10, db / 10));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (ms, dtMs) => 1 - Math.exp(-dtMs / ms);

/** Envelope with automatic gain for one signal (global or a band). */
class Envelope {
    constructor() { this.reset(); }
    reset() { this.peakDb = -Infinity; this.value = 0; }
    /**
     * @param {number} levelDb   current level in dB
     * @param {number} gateDb    below this the envelope releases to 0
     * @param {number} dtMs
     */
    step(levelDb, gateDb, dtMs) {
        let target = 0;
        if (levelDb > gateDb) {
            this.peakDb = Math.max(levelDb, this.peakDb - PEAK_DECAY_DB_S * dtMs / 1000);
            const ref = Math.max(this.peakDb, REF_MIN_PEAK_DB);
            target = Math.pow(clamp01((levelDb - (ref - RANGE_DB)) / RANGE_DB), 1.6);
        }
        const k = ease(target > this.value ? ATTACK_MS : RELEASE_MS, dtMs);
        this.value += (target - this.value) * k;
        if (this.value < 0.001) this.value = 0;
        return this.value;
    }
}

/** Causal onset detector over a novelty signal (spectral flux). */
class OnsetDetector {
    constructor(minGapMs, k = ONSET_K) { this.minGapMs = minGapMs; this.k = k; this.reset(); }
    reset() { this.hist = []; this.lastAt = -1e9; this.prev = 0; }
    /** @returns {number} strength 0–1 on the attack frame, 0 otherwise */
    step(flux, nowMs, gated) {
        const hist = this.hist;
        while (hist.length && nowMs - hist[0].t > ONSET_WINDOW_MS) hist.shift();
        let mean = 0;
        for (const h of hist) mean += h.f;
        // sin historial (primer cuadro, o tras un silencio largo) la referencia
        // es 0: el primer ataque después del silencio también cuenta
        mean = hist.length ? mean / hist.length : 0;
        hist.push({ t: nowMs, f: flux });
        const thr = mean * this.k + 0.5;
        const rising = flux > this.prev;
        this.prev = flux;
        if (gated || !rising || flux <= thr || nowMs - this.lastAt < this.minGapMs) return 0;
        this.lastAt = nowMs;
        return clamp01((flux - thr) / (thr * 2));
    }
}

export class EnergyAnalyzer {
    /**
     * @param {object} [options]
     * @param {number} [options.noiseFloor=0.05] - values of `value` below this are 0 (0–1)
     * @param {number} [options.gateDb=-60]      - RMS below this (dBFS) is silence
     * @param {number} [options.minOnsetGapMs=80] - minimum time between two onsets
     * @param {number} [options.onsetThreshold] - how far over its recent average the
     *   spectral flux must go to count as an onset (higher = fewer, surer onsets)
     */
    constructor(options = {}) {
        this._noiseFloor = options.noiseFloor ?? 0.05;
        this._gateDb = options.gateDb ?? -60;
        this._minOnsetGapMs = options.minOnsetGapMs ?? 80;
        const k = options.onsetThreshold ?? ONSET_K;

        this._env = new Envelope();
        this._bandEnv = { bass: new Envelope(), mid: new Envelope(), treble: new Envelope() };
        this._bandPunch = { bass: 0, mid: 0, treble: 0 };
        this._bandSlowDb = { bass: -Infinity, mid: -Infinity, treble: -Infinity };
        this._onset = new OnsetDetector(this._minOnsetGapMs, k);
        this._bandOnset = { bass: new OnsetDetector(this._minOnsetGapMs, k), mid: new OnsetDetector(this._minOnsetGapMs, k), treble: new OnsetDetector(this._minOnsetGapMs, k) };

        this._value = 0;
        this._level = -Infinity;
        this._onsetValue = 0;
        this._bandOut = { bass: { value: 0, punch: 0, onset: 0 }, mid: { value: 0, punch: 0, onset: 0 }, treble: { value: 0, punch: 0, onset: 0 } };
        this._trend = { fast: 0, slow: 0, drop: 0 };

        this._prevMag = null;
        this._bins = null;       // band → [first, last) bin, computed once per FFT layout
        this._layout = '';
        this._lastMs = null;
    }

    /**
     * Analyze one frame.
     * @param {object} frame
     * @param {Float32Array} frame.timeData   - latest samples (−1..1)
     * @param {Float32Array} frame.freqDb     - dB per bin
     * @param {number} frame.sampleRate
     * @param {number} [frame.nowMs=performance.now()]
     * @returns {number} value (0–1)
     */
    analyze({ timeData, freqDb, sampleRate, nowMs }) {
        nowMs = nowMs ?? performance.now();
        const dtMs = this._lastMs === null ? 16.7 : Math.min(250, Math.max(1, nowMs - this._lastMs));
        this._lastMs = nowMs;

        // ── level: true RMS of the latest ~20 ms ───────────────────────────
        let sum = 0;
        const n = Math.min(timeData.length, Math.max(256, Math.round(sampleRate * 0.021)));
        for (let i = timeData.length - n; i < timeData.length; i++) sum += timeData[i] * timeData[i];
        const levelDb = 10 * Math.log10(sum / n + 1e-20);
        this._level = levelDb;
        const gated = levelDb <= this._gateDb;

        // ── global value ────────────────────────────────────────────────────
        const v = this._env.step(levelDb, this._gateDb, dtMs);
        this._value = v < this._noiseFloor ? 0 : v;

        // ── bands + spectral flux ──────────────────────────────────────────
        const bins = freqDb.length;
        const layout = `${bins}@${sampleRate}`;
        if (layout !== this._layout) {
            this._layout = layout;
            const hz = sampleRate / 2 / bins;
            this._bins = {};
            for (const [name, [lo, hi]] of Object.entries(BANDS)) {
                this._bins[name] = [Math.max(1, Math.floor(lo / hz)), Math.min(bins, Math.ceil(hi / hz))];
            }
            this._prevMag = new Float32Array(bins);
        }
        const prev = this._prevMag;
        let fluxAll = 0;
        const bandPow = { bass: 0, mid: 0, treble: 0 };
        const bandFlux = { bass: 0, mid: 0, treble: 0 };
        for (const [name, [a, b]] of Object.entries(this._bins)) {
            let p = 0, f = 0;
            for (let k = a; k < b; k++) {
                const db = freqDb[k];
                p += dbToPow(db);
                // log-compressed magnitude (dB mapped from −100..0 to 0..10)
                const m = db === -Infinity ? 0 : Math.max(0, (db + 100) / 10);
                const d = m - prev[k];
                if (d > 0) f += d;
                prev[k] = m;
            }
            bandPow[name] = p;
            bandFlux[name] = f;
            fluxAll += f;
        }

        for (const name of Object.keys(BANDS)) {
            const bandDb = 10 * Math.log10(bandPow[name] + 1e-20);
            const bv = this._bandEnv[name].step(bandDb, gated ? Infinity : this._gateDb - 20, dtMs);
            // punch: how far the band jumped above its own slow level (≈ 60 ms)
            const slow = this._bandSlowDb[name];
            const jump = slow === -Infinity ? 0 : bandDb - slow;
            this._bandSlowDb[name] = slow === -Infinity ? bandDb : slow + (bandDb - slow) * ease(60, dtMs);
            const hit = gated ? 0 : clamp01((jump - 3) / 9);
            this._bandPunch[name] = Math.max(hit, this._bandPunch[name] * Math.exp(-dtMs / 60));
            if (this._bandPunch[name] < 0.001) this._bandPunch[name] = 0;
            const out = this._bandOut[name];
            out.value = bv < this._noiseFloor ? 0 : bv;
            out.punch = this._bandPunch[name];
            out.onset = this._bandOnset[name].step(bandFlux[name], nowMs, gated || bv === 0);
        }

        this._onsetValue = this._onset.step(fluxAll, nowMs, gated || this._value === 0);
        this._updateTrend(dtMs);
        return this._value;
    }

    /** Rolling averages of `value`: fast ≈ 0.25 s, slow ≈ 4 s; `drop` fires on quiet→loud. */
    _updateTrend(dtMs) {
        const t = this._trend;
        const wasQuiet = t.slow < 0.3;
        const prevFast = t.fast;
        t.fast += (this._value - t.fast) * ease(240, dtMs);
        t.slow += (this._value - t.slow) * ease(4000, dtMs);
        const jump = t.fast - t.slow;
        if (wasQuiet && jump > 0.3 && prevFast - t.slow <= 0.3) t.drop = 1;
        else t.drop *= Math.exp(-dtMs / 240);
        if (t.drop < 0.001) t.drop = 0;
    }

    /** Silence: everything releases toward 0 (used while paused / gated). */
    idle(nowMs) {
        nowMs = nowMs ?? performance.now();
        const dtMs = this._lastMs === null ? 16.7 : Math.min(250, Math.max(1, nowMs - this._lastMs));
        this._lastMs = nowMs;
        this._value = this._env.step(-Infinity, this._gateDb, dtMs);
        for (const name of Object.keys(BANDS)) {
            this._bandOut[name].value = this._bandEnv[name].step(-Infinity, this._gateDb, dtMs);
            this._bandOut[name].punch = this._bandPunch[name] = 0;
            this._bandOut[name].onset = 0;
        }
        this._onsetValue = 0;
        this._updateTrend(dtMs);
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Loudness 0–1 (relative to the stem's own peak, with an absolute floor). */
    get value() { return this._value; }

    /** RMS level in dBFS (−Infinity when silent). */
    get level() { return this._level; }

    /** Onset strength 0–1 on the frame the stem attacks, else 0. */
    get onset() { return this._onsetValue; }

    /**
     * Bands, each { value, punch, onset } (0–1):
     *  - value: sustained energy in the band
     *  - punch: transient jump of the band over its own ~60 ms level (decays fast)
     *  - onset: 0–1 on the frame the band attacks (e.g. bass.onset for kicks)
     */
    get bands() {
        const b = this._bandOut;
        return {
            bass: { value: b.bass.value, punch: b.bass.punch, onset: b.bass.onset },
            mid: { value: b.mid.value, punch: b.mid.punch, onset: b.mid.onset },
            treble: { value: b.treble.value, punch: b.treble.punch, onset: b.treble.onset },
        };
    }

    /**
     * Energy trend of the stem:
     * - `fast` / `slow`: ~0.25 s and ~4 s averages of `value`
     * - `rising`: 0–1, how far the fast average is above the slow one
     * - `drop`:   1 at the instant the stem jumps from a quiet stretch to a loud one
     */
    get trend() {
        const t = this._trend;
        return { fast: t.fast, slow: t.slow, rising: clamp01((t.fast - t.slow) * 2.5), drop: t.drop };
    }

    /** `value` below this (0–1) is reported as 0. */
    get noiseFloor() { return this._noiseFloor; }
    set noiseFloor(val) { this._noiseFloor = clamp01(Number(val) || 0); }

    /** RMS below this (dBFS) is silence. */
    get gateDb() { return this._gateDb; }
    set gateDb(val) { this._gateDb = Number.isFinite(Number(val)) ? Number(val) : -60; }

    reset() {
        this._env.reset();
        for (const name of Object.keys(BANDS)) {
            this._bandEnv[name].reset();
            this._bandOnset[name].reset();
            this._bandPunch[name] = 0;
            this._bandSlowDb[name] = -Infinity;
            this._bandOut[name] = { value: 0, punch: 0, onset: 0 };
        }
        this._onset.reset();
        this._value = 0;
        this._level = -Infinity;
        this._onsetValue = 0;
        this._trend = { fast: 0, slow: 0, drop: 0 };
        if (this._prevMag) this._prevMag.fill(0);
        this._lastMs = null;
    }
}
