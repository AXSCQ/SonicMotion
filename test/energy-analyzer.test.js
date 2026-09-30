// node --test — EnergyAnalyzer con señales sintéticas (sin navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EnergyAnalyzer } from '../src/energy-analyzer.js';

const SR = 48000;
const FFT = 2048;
const BINS = FFT / 2;
const HZ = SR / FFT;

/** Un cuadro: seno de `freq` Hz a `db` dBFS (RMS), y su espectro aproximado. */
function frame(freq, db, phase = 0) {
    const amp = Math.pow(10, db / 20) * Math.SQRT2;
    const timeData = new Float32Array(FFT);
    for (let i = 0; i < FFT; i++) timeData[i] = amp * Math.sin(2 * Math.PI * freq * (i / SR) + phase);
    const freqDb = new Float32Array(BINS).fill(-Infinity);
    if (freq > 0) {
        const k = Math.round(freq / HZ);
        for (let j = -1; j <= 1; j++) if (k + j >= 0 && k + j < BINS) freqDb[k + j] = db - 4.8 - (j === 0 ? 0 : 6);
    }
    return { timeData, freqDb, sampleRate: SR };
}
const silence = () => ({ timeData: new Float32Array(FFT), freqDb: new Float32Array(BINS).fill(-Infinity), sampleRate: SR });

/** Corre `n` cuadros a 60 fps y devuelve el analizador. */
function run(ea, n, mk, t0 = 0) {
    for (let i = 0; i < n; i++) ea.analyze({ ...mk(i), nowMs: t0 + i * 16.7 });
    return ea;
}

test('un stem fuerte llega cerca de 1 y su nivel en dBFS es el real', () => {
    const ea = run(new EnergyAnalyzer(), 60, () => frame(440, -12));
    assert.ok(ea.value > 0.9, `value ${ea.value}`);
    assert.ok(Math.abs(ea.level - -12) < 0.5, `level ${ea.level}`);
});

test('un stem casi vacío (fuga a −62 dBFS) queda en 0, no se amplifica', () => {
    const ea = run(new EnergyAnalyzer(), 120, () => frame(100, -62));
    assert.equal(ea.value, 0);
});

test('un stem bajo pero real (−45 dBFS) no llega a 1: la referencia absoluta lo frena', () => {
    const ea = run(new EnergyAnalyzer(), 120, () => frame(200, -45));
    assert.ok(ea.value > 0 && ea.value < 0.5, `value ${ea.value}`);
});

test('las bandas son frecuencias reales: 60 Hz es grave, 8 kHz es agudo', () => {
    const low = run(new EnergyAnalyzer(), 60, () => frame(60, -12)).bands;
    assert.ok(low.bass.value > 0.8 && low.treble.value === 0, JSON.stringify(low));
    const high = run(new EnergyAnalyzer(), 60, () => frame(8000, -12)).bands;
    assert.ok(high.treble.value > 0.8 && high.bass.value === 0, JSON.stringify(high));
});

test('onset: dispara en el ataque y no mientras la nota se sostiene', () => {
    const ea = new EnergyAnalyzer();
    const onsets = [];
    for (let i = 0; i < 120; i++) {
        // silencio, nota a los 30 cuadros, se sostiene; otra nota más fuerte a los 80
        const f = i < 30 ? silence() : i < 80 ? frame(300, -20) : frame(600, -10);
        ea.analyze({ ...f, nowMs: i * 16.7 });
        if (ea.onset > 0) onsets.push(i);
    }
    assert.deepEqual(onsets, [30, 80]);
});

test('onset por banda: un golpe grave aparece en bands.bass.onset', () => {
    const ea = new EnergyAnalyzer();
    let bassHits = 0, trebleHits = 0;
    for (let i = 0; i < 90; i++) {
        const f = i % 30 < 3 ? frame(55, -8) : silence();
        ea.analyze({ ...f, nowMs: i * 16.7 });
        if (ea.bands.bass.onset > 0) bassHits++;
        if (ea.bands.treble.onset > 0) trebleHits++;
    }
    assert.equal(bassHits, 3);
    assert.equal(trebleHits, 0);
});

test('el suavizado depende del tiempo, no de los cuadros: 30 fps ≈ 60 fps', () => {
    const at = (fps) => {
        const ea = new EnergyAnalyzer();
        // mismos instantes finales para los dos: suena hasta 1000 ms, silencio hasta 1100 ms
        for (let i = 0; i * 1000 / fps <= 1100 + 1e-9; i++) {
            const t = i * 1000 / fps;
            ea.analyze({ ...(t < 1000 ? frame(440, -12) : silence()), nowMs: t });
        }
        return ea.value;
    };
    assert.ok(Math.abs(at(30) - at(60)) < 0.1, `${at(30)} vs ${at(60)}`);
});

test('noiseFloor: valores por debajo se reportan como 0', () => {
    const ea = run(new EnergyAnalyzer({ noiseFloor: 0.5 }), 120, () => frame(200, -45));
    assert.equal(ea.value, 0);
});

test('reset deja todo en reposo', () => {
    const ea = run(new EnergyAnalyzer(), 60, () => frame(440, -12));
    ea.reset();
    assert.equal(ea.value, 0);
    assert.equal(ea.onset, 0);
    assert.deepEqual(ea.bands.bass, { value: 0, punch: 0, onset: 0 });
});
