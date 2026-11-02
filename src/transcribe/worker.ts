// Worker del transcriptor: todo el cálculo pesado fuera del hilo de la interfaz.
// 1) Notas con Basic Pitch (Spotify, Apache-2.0) sobre TensorFlow.js: WebGL, WebAssembly o CPU.
// 2) Ritmo, batería y análisis musical con los algoritmos propios de MusicFees.
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";
import { audioRhythm } from "./features";
import { analyzeNotes } from "./analyze";
import type { Analysis, RawNote } from "./types";

export interface WorkerIn { pcm: Float32Array; sr: number; modelUrl: string; wasmUrl: string; mode: "mix" | "solo"; drums: boolean; sensitivity: number; prefer?: string }
export type WorkerOut =
  | { type: "progress"; pct: number; msg: string }
  | { type: "done"; analysis: Analysis; backend: string; ms: number }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

let model: Promise<tf.GraphModel> | null = null;
/** Aceleración: WebAssembly (SIMD; el más estable en teléfonos), si no WebGL y, al final, JavaScript puro. */
async function backend(wasmUrl: string, prefer?: string): Promise<string> {
  setWasmPaths(wasmUrl);
  const order = ["wasm", "webgl", "cpu"];
  if (prefer && order.includes(prefer)) order.unshift(prefer);
  for (const b of order) {
    try { if (await tf.setBackend(b)) { await tf.ready(); if (b === "wasm") patchWasmFill(); return b; } } catch { /* siguiente */ }
  }
  return tf.getBackend();
}

/**
 * tfjs-backend-wasm 3.21 falla en «Fill» cuando no le pasan el tipo de dato (lo hace tf.signal.frame,
 * que usa Basic Pitch): «Unknown dtype undefined». Se envuelve el kernel para que use float32.
 * Con esto WebAssembly es ~5× más rápido que JavaScript puro en teléfonos sin WebGL en workers.
 */
let patched = false;
function patchWasmFill() {
  if (patched) return;
  const k = tf.getKernel("Fill", "wasm");
  if (!k) return;
  tf.unregisterKernel("Fill", "wasm");
  tf.registerKernel({ ...k, kernelFunc: (a) => k.kernelFunc({ ...a, attrs: { ...a.attrs, dtype: (a.attrs as { dtype?: string }).dtype ?? (typeof (a.attrs as { value?: unknown }).value === "string" ? "string" : "float32") } }) });
  patched = true;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const t0 = performance.now();
  try {
    const { pcm, sr, modelUrl, wasmUrl, mode, drums, sensitivity, prefer } = e.data;
    post({ type: "progress", pct: 1, msg: "Preparando el modelo de notas…" });
    const be = await backend(wasmUrl, prefer);
    model ??= tf.loadGraphModel(modelUrl);
    const bp = new BasicPitch(model);
    const frames: number[][] = [], onsets: number[][] = [];
    await bp.evaluateModel(pcm, (f, o) => { frames.push(...f); onsets.push(...o); }, (p) => post({ type: "progress", pct: 3 + p * 72, msg: `Escuchando las notas… ${Math.round(p * 100)} %` }));
    // Sensibilidad: más alta = umbrales más bajos (más notas, más ruido).
    const s = Math.max(0, Math.min(1, sensitivity));
    const onsetThresh = 0.62 - 0.3 * s, frameThresh = 0.4 - 0.2 * s, minLen = Math.round(9 - 6 * s);
    const ev = noteFramesToTime(outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minLen, true, null, null, true, 11));
    const notes: RawNote[] = ev.map((n) => ({ s: n.startTimeSeconds, e: n.startTimeSeconds + n.durationSeconds, p: n.pitchMidi, a: n.amplitude }));
    frames.length = 0; onsets.length = 0;
    post({ type: "progress", pct: 78, msg: "Midiendo el ritmo…" });
    const r = audioRhythm(pcm, sr, drums && mode === "mix", (msg) => post({ type: "progress", pct: 82, msg }));
    post({ type: "progress", pct: 92, msg: "Analizando armonía y estructura…" });
    const analysis = analyzeNotes({ notes, drums: r.drums, beats: r.beats, duration: pcm.length / sr, tempo: r.tempo, mode, audio: r.features });
    if (r.tempoConf < 0.35) analysis.notesForUser.push("El pulso no es muy marcado: revisa el tempo y dónde empieza el compás.");
    post({ type: "done", analysis, backend: be, ms: performance.now() - t0 });
  } catch (err) {
    post({ type: "error", message: (err as Error).message || String(err) });
  }
};
