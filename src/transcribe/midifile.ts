// Importar un archivo MIDI (por ejemplo, el que exporta NeuralNote con MuScriptor en tu computadora) y
// convertirlo en un análisis de MusicFees: una parte por pista/instrumento, con tonalidad, acordes,
// secciones y, después, tablatura con la digitación más cómoda. Lector de MIDI propio (formato 0 y 1).
import { analyzeNotes } from "./analyze";
import { estimateTempo, trackBeats } from "./rhythm";
import type { Analysis, Part, RawNote, Role } from "./types";

export interface MidiTrack { name: string; channel: number; program: number; notes: RawNote[] }
export interface MidiSong { tracks: MidiTrack[]; tempoBpm: number; /** Compás del archivo (numerador), si lo trae. */ meter?: number; /** Tiempos (negras) en segundos según el mapa de tempo del archivo. */ beats: number[]; duration: number; ppq: number; aligned: boolean }

export function parseMidi(buf: ArrayBuffer | Uint8Array): MidiSong {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let p = 0;
  const u32 = () => { const v = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]; p += 4; return v >>> 0; };
  const u16 = () => { const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const str = (n: number) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); p += n; return s; };
  const vlq = () => { let v = 0, c = 0; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < b.length); return v; };
  if (str(4) !== "MThd") throw new Error("No es un archivo MIDI.");
  const hl = u32(); u16(); const ntr = u16(); const div = u16(); p += hl - 6;
  if (div & 0x8000) throw new Error("MIDI con tiempo SMPTE: no está soportado.");
  const ppq = div || 480;
  type Ev = { tick: number; kind: "on" | "off" | "prog" | "tempo" | "name" | "ts"; ch: number; key: number; vel: number; tr: number; val: number; text?: string };
  const evs: Ev[] = [];
  for (let t = 0; t < ntr && p < b.length; t++) {
    if (str(4) !== "MTrk") { p -= 4; break; }
    const len = u32(), end = p + len;
    let tick = 0, run = 0;
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++; else st = run;
      if (st === 0xff) {
        const type = b[p++], l = vlq();
        if (type === 0x51 && l === 3) evs.push({ tick, kind: "tempo", ch: 0, key: 0, vel: 0, tr: t, val: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
        else if (type === 0x58 && l >= 2) evs.push({ tick, kind: "ts", ch: 0, key: 0, vel: 0, tr: t, val: b[p] });
        else if (type === 0x03) { const q = p; evs.push({ tick, kind: "name", ch: 0, key: 0, vel: 0, tr: t, val: 0, text: str(l) }); p = q; }
        p += l; continue;
      }
      if (st === 0xf0 || st === 0xf7) { p += vlq(); continue; }
      run = st;
      const hi = st & 0xf0, ch = st & 0x0f;
      const d1 = b[p++], d2 = hi === 0xc0 || hi === 0xd0 ? 0 : b[p++];
      if (hi === 0x90 && d2 > 0) evs.push({ tick, kind: "on", ch, key: d1, vel: d2, tr: t, val: 0 });
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) evs.push({ tick, kind: "off", ch, key: d1, vel: 0, tr: t, val: 0 });
      else if (hi === 0xc0) evs.push({ tick, kind: "prog", ch, key: 0, vel: 0, tr: t, val: d1 });
    }
    p = end;
  }
  evs.sort((x, y) => x.tick - y.tick || (x.kind === "off" ? -1 : 0) - (y.kind === "off" ? -1 : 0));
  // Mapa de tempo → segundos
  const tempos: [number, number][] = [[0, 500000]];
  for (const e of evs) if (e.kind === "tempo") { if (e.tick === 0) tempos[0][1] = e.val; else tempos.push([e.tick, e.val]); }
  const sec = (tick: number) => { let s = 0, last = 0, us = tempos[0][1]; for (const [tk, v] of tempos) { if (tk > tick) break; s += ((tk - last) / ppq) * us / 1e6; last = tk; us = v; } return s + ((tick - last) / ppq) * us / 1e6; };
  // Notas por pista + canal
  const groups = new Map<string, MidiTrack>();
  const names = new Map<number, string>();
  const prog = new Map<number, number>();
  const open = new Map<string, Ev>();
  let lastTick = 0;
  const onTicks: number[] = [];
  for (const e of evs) {
    lastTick = Math.max(lastTick, e.tick);
    if (e.kind === "name") { if (!names.has(e.tr) && e.text?.trim()) names.set(e.tr, e.text.trim()); continue; }
    if (e.kind === "prog") { prog.set(e.ch, e.val); continue; }
    if (e.kind === "on") { open.set(`${e.tr}:${e.ch}:${e.key}`, e); onTicks.push(e.tick); continue; }
    if (e.kind === "off") {
      const k = `${e.tr}:${e.ch}:${e.key}`, o = open.get(k);
      if (!o) continue;
      open.delete(k);
      const gk = `${e.tr}:${e.ch}:${e.ch === 9 ? 128 : prog.get(e.ch) ?? 0}`;
      let g = groups.get(gk);
      if (!g) { g = { name: names.get(e.tr) ?? "", channel: e.ch, program: e.ch === 9 ? 128 : prog.get(e.ch) ?? 0, notes: [] }; groups.set(gk, g); }
      g.notes.push({ s: sec(o.tick), e: Math.max(sec(e.tick), sec(o.tick) + 0.03), p: o.key, a: o.vel / 127 });
    }
  }
  const duration = sec(lastTick) + 0.5;
  const beats: number[] = [];
  for (let tk = 0; sec(tk) <= duration; tk += ppq) beats.push(sec(tk));
  // ¿Las notas siguen la rejilla del archivo? (un MIDI transcrito sin cuantizar suele venir a 120 fijo)
  const step = ppq / 4;
  const near = onTicks.filter((tk) => { const r = (tk % step) / step; return r < 0.08 || r > 0.92; }).length;
  const aligned = onTicks.length > 0 && near / onTicks.length >= 0.8;
  const ts = evs.find((e) => e.kind === "ts");
  return { tracks: [...groups.values()].filter((g) => g.notes.length), tempoBpm: 60e6 / tempos[0][1], meter: ts?.val, beats, duration, ppq, aligned };
}

