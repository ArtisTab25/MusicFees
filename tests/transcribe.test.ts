// Pruebas del transcriptor y del análisis musical (algoritmos propios, sin el modelo de notas).
import * as at from "@coderline/alphatab";
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectKey, recognizeChords, beatChroma } from "../src/transcribe/harmony";
import { fretEvents } from "../src/transcribe/fretting";
import { estimateTempo, trackBeats, meterAndDownbeat } from "../src/transcribe/rhythm";
import { analyzeNotes } from "../src/transcribe/analyze";
import { buildScore } from "../src/transcribe/build";
import { analyzeScore } from "../src/transcribe/symbolic";
import { analyzeCounterpoint } from "../src/transcribe/counterpoint";
import { findSections } from "../src/transcribe/form";
import { fft } from "../src/transcribe/dsp";
import { createSong, applyOp, settings, kindOf, analysisOf } from "../src/score/model";
import type { RawNote } from "../src/transcribe/types";

const CHORD = { C: [48, 52, 55, 60, 64], Am: [45, 52, 57, 60, 64], F: [41, 53, 57, 60, 65], G: [43, 50, 55, 59, 62] } as Record<string, number[]>;

/** Canción de prueba: progresión C–Am–F–G, un acorde por compás, bajo en negras, melodía en corcheas. */
function song(bars = 16, bpm = 100) {
  const spb = 60 / bpm, notes: RawNote[] = [], prog = ["C", "Am", "F", "G"];
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  for (let b = 0; b < bars; b++) {
    const ch = CHORD[prog[b % 4]], t0 = b * 4 * spb;
    for (const p of ch.slice(1)) notes.push({ s: t0, e: t0 + 4 * spb - 0.05, p, a: 0.6 });
    for (let k = 0; k < 4; k++) notes.push({ s: t0 + k * spb, e: t0 + (k + 0.9) * spb, p: ch[0] - 12 + 12, a: 0.8 });
    for (let k = 0; k < 8; k++) notes.push({ s: t0 + k * spb / 2, e: t0 + (k + 0.9) * spb / 2, p: scale[(b + k) % 8] + 12, a: 0.9 });
  }
  const beats = Array.from({ length: bars * 4 }, (_, i) => i * spb);
  return { notes, beats, spb };
}

test("FFT: un seno cae en su bin", () => {
  const n = 64, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 5 * i) / n);
  fft(re, im);
  const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mag.indexOf(Math.max(...mag)), 5);
});

test("tonalidad: Do mayor y La menor", () => {
  const c = [6, 0, 3, 0, 4, 4, 0, 5, 0, 3, 0, 2];
  const k = detectKey(c);
  assert.equal(k.tonic, 0); assert.equal(k.mode, "major"); assert.equal(k.sig, 0);
  const am = detectKey([3, 0, 2, 0, 3, 3, 0, 2, 1, 6, 0, 2]);
  assert.equal(am.tonic, 9); assert.equal(am.mode, "minor"); assert.equal(am.sig, 0);
});

test("acordes: C Am F G con grados y bajo", () => {
  const { notes, beats } = song(8);
  const { chroma, bass, energy } = beatChroma(notes, beats);
  const key = detectKey([6, 0, 3, 0, 4, 4, 0, 5, 0, 3, 0, 2]);
  const strength = beats.map((_, k) => (k % 4 === 0 ? 1 : 0.25));
  const segs = recognizeChords(chroma, bass, energy, key, strength).filter((s) => s.root >= 0);
  assert.deepEqual(segs.slice(0, 4).map((s) => s.name), ["C", "Am", "F", "G"]);
  assert.deepEqual(segs.slice(0, 4).map((s) => s.roman), ["I", "vi", "IV", "V"]);
  assert.equal(segs[0].b0, 0); assert.equal(segs[1].b0, 4);
});

test("digitación: acordes tocables y línea sin saltos", () => {
  const std = [64, 59, 55, 50, 45, 40];
  const r = fretEvents([[64, 60, 55, 52, 48], [64, 59, 55, 47, 43, 31 + 12]], std);
  for (const ev of r.placed) {
    const fr = ev.filter((n) => n.fret > 0).map((n) => n.fret);
    assert.ok(Math.max(...fr) - Math.min(...fr) <= 4, "apertura");
    assert.equal(new Set(ev.map((n) => n.str)).size, ev.length, "cuerdas distintas");
    for (const n of ev) assert.equal(std[6 - n.str] + n.fret, n.pitch, "altura correcta");
  }
  // Acorde de Do abierto: x32010
  assert.deepEqual(r.placed[0].map((n) => n.fret), [0, 1, 0, 2, 3]);
  // Escala: se queda en una posición
  const line = fretEvents([[60], [62], [64], [65], [67], [69]].map((x) => x.map((p) => p)), std).placed.map((e) => e[0].fret);
  assert.ok(Math.max(...line) - Math.min(...line) <= 5);
});

