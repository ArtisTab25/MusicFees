// Operaciones de pista completa: exportar una parte (una pista o unos compases), fusionar dos pistas
// en una (cada una en su propia voz) y dividir una pista (por voces o por altura, como mano
// izquierda y derecha del piano). Todo se traduce a ops normales para deshacer y el dúo en vivo.
import * as at from "@coderline/alphatab";
import { applyOp, beatToClip, finishScore, fromJson, kindOf, tempoAt, toJson, type ClipBeat, type Op } from "./model";

type Score = at.model.Score;

/** Copia de la canción con solo algunas pistas y/o compases (para exportar una parte). */
export function subScore(score: Score, opts: { tracks?: number[]; bars?: { s: number; e: number } }): Score {
  let out = fromJson(toJson(score));
  out.title = score.title;
  if (opts.bars) {
    const { s, e } = opts.bars;
    const bpm = tempoAt(score, s);
    for (let b = out.masterBars.length - 1; b > e; b--) out = applyOp(out, { k: "barDel", at: b });
    for (let b = s - 1; b >= 0; b--) out = applyOp(out, { k: "barDel", at: b });
    // El tempo con el que empezaba esa parte (al borrar compases del inicio se perdía).
    out = applyOp(out, { k: "barProp", b: 0, prop: "tempo", val: Math.round(bpm) });
  }
  if (opts.tracks) {
    const keep = new Set(opts.tracks);
    for (let t = out.tracks.length - 1; t >= 0; t--) if (!keep.has(t) && out.tracks.length > 1) out = applyOp(out, { k: "trackDel", t });
  }
  finishScore(out);
  return out;
}

const voiceHas = (v: at.model.Voice | undefined) => !!v && !v.isEmpty && v.beats.some((b) => b.notes.length > 0);
/** Voces con notas en alguna parte de la pista. */
export function usedVoices(score: Score, t: number): number[] {
  const tr = score.tracks[t];
  const out = new Set<number>();
  for (const bar of tr?.staves[0].bars ?? []) bar.voices.forEach((v, i) => { if (voiceHas(v)) out.add(i); });
  return [...out].sort((a, b) => a - b);
}
const voiceClip = (score: Score, t: number, b: number, v: number): ClipBeat[] => {
  const tr = score.tracks[t];
  const voice = tr.staves[0].bars[b]?.voices[v];
  return voice && !voice.isEmpty ? voice.beats.map((x) => beatToClip(tr, x)) : [];
};

/** Pistas con las que se puede fusionar `t` (mismo tipo: tablatura, partitura o batería). */
export const mergeTargets = (score: Score, t: number) => {
  const me = score.tracks[t];
  // Primero las del mismo instrumento (dos guitarras iguales), luego las del mismo tipo.
  const rank = (x: at.model.Track) => (x.playbackInfo.program === me.playbackInfo.program ? 0 : 1) + (kindOf(x) === kindOf(me) ? 0 : 2);
  return score.tracks.filter((x) => x.index !== t && (kindOf(x) === "drums") === (kindOf(me) === "drums"))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index).map((x) => x.index);
};

/**
 * Fusiona la pista `from` dentro de `into`: lo que tenía `from` pasa a las voces libres de `into`
 * (hasta 4 voces) y `from` se borra. Las notas se reacomodan en la afinación de la pista destino.
 */
export function planMerge(score: Score, from: number, into: number): { ops: Op[]; error?: string } {
  const src = usedVoices(score, from);
  if (!src.length) return { ops: [{ k: "trackDel", t: from }] };
  const taken = usedVoices(score, into);
  const free = [0, 1, 2, 3].filter((v) => !taken.includes(v));
  if (free.length < src.length) return { ops: [], error: `No caben: «${score.tracks[into].name}» ya usa ${taken.length} de 4 voces y la otra pista trae ${src.length}.` };
  const ops: Op[] = [];
  const nBars = score.masterBars.length;
  src.forEach((v, k) => {
    const dest = free[k];
    for (let b = 0; b < nBars; b++) {
      const beats = voiceClip(score, from, b, v);
      if (beats.length) ops.push({ k: "setVoice", t: into, b, v: dest, beats });
    }
  });
  ops.push({ k: "trackDel", t: from });
  return { ops };
}

/** Cada voz con notas (desde la 2) pasa a una pista nueva justo debajo. */
export function planSplitVoices(score: Score, t: number): { ops: Op[]; made: number } {
  const voices = usedVoices(score, t).filter((v) => v > 0);
  const ops: Op[] = [];
  const name = score.tracks[t].name;
  const nBars = score.masterBars.length;
  // De la última a la primera: cada pista nueva entra en t+1, así quedan en orden (voz 2, voz 3…).
  for (const v of voices.slice().reverse()) {
    ops.push({ k: "trackDup", t, empty: true });
    ops.push({ k: "trackProp", t: t + 1, prop: "name", val: `${name} · voz ${v + 1}`.slice(0, 60) });
    for (let b = 0; b < nBars; b++) {
      const beats = voiceClip(score, t, b, v);
      ops.push({ k: "setVoice", t: t + 1, b, v: 0, beats });
      if (beats.length) ops.push({ k: "setVoice", t, b, v, beats: [] });
    }
  }
  return { ops, made: voices.length };
}

/**
 * Divide por altura: las notas por debajo de `split` (60 = Do central) se van a una pista nueva
 * debajo (mano izquierda); la original se queda con las de arriba. El ritmo se conserva en ambas.
 */
export function planSplitPitch(score: Score, t: number, split = 60): { ops: Op[]; low: number; high: number } {
  const tr = score.tracks[t];
  const ops: Op[] = [{ k: "trackDup", t, empty: true }, { k: "trackProp", t: t + 1, prop: "name", val: `${tr.name} · grave`.slice(0, 60) }];
  let low = 0, high = 0;
  tr.staves[0].bars.forEach((bar, b) => bar.voices.forEach((voice, v) => {
    if (voice.isEmpty) return;
    const beats = voice.beats.map((x) => beatToClip(tr, x));
    const isLow = (p?: number) => (p ?? 128) < split;
    const lo = beats.map((cb) => ({ ...cb, text: null, notes: cb.notes.filter((n) => isLow(n.pitch)) }));
    const hi = beats.map((cb) => ({ ...cb, notes: cb.notes.filter((n) => !isLow(n.pitch)) }));
    low += lo.reduce((k, x) => k + x.notes.length, 0); high += hi.reduce((k, x) => k + x.notes.length, 0);
    ops.push({ k: "setVoice", t: t + 1, b, v, beats: lo }, { k: "setVoice", t, b, v, beats: hi });
  }));
  // La parte grave se lee mejor en clave de Fa.
  ops.push({ k: "trackProp", t: t + 1, prop: "clef", val: "F4" });
  return { ops, low, high };
}
