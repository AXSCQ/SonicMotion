/**
 * SyncProbe — how far behind (or ahead of) the master clock the stems are
 * actually SOUNDING, measured on the audio itself, not on currentTime.
 *
 * With per-stem mixing the master is muted and only keeps time, while the
 * audible mix comes from the stems. Each <audio> element decodes and seeks
 * its MP3 on its own (frame granularity ≈ 26 ms, encoder delay), so a stem
 * can sound 20–60 ms later than the master even when both report the same
 * currentTime (measured in LaPazPixelArt: +21 ms after play, +53 ms after a
 * seek, while currentTime said 4–10 ms). Anything synced to currentTime
 * (lyrics, timed cues) then runs early.
 *
 * An AudioWorklet takes the RMS of every 128-sample block of the master and
 * of the sum of the stems (the master ≈ the sum of its stems). Every second
 * both envelopes (grouped 4 blocks at a time, ~11 ms) are cross-correlated
 * over the last few seconds; the peak, refined between grid points, gives
 * the lag. Estimates below `minR` are ignored and the reported offset is
 * the median of the last five. (The onset curve of 2.7 ms blocks was tried
 * first: too noisy, r 0.5–0.7 against 0.9+ with the envelopes.)
 */

const BLOCK = 128;

const WORKLET_SRC = `
class SonicMotionSyncProbe extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(128); this.n = 0; }
  process(inputs) {
    const L = 128;
    const m = inputs[0] && inputs[0][0];
    let sm = 0, ss = 0;
    for (let i = 0; i < L; i++) {
      const v = m ? m[i] : 0;
      sm += v * v;
      let s = 0;
      for (let k = 1; k < inputs.length; k++) { const ch = inputs[k] && inputs[k][0]; if (ch) s += ch[i]; }
      ss += s * s;
    }
    this.buf[this.n++] = Math.sqrt(sm / L);
    this.buf[this.n++] = Math.sqrt(ss / L);
    if (this.n >= this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    return true;
  }
}
registerProcessor('sonicmotion-sync-probe', SonicMotionSyncProbe);
`;

/** RMS of every `k` consecutive blocks (k × 128 samples). */
export function groupRms(env, k) {
    const out = new Float32Array(Math.floor(env.length / k));
    for (let i = 0; i < out.length; i++) {
        let q = 0;
        for (let j = 0; j < k; j++) q += env[i * k + j] * env[i * k + j];
        out[i] = Math.sqrt(q / k);
    }
    return out;
}

/**
 * Lag (in blocks, fractional) at which `stems` best matches `master`.
 * Positive: the stems sound LATER than the master.
 * @returns {{lag: number, r: number} | null}  null if the curves are flat
 */
export function estimateLag(master, stems, maxLag) {
    const a = master, b = stems;
    const n = Math.min(a.length, b.length);
    if (n < maxLag * 3) return null;
    const mean = (x) => { let s = 0; for (let i = 0; i < n; i++) s += x[i]; return s / n; };
    const ma = mean(a), mb = mean(b);
    const r = new Float32Array(2 * maxLag + 1);
    let best = -1;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let ab = 0, aa = 0, bb = 0;
        for (let i = maxLag; i < n - maxLag; i++) {
            const x = a[i] - ma, y = b[i + lag] - mb;
            ab += x * y; aa += x * x; bb += y * y;
        }
        const v = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
        r[lag + maxLag] = v;
        if (best < 0 || v > r[best]) best = lag + maxLag;
    }
    if (!(r[best] > 0)) return null;
    // sub-block peak (parabola through the three best points)
    let frac = 0;
    if (best > 0 && best < r.length - 1) {
        const y0 = r[best - 1], y1 = r[best], y2 = r[best + 1];
        const d = y0 - 2 * y1 + y2;
        if (d < 0) frac = Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / d));
    }
    return { lag: best - maxLag + frac, r: r[best] };
}

const loaded = new WeakMap();   // AudioContext → Promise (the module is added once)