test("ritmo: tempo, tiempos y compás", () => {
  const fps = 86, bpm = 120, n = fps * 20;
  const env = new Float32Array(n);
  for (let k = 0; k * 0.5 < 20; k++) { const i = Math.round(k * 0.5 * fps) + 7; if (i < n) env[i] = k % 4 === 0 ? 1 : 0.6; }
  for (let i = 0; i < n; i += 11) env[i] += 0.1;
  const t = estimateTempo(env, fps);
  assert.ok(Math.abs(t.bpm - 120) <= 2, `tempo ${t.bpm}`);
  const beats = trackBeats(env, fps, t.bpm);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  assert.ok(gaps.every((g) => Math.abs(g - 0.5) < 0.05), "tiempos parejos");
  const acc = Array.from({ length: 32 }, (_, k) => (k % 3 === 1 ? 1 : 0.2));
  const m = meterAndDownbeat(acc);
  assert.equal(m.meter, 3); assert.equal(m.downbeat, 1);
});

test("estructura: verso y coro que se repiten", () => {
  const V = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], Ch = [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0];
  const bars: number[][] = [], en: number[] = [];
  for (const [blk, e] of [[V, 1], [Ch, 2], [V, 1], [Ch, 2]] as [number[], number][]) for (let i = 0; i < 8; i++) { bars.push(blk.concat(blk)); en.push(e); }
  const s = findSections(bars, en);
  assert.ok(s.length >= 4, `secciones ${s.length}`);
  assert.equal(s[0].label, s[2].label);
  assert.equal(s.find((x) => x.label === s[1].label)?.name, "Coro");
});

test("contrapunto: movimiento contrario y quintas paralelas", () => {
  const up = [72, 74, 76, 77, 79, 77, 76, 74].map((p, i) => ({ q0: i, q1: i + 1, p }));
  const lo = [48, 47, 45, 43, 41, 43, 45, 47].map((p, i) => ({ q0: i, q1: i + 1, p }));
  const r = analyzeCounterpoint(up, lo, 4)!;
  assert.ok(r.motion.contrary >= 6);
  const p5 = analyzeCounterpoint([67, 69, 71].map((p, i) => ({ q0: i, q1: i + 1, p })).concat([{ q0: 3, q1: 4, p: 72 }]), [60, 62, 64, 65].map((p, i) => ({ q0: i, q1: i + 1, p })), 4)!;
  assert.ok(p5.parallelPerfect.some((x) => x.kind === "5as"));
});

test("transcripción de punta a punta: análisis → canción con pistas, acordes y secciones", () => {
  const { notes, beats } = song(16, 100);
  const a = analyzeNotes({ notes, beats, duration: beats[beats.length - 1] + 0.6, tempo: 100, mode: "mix", meter: 4, downbeat: 0 });
  assert.equal(a.key.name, "Do mayor");
  assert.ok(a.parts.some((p) => p.role === "bass") && a.parts.some((p) => p.role === "melody") && a.parts.some((p) => p.role === "harmony"));
  const s = buildScore(a, { mode: "mix", presets: {}, drums: false, sensitivity: 0.5, markDoubtful: true, title: "Prueba" });
  assert.equal(s.tracks.length, 3);
  assert.equal(s.masterBars.length, 16);
  assert.equal(s.tempo, 100);
  for (const tr of s.tracks) {
    assert.equal(tr.staves[0].bars.length, 16);
    for (const bar of tr.staves[0].bars) {
      const ticks = bar.voices[0].beats.reduce((x, b) => x + (3840 / b.duration) * (b.dots ? 1.5 : 1) * (b.hasTuplet ? b.tupletDenominator / b.tupletNumerator : 1), 0);
      assert.ok(Math.abs(ticks - 3840) < 2, `compás lleno (${tr.name} ${bar.index}: ${ticks})`);
    }
  }
  const bass = s.tracks.find((t) => t.name === "Bajo")!;
  assert.equal(kindOf(bass), "tab");
  assert.equal(bass.staves[0].bars[0].voices[0].beats[0].notes[0].realValue, 48);
  // Acordes con diagrama sobre la guitarra de acordes.
  const chords = s.tracks.find((t) => t.name === "Acordes")!;
  const names = chords.staves[0].bars.slice(0, 4).map((b) => b.voices[0].beats.find((x) => x.chordId)?.chordId);
  assert.deepEqual(names, ["C", "Am", "F", "G"]);
  assert.ok(analysisOf(s)?.chords.length);
  // Se puede guardar como Guitar Pro.
  const gp = new at.exporter.Gp7Exporter().export(s, settings);
  const back = at.importer.ScoreLoader.loadScoreFromBytes(gp, settings);
  assert.equal(back.tracks.length, 3);
});

test("análisis de una partitura: tonalidad, acordes y contrapunto entre pistas", () => {
  const s = createSong("jazz", 8, "Análisis");
  const t = s.tracks.findIndex((x) => kindOf(x) === "notation");
  const prog = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
  for (let b = 0; b < 8; b++) applyOp(s, { k: "setVoice", t, b, v: 0, beats: [{ dur: 1, dots: 0, tup: 0, notes: prog[b % 4].map((pitch) => ({ pitch, fx: [] })) }] });
  const a = analyzeScore(s);
  assert.equal(a.key.tonic, 0);
  assert.deepEqual(a.chords.filter((c) => c.root >= 0).slice(0, 4).map((c) => c.name), ["C", "Am", "F", "G"]);
});
