// Worker del transcriptor: todo el cálculo pesado fuera del hilo de la interfaz.
// Modo «Fiel»: 1) separa la mezcla en voz, batería, bajo y lo demás con MDX-Net (ONNX Runtime Web,
//   WebGPU si hay, si no WebAssembly); 2) transcribe cada fuente por separado.
// Modo «Rápido»: transcribe la mezcla completa.
// Notas con Basic Pitch (Spotify, Apache-2.0) sobre TensorFlow.js (WebAssembly → WebGL → CPU). Ritmo,
// batería, timbre, armonía, estructura y digitación con los algoritmos propios de MusicFees.
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";
import * as ort from "onnxruntime-web/webgpu";
import { audioRhythm } from "./features";
import { analyzeNotes } from "./analyze";
import { transcribeDrums } from "./drums";
import { trackBass } from "./bassline";
import { noteTimbres } from "./timbre";
import { MDX_NFFT, separateStem, toMono22k, type Stem } from "./separate";
import type { Analysis, RawNote } from "./types";

export interface WorkerIn {
  /** Mezcla estéreo a 44.1 kHz. */
  L: Float32Array; R: Float32Array;
  modelUrl: string; wasmUrl: string; mode: "mix" | "solo"; drums: boolean; sensitivity: number; prefer?: string;
  /** Modo fiel: bytes de los modelos y del motor ONNX. */
  sep?: { ort: ArrayBuffer; vocals: ArrayBuffer; drums: ArrayBuffer; bass: ArrayBuffer };
}
export type WorkerOut =
  | { type: "progress"; pct: number; msg: string }
  | { type: "done"; analysis: Analysis; backend: string; ms: number }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const SR = 22050;

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

/** Notas de una señal mono a 22.05 kHz. `range`: parte del avance total que le toca (0–1). */
async function notesOf(pcm: Float32Array, sensitivity: number, label: string, from: number, span: number): Promise<RawNote[]> {
  const bp = new BasicPitch(model!);
  const frames: number[][] = [], onsets: number[][] = [];
  await bp.evaluateModel(pcm, (f, o) => { for (const x of f) frames.push(x); for (const x of o) onsets.push(x); },
    (p) => post({ type: "progress", pct: from + p * span, msg: `${label}… ${Math.round(p * 100)} %` }));
  // Sensibilidad: más alta = umbrales más bajos (más notas, más ruido).
  const s = Math.max(0, Math.min(1, sensitivity));
  const ev = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.62 - 0.3 * s, 0.4 - 0.2 * s, Math.round(9 - 6 * s), true, null, null, true, 11));
  return ev.map((n) => ({ s: n.startTimeSeconds, e: n.startTimeSeconds + n.durationSeconds, p: n.pitchMidi, a: n.amplitude }));
}

const fmtMin = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);

/** Separa la mezcla con los tres modelos; «lo demás» es lo que sobra. */
async function separateAll(L: Float32Array, R: Float32Array, sep: NonNullable<WorkerIn["sep"]>): Promise<{ stems: Record<Stem | "other", [Float32Array, Float32Array]>; ep: string }> {
  ort.env.wasm.wasmBinary = sep.ort;
  ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  // WebGPU solo si hay un adaptador de verdad (si no, ONNX Runtime puede quedarse esperando).
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  let hasGpu = false;
  try { hasGpu = !!gpu && !!(await Promise.race([gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), 3000))])); } catch { hasGpu = false; }
  const order: Stem[] = ["vocals", "drums", "bass"];
  const stems = {} as Record<Stem | "other", [Float32Array, Float32Array]>;
  const oL = L.slice(), oR = R.slice();
  let ep = "wasm";
  const t0 = performance.now();
  let done = 0, totalChunks = 0;
  for (let si = 0; si < order.length; si++) {
    const stem = order[si];
    let session: ort.InferenceSession | null = null;
    if (hasGpu) try { session = await ort.InferenceSession.create(new Uint8Array(sep[stem]), { executionProviders: ["webgpu"] }); ep = "webgpu"; } catch { session = null; }
    if (!session) { session = await ort.InferenceSession.create(new Uint8Array(sep[stem]), { executionProviders: ["wasm"] }); ep = "wasm"; }
    post({ type: "progress", pct: 2 + (si / order.length) * 58, msg: `Separando ${({ vocals: "la voz", drums: "la batería", bass: "el bajo" })[stem]}…${done ? "" : " (el primer trozo tarda más)"}` });
    const names = { vocals: "la voz", drums: "la batería", bass: "el bajo" };
    const s = session;
    const [yl, yr] = await separateStem(L, R, MDX_NFFT[stem], async (x) => {
      const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, [1, 4, 2048, 512]) });
      return out[s.outputNames[0]].data as Float32Array;
    }, (c, total) => {
      if (!totalChunks) totalChunks = total * order.length;
      done++;
      const per = (performance.now() - t0) / 1000 / done, left = per * (totalChunks - done);
      post({ type: "progress", pct: 2 + (done / totalChunks) * 58, msg: `Separando ${names[stem]} (${c} de ${total}) · faltan ~${fmtMin(left)}` });
    });
    await s.release();
    stems[stem] = [yl, yr];
    for (let i = 0; i < oL.length; i++) { oL[i] -= yl[i]; oR[i] -= yr[i]; }
  }
  stems.other = [oL, oR];
  return { stems, ep };
}

