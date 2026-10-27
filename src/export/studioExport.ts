// Exportación con efectos: pasa el audio de cada pista por su cadena de Tone.js en un contexto
// sin conexión (más rápido que tiempo real) y al final la mezcla por el masterizado.
// Usa las mismas cadenas que el motor en vivo (player/studio.ts): lo que se oye es lo que se graba.
import * as Tone from "tone";
import type { MasterFx, TrackFx } from "../score/model";
import { MasterChain, TrackChain, lightAudio, makeBuses, setLightAudio } from "../player/studio";
import { createPlugin } from "../player/wam";

const TAIL = 3; // segundos extra para que se apaguen delay y reverb

/** Calidad del procesamiento sin conexión: alta al exportar; al congelar, la misma que en vivo (más rápido). */
let offlineLight = false;
export function setOfflineLight(v: boolean) { offlineLight = v; }
async function run(inter: Float32Array, sr: number, tail: number, build: (ctx: Tone.OfflineContext, input: Tone.ToneAudioNode) => Promise<void>) {
  const frames = inter.length / 2;
  // Contexto sin conexión nativo (los plugins WAM no funcionan con la envoltura de Tone).
  const ctx = new Tone.OfflineContext(new OfflineAudioContext(2, Math.ceil((frames / sr + tail) * sr), sr));
  const buf = ctx.createBuffer(2, frames, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < frames; i++) { L[i] = inter[i * 2]; R[i] = inter[i * 2 + 1]; }
  const input = new Tone.Gain({ context: ctx });
  // Exportar siempre en calidad completa (no en tiempo real: no hay riesgo de cortes).
  const light = lightAudio();
  setLightAudio(offlineLight);
  try { await build(ctx, input); } finally { setLightAudio(light); }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  Tone.connect(src, input);
  src.start(0);
  const out = (await ctx.render(true)).get()!;
  const oL = out.getChannelData(0), oR = out.numberOfChannels > 1 ? out.getChannelData(1) : oL;
  const res = new Float32Array(out.length * 2);
  for (let i = 0; i < out.length; i++) { res[i * 2] = oL[i]; res[i * 2 + 1] = oR[i]; }
  return res;
}

/** Una pista: volumen de la pista → cadena (amplificador, EQ, compresor, pedales, chorus, delay) + reverb. */
export function processTrack(inter: Float32Array, sr: number, fx: TrackFx | null, volume: number) {
  return run(inter, sr, TAIL, async (ctx, input) => {
    const out = new Tone.Gain({ context: ctx });
    out.connect(ctx.destination);
    const chain = new TrackChain(ctx, await makeBuses(ctx, out), out);
    chain.set(fx);
    // Plugins WAM en el contexto sin conexión; si alguno no carga, se exporta sin él.
    const nodes: AudioNode[] = [];
    for (const r of fx?.plugins ?? []) { try { nodes.push((await createPlugin(ctx.rawContext as unknown as BaseAudioContext, r)).audioNode); } catch { /* sin este plugin */ } }
    if (nodes.length) chain.setPluginNodes(nodes);
    input.connect(new Tone.Gain({ context: ctx, gain: volume }).connect(chain.input));
  });
}

/** La mezcla por el bus de masterizado (sin masterizado: solo el limitador de seguridad). */
export function processMaster(inter: Float32Array, sr: number, m: MasterFx | null) {
  return run(inter, sr, 0, async (ctx, input) => {
    const master = new MasterChain(ctx, ctx.destination);
    master.set(m);
    input.connect(master.input);
  });
}

/** Suma `add` sobre `mix` (crece si hace falta). */
export function mixInto(mix: Float32Array | null, add: Float32Array): Float32Array {
  if (!mix || mix.length < add.length) { const n = new Float32Array(Math.max(mix?.length ?? 0, add.length)); if (mix) n.set(mix); mix = n; }
  for (let i = 0; i < add.length; i++) mix[i] += add[i];
  return mix;
}
