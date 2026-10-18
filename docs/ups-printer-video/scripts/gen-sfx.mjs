#!/usr/bin/env node
// Generates the sound effects in public/sfx/. Plain Node, no dependencies.
// Deterministic: noise comes from a seeded PRNG and every frequency is chosen so the
// output is identical on every run. Output: 16-bit PCM, mono, 44.1 kHz WAV.
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SR = 44100;
const TAU = Math.PI * 2;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx');

/** mulberry32: small seeded PRNG returning floats in [0, 1). */
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Render `seconds` of audio; fn(t, i) is called once per sample, in order. */
const make = (seconds, fn) => {
  const n = Math.round(seconds * SR);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
  return out;
};

/** Scale so the loudest sample hits `peak` (0..1). */
const normalize = (buf, peak) => {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
};

const smoothstep = (x) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/** 16-bit PCM mono WAV container. */
const encodeWav = (buf) => {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

// --- click: paper snap / shutter for stop-motion pops, ~60 ms -------------------------
const click = (rand) =>
  make(0.06, (t) => {
    const snap = (rand() * 2 - 1) * Math.exp(-t / 0.004); // broadband transient
    const body = Math.sin(TAU * 2400 * t) * Math.exp(-t / 0.012) * 0.35; // paper resonance
    return snap + body;
  });

// --- whoosh: filtered noise sweep, ~400 ms --------------------------------------------
const whoosh = (rand) => {
  let y = 0;
  return make(0.4, (t) => {
    const p = t / 0.4;
    // one-pole low-pass whose cutoff rises 300 Hz -> 3.5 kHz, then falls to 900 Hz
    const fc = p < 0.5
      ? 300 * Math.pow(3500 / 300, p * 2)
      : 3500 * Math.pow(900 / 3500, (p - 0.5) * 2);
    const a = 1 - Math.exp((-TAU * fc) / SR);
    y += a * (rand() * 2 - 1 - y);
    const env = Math.pow(Math.sin(Math.PI * p), 1.5);
    return y * env;
  });
};

// --- hum: rising electrical hum for fuser warm-up, 1.2 s ------------------------------
const hum = () => {
  let phase = 0;
  return make(1.2, (t) => {
    const p = t / 1.2;
    const f0 = 60 + 30 * p * p; // 60 -> 90 Hz, accelerating as the element heats
    phase += (TAU * f0) / SR;
    const level = 0.2 + 0.8 * p; // grows as the fuser warms
    const edge = Math.min(1, t / 0.05, (1.2 - t) / 0.08);
    const tone = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
    return tone * level * Math.max(0, edge);
  });
};

// --- alarm: two short UPS-style beeps, ~0.6 s -----------------------------------------
const alarm = () =>
  make(0.6, (t) => {
    const beep = (start) => {
      const d = t - start;
      if (d < 0 || d > 0.22) return 0;
      const env = Math.min(1, d / 0.005) * Math.min(1, (0.22 - d) / 0.01);
      const ph = TAU * 960 * d;
      return env * (Math.sin(ph) + 0.3 * Math.sin(3 * ph)); // a little square-ish bite
    };
    return beep(0) + beep(0.3);
  });

// --- ding: soft positive chime, 0.8 s -------------------------------------------------
const ding = () =>
  make(0.8, (t) => {
    const attack = Math.min(1, t / 0.004);
    const fund = attack * Math.exp(-t / 0.28) * Math.sin(TAU * 987.77 * t);
    const over = 0.35 * attack * Math.exp(-t / 0.12) * Math.sin(TAU * 1975.5 * t);
    return fund + over;
  });

// --- bed: calm 30 s ambient pad loop --------------------------------------------------
// Four chords, 7.5 s each, equal-power crossfades in the last 1.5 s of each chord.
// Every partial is rounded to a whole number of cycles per 30 s, so the loop point is
// phase-continuous. Outer 2 s fades are applied so the file starts and ends in silence.
const bed = () => {
  const LOOP = 30;
  const SEG = LOOP / 4;
  const snap = (f) => Math.round(f * LOOP) / LOOP;
  const chords = [
    [130.81, 164.81, 196.0, 246.94], // Cmaj7 (C3 E3 G3 B3)
    [110.0, 130.81, 164.81, 196.0], // Am7 (A2 C3 E3 G3)
    [87.31, 110.0, 130.81, 164.81], // Fmaj7 (F2 A2 C3 E3)
    [98.0, 146.83, 196.0, 293.66], // Gsus2 (G2 D3 G3 D4)
  ].map((c) => c.map(snap));
  const chordTone = (k, t) => {
    let s = 0;
    for (const f of chords[k]) s += Math.sin(TAU * f * t) + 0.15 * Math.sin(TAU * 2 * f * t);
    return s * 0.1;
  };
  return make(LOOP, (t) => {
    const p = t / SEG;
    const whole = Math.floor(p);
    const k = whole % 4;
    const frac = p - whole;
    const s = Math.max(0, (frac - 0.8) / 0.2);
    const wCur = Math.cos((s * Math.PI) / 2);
    const wNext = Math.sin((s * Math.PI) / 2);
    const tone = wCur * chordTone(k, t) + wNext * chordTone((k + 1) % 4, t);
    const breathe = 0.85 + 0.15 * Math.sin((TAU * t) / 15); // period divides the loop
    const edge = smoothstep(Math.min(1, t / 2)) * smoothstep(Math.min(1, (LOOP - t) / 2));
    return tone * breathe * edge;
  });
};

// --- write ----------------------------------------------------------------------------
mkdirSync(OUT, {recursive: true});
const files = [
  ['click.wav', click(rng(1)), 0.8],
  ['whoosh.wav', whoosh(rng(2)), 0.6],
  ['hum.wav', hum(), 0.35],
  ['alarm.wav', alarm(), 0.6],
  ['ding.wav', ding(), 0.5],
  ['bed.wav', bed(), 0.12],
];
for (const [name, buf, peak] of files) {
  const wav = encodeWav(normalize(buf, peak));
  writeFileSync(join(OUT, name), wav);
  console.log(`${name.padEnd(12)} ${(buf.length / SR).toFixed(3)} s  ${wav.length} bytes`);
}