/** Por segundo: cuánto pesa una fuente respecto a la mezcla (para no transcribir lo que solo se coló). */
function presence(src: Float32Array, mix: Float32Array): Float32Array {
  const n = Math.ceil(src.length / SR), out = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    let a = 0, b = 0;
    for (let i = s * SR; i < Math.min(src.length, (s + 1) * SR); i += 2) { a += src[i] * src[i]; b += mix[i] * mix[i]; }
    out[s] = b > 0 ? Math.sqrt(a / b) : 0;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const t0 = performance.now();
  try {
    const { L, R, modelUrl, wasmUrl, mode, drums, sensitivity, prefer, sep } = e.data;
    post({ type: "progress", pct: 1, msg: sep ? "Preparando los modelos de separación…" : "Preparando el modelo de notas…" });
    const be = await backend(wasmUrl, prefer);
    model ??= tf.loadGraphModel(modelUrl);
    const mix = toMono22k(L, R);
    if (!sep || mode === "solo") {
      const notes = await notesOf(mix, sensitivity, "Escuchando las notas", 3, 72);
      post({ type: "progress", pct: 78, msg: "Midiendo el ritmo…" });
      const r = audioRhythm(mix, SR, drums && mode === "mix", (msg) => post({ type: "progress", pct: 82, msg }));
      post({ type: "progress", pct: 92, msg: "Analizando armonía y estructura…" });
      const analysis = analyzeNotes({ notes, drums: r.drums, beats: r.beats, duration: mix.length / SR, tempo: r.tempo, mode, audio: r.features });
      if (r.tempoConf < 0.35) analysis.notesForUser.push("El pulso no es muy marcado: revisa el tempo y dónde empieza el compás.");
      post({ type: "done", analysis, backend: be, ms: performance.now() - t0 });
      return;
    }
    // ---------- modo fiel ----------
    const { stems, ep } = await separateAll(L, R, sep);
    const mono = {
      vocals: toMono22k(...stems.vocals), drums: toMono22k(...stems.drums),
      bass: toMono22k(...stems.bass), other: toMono22k(...stems.other),
    };
    // La voz solo cuenta donde realmente suena (si no, es lo que se coló de otros instrumentos).
    const vp = presence(mono.vocals, mix);
    const sung = vp.filter((x) => x >= 0.12).length;
    let vocals: RawNote[] = [];
    const minSung = Math.min(8, Math.max(3, vp.length * 0.3));
    if (sung >= minSung) {
      vocals = (await notesOf(mono.vocals, sensitivity, "Escuchando la voz", 60, 8))
        .filter((n) => (vp[Math.floor(n.s)] ?? 0) >= 0.12 && n.p >= 40 && n.p <= 88);
    }
    post({ type: "progress", pct: 68, msg: "Siguiendo la línea del bajo…" });
    // YIN es más fiel que el modelo polifónico en los graves; si casi no encuentra nada, se usa el modelo.
    let bassNotes = trackBass(mono.bass, SR);
    if (bassNotes.length < 20) bassNotes = (await notesOf(mono.bass, sensitivity, "Escuchando el bajo", 70, 6)).filter((n) => n.p <= 67);
    const otherNotes = await notesOf(mono.other, sensitivity, "Escuchando guitarras y teclados", 76, 12);
    post({ type: "progress", pct: 89, msg: "Leyendo la batería: bombo, caja, toms y platillos…" });
    const dp = presence(mono.drums, mix);
    const drumHits = drums && dp.filter((x) => x >= 0.15).length >= 8 ? transcribeDrums(mono.drums, SR) : [];
    post({ type: "progress", pct: 92, msg: "Reconociendo instrumentos por su timbre…" });
    const otherTimbre = noteTimbres(mono.other, SR, otherNotes);
    post({ type: "progress", pct: 95, msg: "Midiendo el ritmo y la armonía…" });
    const r = audioRhythm(mix, SR, false);
    const analysis = analyzeNotes({ notes: [], drums: drumHits, beats: r.beats, duration: mix.length / SR, tempo: r.tempo, mode, audio: r.features,
      stems: { vocals, bass: bassNotes, other: otherNotes, otherTimbre } });
    if (r.tempoConf < 0.35) analysis.notesForUser.push("El pulso no es muy marcado: revisa el tempo y dónde empieza el compás.");
    if (!vocals.length && sung < minSung) analysis.notesForUser.push("No encontré voz cantada: la melodía principal sale de los instrumentos.");
    post({ type: "done", analysis, backend: `${be}+${ep}`, ms: performance.now() - t0 });
  } catch (err) {
    post({ type: "error", message: (err as Error).message || String(err) });
  }
};
