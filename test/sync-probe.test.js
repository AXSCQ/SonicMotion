// Pruebas de la medición del desfase máster ↔ stems (src/sync-probe.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLag, groupRms } from '../src/sync-probe.js';

/** Envolvente con golpes al azar (semilla fija) y una cola que decae. */
function hits(n, seed = 7) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const prev = i ? env[i - 1] * 0.92 : 0;
        env[i] = rnd() < 0.03 ? 0.5 + rnd() * 0.5 : Math.max(0.01, prev);
    }
    return env;
}
const shift = (env, k) => env.map((_, i) => env[Math.min(env.length - 1, Math.max(0, i - k))]);

test('el desfase sale positivo cuando los stems suenan después', () => {
    const m = hits(1500);
    const est = estimateLag(m, shift(m, 20), 90);
    assert.ok(est && Math.abs(est.lag - 20) < 0.6, JSON.stringify(est));
    assert.ok(est.r > 0.9);
});

test('y negativo cuando suenan antes', () => {
    const m = hits(1500, 11);
    const est = estimateLag(m, shift(m, -12), 90);
    assert.ok(est && Math.abs(est.lag + 12) < 0.6, JSON.stringify(est));
});

test('con ruido encima igual lo encuentra; sin relación, la correlación es baja', () => {
    const m = hits(1500, 3);
    let s = 99;
    const noisy = shift(m, 8).map(v => v * (0.8 + 0.4 * ((s = (s * 16807) % 2147483647) / 2147483647)));
    const est = estimateLag(m, noisy, 90);
    assert.ok(est && Math.abs(est.lag - 8) < 1, JSON.stringify(est));
    const other = estimateLag(m, hits(1500, 12345), 90);
    assert.ok(!other || other.r < 0.4, JSON.stringify(other));
});

test('agrupar bloques: RMS de cada grupo', () => {
    const g = groupRms(new Float32Array([3, 4, 0, 0, 1, 1, 1, 1]), 4);
    assert.equal(g.length, 2);
    assert.ok(Math.abs(g[0] - Math.sqrt(25 / 4)) < 1e-6);
    assert.ok(Math.abs(g[1] - 1) < 1e-6);
});

test('demasiado corto para medir: null', () => {
    assert.equal(estimateLag(new Float32Array(50), new Float32Array(50), 90), null);
});
