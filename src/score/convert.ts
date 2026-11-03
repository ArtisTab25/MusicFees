// Convertir una pista a cualquier otro instrumento, aunque sea de otro tipo: una guitarra a piano (para
// oírla y leerla en partitura de teclado), un piano o una voz a guitarra (para verla en tablatura). Las
// notas se conservan; al pasar a un instrumento de cuerdas se elige la afinación que mejor acomoda la
// parte, lo que no cabe se mueve de octava y la digitación sale del mismo algoritmo del transcriptor.
// Todo son operaciones normales (deshacer y el dúo en vivo funcionan igual).
import type * as at from "@coderline/alphatab";
import { beatToClip, fxMap, kindOf, metaMap, type ClipBeat, type Op } from "./model";
import { presetById, TUNINGS } from "./instruments";
import { chooseTuning, fretEvents } from "../transcribe/fretting";

type Score = at.model.Score;

export interface ConvertResult { ops: Op[]; error?: string; tuningName?: string; moved: number; dropped: number }

export function planConvert(score: Score, t: number, presetId: string, keepSound: boolean): ConvertResult {
  const tr = score.tracks[t], p = presetById(presetId);
  if (!tr || !p) return { ops: [], error: "No encontré ese instrumento.", moved: 0, dropped: 0 };
  const from = kindOf(tr);
  if ((from === "drums") !== (p.kind === "drums"))
    return { ops: [], error: from === "drums" ? "La batería no tiene alturas: para verla en números usa «Tablatura de texto»." : "Una parte con alturas no se puede volver batería.", moved: 0, dropped: 0 };
  // Lo escrito, voz por voz y compás por compás, sin depender del instrumento.
  const voices: { b: number; v: number; beats: ClipBeat[] }[] = [];
  tr.staves[0].bars.forEach((bar, b) => bar.voices.forEach((voice, v) => {
    if (voice.isEmpty) return;
    voices.push({ b, v, beats: voice.beats.map((x) => beatToClip(tr, x)) });
  }));
  let tuning: number[] | undefined, tuningName: string | undefined, moved = 0, dropped = 0;
  const ptun = p.tuning ?? [];
  if (p.kind === "tab" && ptun.length) {
    // Afinación: entre las del mismo número de cuerdas, la que deja la parte más cómoda.
    const all = voices.flatMap((x) => x.beats.map((cb) => cb.notes.map((n) => n.pitch).filter((q): q is number => q != null)));
    const options = [{ id: "preset", strings: ptun }, ...Object.entries(TUNINGS).filter(([, x]) => x.strings.length === ptun.length && x.strings.join() !== ptun.join()).map(([id, x]) => ({ id, strings: x.strings }))];
    const best = chooseTuning(all, options);
    tuning = best.strings;
    tuningName = best.id === "preset" ? undefined : TUNINGS[best.id]?.name;
    const lo = Math.min(...tuning), hi = Math.max(...tuning) + 22;
    for (const x of voices) {
      const events = x.beats.map((cb) => cb.notes.map((n) => n.pitch).filter((q): q is number => q != null));
      for (const ev of events) for (const q of ev) if (q < lo || q > hi) moved++;
      const r = fretEvents(events, tuning);
      dropped += r.dropped;
      x.beats = x.beats.map((cb, i) => {
        const placed = r.placed[i] ?? [];
        const fxOf = (pitch: number) => cb.notes.find((n) => n.pitch != null && (n.pitch - pitch) % 12 === 0) ?? cb.notes[0];
        return { ...cb, notes: placed.map((pl) => { const src = fxOf(pl.pitch); return { pitch: pl.pitch, str: pl.str, fret: pl.fret, fx: src?.fx ?? [], bend: src?.bend }; }) };
      });
    }
  } else if (p.kind !== "drums") {
    // A partitura: solo alturas (sin cuerda ni traste).
    for (const x of voices) x.beats = x.beats.map((cb) => ({ ...cb, notes: cb.notes.map((n) => ({ pitch: n.pitch, fx: n.fx.filter((f) => f !== "palmMute" && f !== "dead" && f !== "harmonic"), bend: n.bend })) }));
  }
  const N = score.tracks.length;
  const ops: Op[] = [{ k: "trackAdd", preset: p.id, name: tr.name, tuning }];
  if (keepSound && from !== "drums") ops.push({ k: "trackProp", t: N, prop: "program", val: tr.playbackInfo.program });
  for (const x of voices) ops.push({ k: "setVoice", t: N, b: x.b, v: x.v, beats: x.beats });
  const fx = fxMap(score)[t];
  if (fx) ops.push({ k: "trackFx", t: N, fx });
  const meta = metaMap(score)[t];
  if (meta?.color) ops.push({ k: "trackMeta", t: N, meta: { color: meta.color } });
  ops.push({ k: "trackDel", t }, { k: "trackMove", t: N - 1, to: t });
  return { ops, tuningName, moved, dropped };
}