export class SyncProbe {
    /**
     * @param {AudioContext} ctx
     * @param {object} [o]
     * @param {number} [o.windowS=4]  seconds of audio compared each time
     * @param {number} [o.everyS=1]   how often to estimate
     * @param {number} [o.maxLagS=0.25]
     * @param {number} [o.minR=0.75]  minimum correlation to trust an estimate
     */
    constructor(ctx, { windowS = 4, everyS = 1, maxLagS = 0.25, minR = 0.75 } = {}) {
        this.ctx = ctx;
        this.blockS = BLOCK / ctx.sampleRate;
        this.group = 4;                         // the envelopes are compared every 4 blocks (~11 ms)
        this.size = Math.ceil(windowS / this.blockS);
        this.minBlocks = Math.ceil(2.5 / this.blockS);
        this.every = Math.ceil(everyS / this.blockS);
        this.maxLag = Math.ceil(maxLagS / (this.blockS * this.group));
        this.minR = minR;
        this.master = new Float32Array(this.size);
        this.stems = new Float32Array(this.size);
        this.node = null;
        this.history = [];
        this.offset = 0;      // seconds: positive = stems sound later than the master
        this.lastR = 0;
        this.reset();
    }

    /** Connects the master and the stems (AudioNodes). Resolves false if AudioWorklet is unavailable. */
    async connect(masterNode, stemNodes) {
        this.disconnect();
        if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
        if (!loaded.has(this.ctx)) {
            const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
            loaded.set(this.ctx, this.ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
        }
        try { await loaded.get(this.ctx); } catch (e) { return false; }
        const node = new AudioWorkletNode(this.ctx, 'sonicmotion-sync-probe', {
            numberOfInputs: 1 + stemNodes.length, numberOfOutputs: 1, outputChannelCount: [1],
        });
        masterNode.connect(node, 0, 0);
        stemNodes.forEach((s, i) => s.connect(node, 0, i + 1));
        // a node nobody listens to may not be processed: keep it pulled, silently
        const mute = this.ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute);
        mute.connect(this.ctx.destination);
        node.port.onmessage = (e) => this._push(e.data);
        this.node = node;
        this._mute = mute;
        this._inputs = [masterNode, ...stemNodes];
        return true;
    }

    disconnect() {
        if (!this.node) return;
        for (const n of this._inputs) { try { n.disconnect(this.node); } catch (e) { /* */ } }
        try { this.node.disconnect(); this._mute.disconnect(); } catch (e) { /* */ }
        this.node.port.onmessage = null;
        this.node = null;
    }

    /** After a seek the lag changes: start measuring again (the last offset is kept meanwhile). */
    reset() {
        this.filled = 0;
        this.head = 0;
        this.sinceEstimate = 0;
        this.history = [];
    }

    _push(buf) {
        for (let i = 0; i < buf.length; i += 2) {
            this.master[this.head] = buf[i];
            this.stems[this.head] = buf[i + 1];
            this.head = (this.head + 1) % this.size;
            if (this.filled < this.size) this.filled++;
            this.sinceEstimate++;
        }
        if (this.filled >= this.minBlocks && this.sinceEstimate >= this.every) {
            this.sinceEstimate = 0;
            this._estimate();
        }
    }

    _estimate() {
        const n = this.filled, m = new Float32Array(n), s = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const k = (this.head - n + i + this.size) % this.size;
            m[i] = this.master[k]; s[i] = this.stems[k];
        }
        // nothing playing (silence) → nothing to measure
        let e = 0;
        for (let i = 0; i < n; i++) e += m[i];
        if (e / n < 1e-4) return;
        const est = estimateLag(groupRms(m, this.group), groupRms(s, this.group), this.maxLag);
        if (!est) return;
        this.lastR = est.r;
        if (est.r < this.minR) return;
        this.history.push(est.lag * this.blockS * this.group);
        if (this.history.length > 5) this.history.shift();
        const sorted = [...this.history].sort((p, q) => p - q);
        this.offset = sorted[sorted.length >> 1];
    }
}
