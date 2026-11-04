// Worker del transcriptor: todo el cálculo pesado fuera del hilo de la interfaz.
// Modo «Fiel»: 1) separa la mezcla (Demucs v4 en 6 fuentes + batería de MDX-Net, o los tres modelos
//   MDX-Net si el equipo tiene poca memoria) con ONNX Runtime Web (WebGPU si hay, si no WebAssembly);
//   2) transcribe cada fuente por separado.
// Modo «Rápido»: transcribe la mezcla completa.
// Notas con Basic Pitch (Spotify, Apache-2.0) sobre TensorFlow.js (WebAssembly → WebGL → CPU). Ritmo,
// batería, timbre, armonía, estructura y digitación con los algoritmos propios de MusicFees.
import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";
import * as ort from "onnxruntime-web/webgpu";
import { audioRhythm } from "./features";
import { analyzeNotes } from "./analyze";
import { neuralBeats, transcribeSeparated, type NeuralRhythm } from "./pipeline";
import { beatThis } from "./beatthis";
import { MDX_NFFT, separateStem, toMono22k, type Stem } from "./separate";
import { DEMUCS_SEG, separateDemucs } from "./demucs";
import { threadsFor } from "./packs";
import type { Analysis, InstrumentHint, RawNote } from "./types";

export interface WorkerIn {
  /** Mezcla estéreo a 44.1 kHz. */
  L: Float32Array; R: Float32Array;
  modelUrl: string; /** Pesos afinados con pistas separadas (mismo grafo); si no viene, se usa modelUrl. */ stemModelUrl?: string; wasmUrl: string; mode: "mix" | "solo"; drums: boolean; sensitivity: number; prefer?: string;
  /**
   * Modo fiel: bytes del motor ONNX y de los modelos. Con `demucs` (red + pesos en float16) se separa en
   * 6 fuentes y de MDX-Net solo se usa la batería; sin él, los tres modelos MDX-Net.
   */
  sep?: { ort: ArrayBuffer; drums?: ArrayBuffer; vocals?: ArrayBuffer; bass?: ArrayBuffer; demucs?: { graph: ArrayBuffer; weights: ArrayBuffer | null; seg: number }; fast?: boolean };
  /** Beat This! (pulso y compás con red neuronal): red, pesos en float16 y, si no vino con `sep`, el motor ONNX. */
  beat?: { graph: ArrayBuffer; weights: ArrayBuffer | null; ort?: ArrayBuffer };
  /** Qué instrumentos dijo el usuario que hay. */
  hint?: InstrumentHint;
  /** Pistas que el usuario ya separó (Moises, BandLab, UVR…): no se separa, se transcribe cada una. */
  userStems?: Partial<Record<"vocals" | "drums" | "bass" | "guitar" | "piano" | "other", [Float32Array, Float32Array]>>;
  /** La pista «lo demás» importada trae varios instrumentos mezclados (se reparten por timbre). */
  otherMixed?: boolean;
}
export type WorkerOut =
  | { type: "progress"; pct: number; msg: string }
  | { type: "done"; analysis: Analysis; backend: string; ms: number }
  | { type: "error"; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const SR = 22050;
/**
 * Sobre fuentes separadas, el modelo de notas oye también los restos de la separación y escribe notas de
 * más (por eso «Rápida» a veces sonaba más limpia). Medido con las partituras de Brayand: con 0,7 × la
 * sensibilidad elegida, notas acertadas +1,7/+2,2 puntos y reparto +0,6/+0,7 en ambos grupos de fragmentos.
 */
const SEP_SENS = 0.7;

let model: Promise<tf.GraphModel> | null = null;
/** Modelo de notas para guitarra, piano y «lo demás» ya separados: Basic Pitch afinado con las partituras de
 * Brayand (scripts/train/notes). La voz, el bajo y la mezcla (Rápida) siguen con el original. */
let stemModel: Promise<tf.GraphModel> | null = null;
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
async function notesOf(pcm: Float32Array, sensitivity: number, label: string, from: number, span: number, m: Promise<tf.GraphModel> = model!): Promise<RawNote[]> {
  const bp = new BasicPitch(m);
  const frames: number[][] = [], onsets: number[][] = [];
  await bp.evaluateModel(pcm, (f, o) => { for (const x of f) frames.push(x); for (const x of o) onsets.push(x); },
    (p) => post({ type: "progress", pct: from + p * span, msg: `${label}… ${Math.round(p * 100)} %` }));
  // Sensibilidad: más alta = umbrales más bajos (más notas, más ruido).
  const s = Math.max(0, Math.min(1, sensitivity));
  const ev = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.62 - 0.3 * s, 0.4 - 0.2 * s, Math.round(9 - 6 * s), true, null, null, true, 11));
  return ev.map((n) => ({ s: n.startTimeSeconds, e: n.startTimeSeconds + n.durationSeconds, p: n.pitchMidi, a: n.amplitude }));
}