/** Papel de una pista según su instrumento General MIDI. */
export function roleOfProgram(program: number, notes: RawNote[]): Role {
  if (program === 128) return "drums";
  if (program >= 32 && program <= 39) return "bass";
  if (program >= 24 && program <= 31) return "guitar";
  if (program <= 23 || (program >= 88 && program <= 103)) return "keys";
  if (program === 43 || program === 58) return "bass"; // contrabajo, tuba
  const ps = notes.map((n) => n.p).sort((a, b) => a - b), med = ps[ps.length >> 1] ?? 60;
  // ¿Una sola nota a la vez? Línea melódica (vientos, cuerdas, voz, sinte lead).
  let poly = 0; const ev = [...notes].sort((a, b) => a.s - b.s);
  for (let i = 1; i < ev.length; i++) if (ev[i].s - ev[i - 1].s < 0.03) poly++;
  if (med < 45) return "bass";
  return poly / Math.max(1, ev.length) > 0.25 ? "keys" : "melody";
}

/** MIDI → análisis completo de MusicFees (tempo, compás, tonalidad, acordes, secciones) con una parte por pista. */
export function midiToAnalysis(song: MidiSong, presetFor: (program: number, role: Role) => string | undefined, nameFor: (preset: string | undefined, role: Role) => string | undefined = () => undefined): Analysis {
  const pitched = song.tracks.filter((t) => t.program !== 128).flatMap((t) => t.notes);
  const drums = song.tracks.filter((t) => t.program === 128).flatMap((t) => t.notes);
  let beats = song.beats, tempo = song.tempoBpm;
  if (!song.aligned) {
    // Sin rejilla útil: el pulso se busca en los propios ataques de las notas.
    const fps = 100, n = Math.ceil(song.duration * fps) + 1, env = new Float32Array(n);
    for (const x of [...pitched, ...drums]) { const i = Math.round(x.s * fps); for (let k = 0; k < 3 && i + k < n; k++) env[i + k] += x.a * (1 - k / 3); }
    const tp = estimateTempo(env, fps);
    const bt = trackBeats(env, fps, tp.bpm);
    if (bt.length >= 8) { beats = bt; tempo = tp.bpm; }
  }
  // Si el archivo trae compás y sus tiempos son confiables, se respeta (3/4 o 4/4; 6/8 se lee como 3).
  const meter = song.aligned && song.meter ? (song.meter % 3 === 0 && song.meter !== 12 ? 3 : 4) as 3 | 4 : undefined;
  const base = analyzeNotes({ notes: pitched, drums, beats, duration: song.duration, tempo, mode: "solo", meter, downbeat: meter ? 0 : undefined });
  const parts: Part[] = song.tracks.map((t) => {
    const role = roleOfProgram(t.program, t.notes);
    const preset = presetFor(t.program, role);
    return { role, notes: [...t.notes].sort((a, b) => a.s - b.s), name: t.name || nameFor(preset, role), preset };
  });
  // Mismo nombre para varias pistas: se numeran.
  const seen = new Map<string, number>();
  for (const p of parts) { if (!p.name) continue; const k = p.name; const c = (seen.get(k) ?? 0) + 1; seen.set(k, c); if (c > 1) p.name = `${k} ${c}`; }
  return { ...base, parts, notesForUser: [...base.notesForUser, ...(song.aligned ? [] : ["El MIDI no traía un tempo que coincida con las notas: el pulso se calculó con los ataques. Revisa el tempo y el compás."])] };
}