const fmtMin = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);

type Stereo = [Float32Array, Float32Array];
interface Separated { vocals: Stereo; drums: Stereo; bass: Stereo; other: Stereo; guitar?: Stereo; piano?: Stereo }

/** WebGPU solo si hay un adaptador de verdad (si no, ONNX Runtime puede quedarse esperando). */
async function realGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  try {
    type Adapter = { isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean; vendor?: string; architecture?: string; description?: string } };
    const ad = gpu ? (await Promise.race([gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), 3000))])) as Adapter | null : null;
    // Un adaptador «de respaldo» (WebGPU por software, p. ej. SwiftShader) es muchísimo más lento que WebAssembly.
    const inf = ad?.info, txt = `${inf?.vendor ?? ""} ${inf?.architecture ?? ""} ${inf?.description ?? ""}`.toLowerCase();
    return !!ad && !ad.isFallbackAdapter && !inf?.isFallbackAdapter && !/swiftshader|llvmpipe|software|lavapipe/.test(txt);
  } catch { return false; }
}

/** float16 → float32 (los pesos de Demucs se bajan a la mitad de tamaño). */
function f16to32(buf: ArrayBuffer): Float32Array {
  const h = new Uint16Array(buf), out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const x = h[i], s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023;
    out[i] = e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}

async function session(bytes: ArrayBuffer, gpu: boolean, extra: ort.InferenceSession.SessionOptions = {}): Promise<{ s: ort.InferenceSession; ep: string }> {
  if (gpu) try { return { s: await ort.InferenceSession.create(new Uint8Array(bytes), { ...extra, executionProviders: ["webgpu"] }), ep: "webgpu" }; } catch { /* WebAssembly */ }
  return { s: await ort.InferenceSession.create(new Uint8Array(bytes), { ...extra, executionProviders: ["wasm"] }), ep: "wasm" };
}

function ortSetup(wasm: ArrayBuffer) {
  ort.env.wasm.wasmBinary = wasm;
  // Con aislamiento entre orígenes (service worker), varios núcleos; si no, uno.
  ort.env.wasm.numThreads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? threadsFor(navigator.hardwareConcurrency) : 1;
}

/** Pulsos y tiempos fuertes con Beat This!. Si algo falla, se sigue con el detector propio (null). */
async function neuralRhythm(mix: Float32Array, beat: NonNullable<WorkerIn["beat"]>, wasm: ArrayBuffer | undefined, pct: number): Promise<NeuralRhythm | null> {
  if (!wasm || !beat.weights) return null;
  try {
    ortSetup(wasm);
    post({ type: "progress", pct, msg: "Buscando el pulso y el compás (Beat This!)…" });
    let w: Float32Array | null = f16to32(beat.weights);
    beat.weights = null;
    const { s } = await session(beat.graph, false, { externalData: [{ path: "beat_this.data", data: new Uint8Array(w.buffer) }] });
    w = null;
    const r = await beatThis(mix, async (spec, frames) => {
      const o = await s.run({ spect: new ort.Tensor("float32", spec, [1, frames, 128]) });
      return { beat: o.beat.data as Float32Array, downbeat: o.downbeat.data as Float32Array };
    }, (c, total) => post({ type: "progress", pct, msg: `Buscando el pulso y el compás (${c} de ${total})…` }));
    await s.release();
    return r;
  } catch (err) {
    console.warn("Beat This! no funcionó; se usa el detector propio:", err);
    return null;
  }
}

/**
 * Separa la mezcla. Con Demucs: voz, bajo, guitarra, piano y lo demás salen de Demucs y la batería de
 * MDX-Net (medido con las partituras de Brayand: así gana en bajo y en reparto sin perder batería).
 * Sin Demucs: voz, batería y bajo de MDX-Net; «lo demás» es lo que sobra.
 */
async function separateAll(L: Float32Array, R: Float32Array, sep: NonNullable<WorkerIn["sep"]>): Promise<{ stems: Separated; ep: string }> {
  ortSetup(sep.ort);
  const gpu = await realGpu();
  const t0 = performance.now();
  const names: Record<string, string> = { vocals: "la voz", drums: "la batería", bass: "el bajo", demucs: "guitarra, piano, bajo y voz" };
  const fast = !!sep.fast, seg = sep.demucs?.seg ?? DEMUCS_SEG, overlap = fast ? 0.1 : 0.25;
  const mdxChunks = Math.ceil(L.length / (1024 * 511 - 4096));
  const demChunks = sep.demucs ? Math.ceil(L.length / Math.floor((1 - overlap) * seg)) : 0;
  // Con Demucs, la batería sale de MDX-Net salvo en «Fiel (rápida)». Sin Demucs: los modelos que vinieron.
  const order: Stem[] = sep.demucs ? (fast ? [] : ["drums"]) : (["vocals", "drums", "bass"] as Stem[]).filter((k) => sep[k]);
  // Un trozo de Demucs cuesta ~3 de MDX-Net (7,8 s) o ~1,5 (3,9 s): así el tiempo restante sale parejo.
  const dw = seg >= DEMUCS_SEG ? 3 : 1.5;
  const totalUnits = demChunks * dw + order.length * mdxChunks;
  let units = 0, ep = "wasm";
  const tick = (what: string, c: number, total: number, u: number) => {
    units += u;
    const per = (performance.now() - t0) / 1000 / units, left = per * (totalUnits - units);
    post({ type: "progress", pct: 2 + (units / totalUnits) * 58, msg: `Separando ${what} (${c} de ${total}) · faltan ~${fmtMin(left)}` });
  };
  const out = {} as Separated;
  if (sep.demucs) {
    post({ type: "progress", pct: 2, msg: "Preparando la separación en 6 fuentes… (el primer trozo tarda más)" });
    let w: Float32Array | null = f16to32(sep.demucs.weights!);
    sep.demucs.weights = null; // memoria: los pesos ya están en float32
    const { s, ep: e } = await session(sep.demucs.graph, gpu, { externalData: [{ path: "htdemucs_6s.data", data: new Uint8Array(w.buffer) }] });
    w = null; // ONNX Runtime ya copió los pesos
    ep = e;
    const want = (fast ? ["drums", "bass", "other", "vocals", "guitar", "piano"] : ["bass", "other", "vocals", "guitar", "piano"]) as ("drums" | "bass" | "other" | "vocals" | "guitar" | "piano")[];
    const r = await separateDemucs(L, R, async (mix, spec) => {
      const o = await s.run({ mix: new ort.Tensor("float32", mix, [1, 2, seg]), spec: new ort.Tensor("float32", spec, [1, 4, 2048, Math.ceil(seg / 1024)]) });
      return { freq: o.freq.data as Float32Array, time: o.time.data as Float32Array };
    }, want, (c, total) => tick(names.demucs, c, total, dw), { seg, overlap });
    await s.release();
    out.vocals = r.vocals!; out.bass = r.bass!; out.other = r.other!; out.guitar = r.guitar!; out.piano = r.piano!;
    if (r.drums) out.drums = r.drums;
  }
  const oL = L.slice(), oR = R.slice();
  for (const stem of order) {
    const bytes = sep[stem];
    if (!bytes) throw new Error(`Falta el modelo de ${names[stem]}.`);
    post({ type: "progress", pct: 2 + (units / totalUnits) * 58, msg: `Separando ${names[stem]}…` });
    const { s, ep: e } = await session(bytes, gpu);
    if (!sep.demucs) ep = e;
    const y = await separateStem(L, R, MDX_NFFT[stem], async (x) => {
      const o = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, [1, 4, 2048, 512]) });
      return o[s.outputNames[0]].data as Float32Array;
    }, (c, total) => tick(names[stem], c, total, 1));
    await s.release();
    out[stem] = y;
    if (!sep.demucs) for (let i = 0; i < oL.length; i++) { oL[i] -= y[0][i]; oR[i] -= y[1][i]; }
  }
  if (!sep.demucs && !out.vocals) out.vocals = [new Float32Array(L.length), new Float32Array(L.length)];
  if (!sep.demucs) out.other = [oL, oR];
  return { stems: out, ep };
}

// Con varios núcleos, ONNX Runtime arranca sus hilos cargando este mismo archivo con el nombre «em-pthread»:
// en ese caso el motor ya instaló su propio receptor de mensajes y no hay que pisarlo.
if (self.name !== "em-pthread") self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const t0 = performance.now();
  try {
    const { L, R, modelUrl, stemModelUrl, wasmUrl, mode, drums, sensitivity, prefer, sep, hint, userStems, beat, otherMixed } = e.data;
    post({ type: "progress", pct: 1, msg: sep ? "Preparando los modelos de separación…" : "Preparando el modelo de notas…" });
    const be = await backend(wasmUrl, prefer);
    model ??= tf.loadGraphModel(modelUrl);
    if (stemModelUrl) stemModel ??= tf.loadGraphModel(stemModelUrl).catch(() => model!); // sin los pesos afinados, el original
    const mix = toMono22k(L, R);
    if (userStems) {
      // Pistas ya separadas: cada una se transcribe con su papel; las que faltan quedan en silencio.
      const z = new Float32Array(mix.length);
      const m = (k: keyof typeof userStems) => (userStems[k] ? toMono22k(...userStems[k]!) : z);
      const hasSix = !!(userStems.guitar || userStems.piano);
      const mono = { vocals: m("vocals"), drums: m("drums"), bass: m("bass"), other: m("other"), guitar: hasSix ? m("guitar") : undefined, piano: hasSix ? m("piano") : undefined };
      const h2: InstrumentHint = { ...hint, vocals: hint?.vocals ?? (userStems.vocals ? undefined : false), bass: hint?.bass ?? (userStems.bass ? undefined : false), drums: hint?.drums ?? (userStems.drums ? true : false) };
      const rhythm = beat ? await neuralRhythm(mix, beat, beat.ort, 3) : null;
      const analysis = await transcribeSeparated(mix, mono, { mode: "mix", drums, hint: h2, rhythm: rhythm ?? undefined, otherMixed }, (pcm, label, from, span) => notesOf(pcm, sensitivity * SEP_SENS, label, from, span, /voz|bajo/.test(label) ? model! : stemModel ?? model!),
        (pct, msg) => post({ type: "progress", pct, msg }));
      post({ type: "done", analysis, backend: `${be}+pistas`, ms: performance.now() - t0 });
      return;
    }
    if (!sep || mode === "solo") {
      const notes = await notesOf(mix, sensitivity, "Escuchando las notas", 3, 72);
      post({ type: "progress", pct: 78, msg: "Midiendo el ritmo…" });
      const r = audioRhythm(mix, SR, drums && mode === "mix", (msg) => post({ type: "progress", pct: 82, msg }));
      const nr = beat ? neuralBeats((await neuralRhythm(mix, beat, beat.ort, 86)) ?? { beats: [], downbeats: [] }, r.drums ?? []) : null;
      if (nr) { r.beats = nr.beats; r.tempo = nr.tempo; r.tempoConf = 1; }
      post({ type: "progress", pct: 92, msg: "Analizando armonía y estructura…" });
      const analysis = analyzeNotes({ notes, drums: r.drums, beats: r.beats, duration: mix.length / SR, tempo: r.tempo, mode, audio: r.features, meter: nr?.meter, downbeat: nr?.downbeat });
      if (r.tempoConf < 0.35) analysis.notesForUser.push("El pulso no es muy marcado: revisa el tempo y dónde empieza el compás.");
      post({ type: "done", analysis, backend: be, ms: performance.now() - t0 });
      return;
    }
    // ---------- modo fiel ----------
    const { stems, ep } = await separateAll(L, R, sep);
    const mono = {
      vocals: toMono22k(...stems.vocals), drums: toMono22k(...stems.drums),
      bass: toMono22k(...stems.bass), other: toMono22k(...stems.other),
      guitar: stems.guitar ? toMono22k(...stems.guitar) : undefined, piano: stems.piano ? toMono22k(...stems.piano) : undefined,
    };
    const rhythm = beat ? await neuralRhythm(mix, beat, sep.ort, 61) : null;
    const analysis = await transcribeSeparated(mix, mono, { mode, drums, hint, rhythm: rhythm ?? undefined }, (pcm, label, from, span) => notesOf(pcm, sensitivity * SEP_SENS, label, from, span, /voz|bajo/.test(label) ? model! : stemModel ?? model!),
      (pct, msg) => post({ type: "progress", pct, msg }));
    post({ type: "done", analysis, backend: `${be}+${ep}`, ms: performance.now() - t0 });
  } catch (err) {
    post({ type: "error", message: (err as Error).message || String(err) });
  }
};
