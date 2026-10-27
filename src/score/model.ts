// Modelo de la canción sobre alphaTab y operaciones de edición deterministas.
// Cada cambio es una operación serializable: se aplica local y se envía tal cual al dúo.
import * as at from "@coderline/alphatab";
import { PRESETS, presetById, styleById, TUNINGS, type Preset } from "./instruments";

type Score = at.model.Score;
type Track = at.model.Track;
type Beat = at.model.Beat;
type Note = at.model.Note;
const M = at.model;

export const settings = new at.Settings();

export type Kind = "tab" | "notation" | "drums";
export interface BeatRef { t: number; b: number; v: number; i: number }
export type NoteKey = { str?: number; pitch?: number; art?: number };

export type Op =
  | ({ k: "fret"; str: number; fret: number; len?: number } & BeatRef)
  | ({ k: "pitch"; pitch: number; on: boolean } & BeatRef)
  | ({ k: "perc"; art: number; on: boolean } & BeatRef)
  | ({ k: "delNote" } & BeatRef & NoteKey)
  | ({ k: "insBeat"; dur: number; dots?: number } & Omit<BeatRef, "i"> & { after: number })
  | ({ k: "delBeat" } & BeatRef)
  | ({ k: "clear" } & BeatRef)
  | ({ k: "dur"; dur: number } & BeatRef)
  | ({ k: "dots"; n: number } & BeatRef)
  | ({ k: "tuplet"; n: number } & BeatRef)
  | ({ k: "noteFx"; fx: NoteFx; on: boolean } & BeatRef & NoteKey)
  | ({ k: "beatFx"; fx: BeatFx; val: number | string | boolean | null } & BeatRef)
  | ({ k: "dynFrom"; val: number } & BeatRef)
  | { k: "barIns"; at: number }
  | { k: "barDel"; at: number }
  | { k: "barProp"; b: number; prop: BarProp; val: number | string | boolean | null }
  | { k: "trackAdd"; preset: string; name?: string; tuning?: number[] }
  | { k: "trackDel"; t: number }
  | { k: "trackMove"; t: number; to: number }
  | { k: "trackProp"; t: number; prop: TrackProp; val: unknown }
  | { k: "songProp"; prop: SongProp; val: string | number }
  | { k: "chordDef"; t: number; id: string; name: string; frets: number[] }
  | { k: "lyrics"; t: number; text: string }
  | { k: "voices"; t: number; n: number }
  | { k: "load"; json: string }
  /** Reescribe una voz completa de un compás (pegar, cortar, transponer). Notas con altura real. */
  | { k: "setVoice"; t: number; b: number; v: number; beats: ClipBeat[] }
  /** Efectos de una pista (null = sin efectos). Viajan con la canción. */
  | { k: "trackFx"; t: number; fx: TrackFx | null }
  | ({ k: "bend"; str: number; shape: BendShape } & BeatRef)
  /** Cambios de tempo de un compás: posición dentro del compás (0–1) y bpm. Lista vacía = sin cambios. */
  | { k: "tempo"; b: number; list: { r: number; bpm: number }[] }
  /** Masterizado de la canción (null = sin masterizar). */
  | { k: "master"; fx: MasterFx | null }
  // Menú de pista
  | { k: "trackDup"; t: number; empty?: boolean }
  | { k: "retune"; t: number; tuning: number[] }
  | { k: "trackMeta"; t: number; meta: Partial<TrackMeta> }
  | { k: "trackPaste"; json: string; name?: string }
  // Colaboración: comentario por compás (con id: agregar o reemplazar; del: quitar) y propuestas
  | { k: "comment"; c?: BarComment; del?: string }
  | { k: "proposal"; p?: Proposal; del?: string };

/** Formas de bend que se escriben con un toque (valores en cuartos de tono: 4 = un tono). */
export type BendShape = "none" | "half" | "full" | "oneHalf" | "double" | "release" | "prebend" | "prebendRelease";
const BEND_SHAPES: Record<Exclude<BendShape, "none">, { type: number; pts: [number, number][] }> = {
  half: { type: M.BendType.Bend, pts: [[0, 0], [15, 2], [60, 2]] },
  full: { type: M.BendType.Bend, pts: [[0, 0], [15, 4], [60, 4]] },
  oneHalf: { type: M.BendType.Bend, pts: [[0, 0], [15, 6], [60, 6]] },
  double: { type: M.BendType.Bend, pts: [[0, 0], [15, 8], [60, 8]] },
  release: { type: M.BendType.BendRelease, pts: [[0, 0], [12, 4], [30, 4], [45, 0], [60, 0]] },
  prebend: { type: M.BendType.Prebend, pts: [[0, 4], [60, 4]] },
  prebendRelease: { type: M.BendType.PrebendRelease, pts: [[0, 4], [30, 4], [60, 0]] },
};
export function setBend(n: Note, shape: BendShape) {
  n.bendPoints = null;
  n.bendType = M.BendType.None;
  if (shape === "none") return;
  const s = BEND_SHAPES[shape];
  for (const [o, v] of s.pts) n.addBendPoint(new M.BendPoint(o, v));
  n.bendType = s.type as at.model.BendType;
}
/** Reconoce la forma del bend de una nota (para resaltar el botón). */
export function bendShapeOf(n: Note | null): BendShape {
  if (!n?.hasBend || !n.bendPoints) return "none";
  const pts = n.bendPoints.map((p) => [p.offset, p.value]);
  for (const [k, s] of Object.entries(BEND_SHAPES)) if (JSON.stringify(s.pts) === JSON.stringify(pts)) return k as BendShape;
  return "full";
}

/** Cadena de efectos de una pista. Escalas de 0 a 10 (EQ: 5 = plano). `pedals`: efectos extra en serie (Tone.js). */
export interface TrackFx { preset: string; drive: number; low: number; mid: number; high: number; comp: number; chorus: number; delay: number; reverb: number; pedals?: Pedal[]; plugins?: PluginRef[] }
/** Plugin WAM 2.0 de terceros: dirección de su módulo (del catálogo o externa) y su estado guardado. */
export interface PluginRef { src: string; name: string; state?: unknown }
export type PedalType = "phaser" | "tremolo" | "wah" | "autofilter" | "vibrato" | "pingpong" | "octave" | "widener" | "autopan" | "harmonic" | "spring";
/** Un pedal: mezcla (0–10) y dos perillas (0–10) cuyo significado depende del tipo. */
export interface Pedal { type: PedalType; mix: number; a: number; b: number }
/** Masterizado: EQ (5 = plano), pegamento (compresión), ancho estéreo (5 = normal), volumen final y techo. */
export interface MasterFx { preset: string; low: number; mid: number; high: number; glue: number; width: number; loud: number }
// alphaTab no guarda campos propios: los efectos van en «notices» de la canción, en una línea marcada.
const FX_TAG = "MFFX1:", MS_TAG = "MFMS1:";
export function masterOf(score: Score): MasterFx | null {
  const line = (score.notices || "").split("\n").find((l) => l.startsWith(MS_TAG));
  if (!line) return null;
  try { return JSON.parse(line.slice(MS_TAG.length)) as MasterFx; } catch { return null; }
}
function writeMaster(score: Score, m: MasterFx | null) {
  const rest = (score.notices || "").split("\n").filter((l) => l && !l.startsWith(MS_TAG));
  if (m) rest.push(MS_TAG + JSON.stringify(m));
  score.notices = rest.join("\n");
}
export function fxMap(score: Score): Record<number, TrackFx> {
  const line = (score.notices || "").split("\n").find((l) => l.startsWith(FX_TAG));
  if (!line) return {};
  try { return JSON.parse(line.slice(FX_TAG.length)) as Record<number, TrackFx>; } catch { return {}; }
}
function writeFx(score: Score, map: Record<number, TrackFx>) {
  const rest = (score.notices || "").split("\n").filter((l) => l && !l.startsWith(FX_TAG));
  if (Object.keys(map).length) rest.push(FX_TAG + JSON.stringify(map));
  score.notices = rest.join("\n");
}

// ---------- datos extra por pista (kit de batería, color, bloqueo) ----------
// alphaTab no guarda estas cosas (y fuerza el programa 0 en la batería), así que viven en `notices`.
const TM_TAG = "MFTM1:";
export interface TrackMeta { kit?: number; color?: string; locked?: boolean }
export function metaMap(score: Score): Record<number, TrackMeta> {
  const line = (score.notices || "").split("\n").find((l) => l.startsWith(TM_TAG));
  if (!line) return {};
  try { return JSON.parse(line.slice(TM_TAG.length)) as Record<number, TrackMeta>; } catch { return {}; }
}
function writeMeta(score: Score, map: Record<number, TrackMeta>) {
  const rest = (score.notices || "").split("\n").filter((l) => l && !l.startsWith(TM_TAG));
  for (const k of Object.keys(map)) if (!Object.keys(map[Number(k)]).length) delete map[Number(k)];
  if (Object.keys(map).length) rest.push(TM_TAG + JSON.stringify(map));
  score.notices = rest.join("\n");
}
export function setMeta(score: Score, t: number, patch: Partial<TrackMeta>) {
  const map = metaMap(score);
  const cur = { ...(map[t] ?? {}), ...patch };
  for (const [k, v] of Object.entries(cur)) if (v === undefined || v === null || v === false) delete (cur as Record<string, unknown>)[k];
  map[t] = cur;
  writeMeta(score, map);
}
/** Kit de batería de una pista (programa GM del kit), si se eligió uno distinto del estándar. */
export const drumKit = (score: Score, t: number) => (score.tracks[t]?.isPercussion ? metaMap(score)[t]?.kit : undefined);
/** Reacomoda los datos por pista cuando cambian los índices (borrar, mover, duplicar). */
function remapTrackData(score: Score, newIndexOf: (old: number) => number | null) {
  const move = <T,>(map: Record<number, T>) => {
    const next: Record<number, T> = {};
    for (const [k, v] of Object.entries(map)) { const n = newIndexOf(Number(k)); if (n !== null) next[n] = v; }
    return next;
  };
  writeFx(score, move(fxMap(score)));
  writeMeta(score, move(metaMap(score)));
}

// ---------- comentarios por compás y propuestas (viajan con la canción y con el dúo) ----------
const CM_TAG = "MFCM1:", PR_TAG = "MFPR1:";
export interface BarComment { id: string; b: number; text: string; by: string; at: number; done?: boolean }
export interface Proposal { id: string; title: string; by: string; at: number; ops: Op[]; bars: number; tracks: number }
function readTag<T>(score: Score, tag: string, empty: T): T {
  const line = (score.notices || "").split("\n").find((l) => l.startsWith(tag));
  if (!line) return empty;
  try { return JSON.parse(line.slice(tag.length)) as T; } catch { return empty; }
}
function writeTag(score: Score, tag: string, val: unknown[]) {
  const rest = (score.notices || "").split("\n").filter((l) => l && !l.startsWith(tag));
  if (val.length) rest.push(tag + JSON.stringify(val));
  score.notices = rest.join("\n");
}
export const comments = (score: Score) => readTag<BarComment[]>(score, CM_TAG, []);
export const proposals = (score: Score) => readTag<Proposal[]>(score, PR_TAG, []);
/** Al insertar o borrar compases, los comentarios siguen a su compás (los del compás borrado se van). */
function shiftComments(score: Score, at: number, d: 1 | -1) {
  const list = comments(score);
  if (!list.length) return;
  writeTag(score, CM_TAG, list.filter((c) => !(d < 0 && c.b === at)).map((c) => (c.b >= at + (d < 0 ? 1 : 0) ? { ...c, b: c.b + d } : c)));
}

/** Nota independiente del instrumento: altura real (o pieza de batería por su número MIDI). */
export interface ClipNote { pitch?: number; str?: number; fret?: number; drum?: number; fx: NoteFx[]; bend?: { type: number; pts: [number, number][] } }
/** Tiempo independiente del instrumento, para el portapapeles y la operación setVoice. */
export interface ClipBeat { dur: number; dots: number; tup: number; notes: ClipNote[]; text?: string | null; dyn?: number }
export const NOTE_FX_ALL: NoteFx[] = ["hammer", "slide", "bend", "vibrato", "palmMute", "letRing", "dead", "ghost", "accent", "heavyAccent", "harmonic", "staccato", "tie"];

export type NoteFx = "hammer" | "slide" | "bend" | "vibrato" | "palmMute" | "letRing" | "dead" | "ghost" | "accent" | "heavyAccent" | "harmonic" | "staccato" | "tie";
export type BeatFx = "dynamics" | "crescendo" | "tap" | "slap" | "pop" | "text" | "chord" | "pickStroke" | "fadeIn" | "brush" | "vibratoBeat";
export type BarProp = "ts" | "repeatOpen" | "repeatClose" | "section" | "tempo" | "doubleBar" | "key" | "alternate";
export type TrackProp = "name" | "program" | "tuning" | "capo" | "clef" | "volume" | "balance" | "showTab" | "showNotation" | "color" | "mute" | "solo";
export type SongProp = "title" | "artist" | "album" | "words" | "music" | "tempo";

// ---------- utilidades ----------
const NOTE_TEX = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
export const texPitch = (m: number) => NOTE_TEX[m % 12] + (Math.floor(m / 12) - 1);
const esc = (s: string) => s.replace(/\\/g, "").replace(/"/g, "'");

export function kindOf(track: Track): Kind {
  const st = track.staves[0];
  if (st.isPercussion) return "drums";
  if (st.isStringed && st.tuning.length > 0) return "tab";
  return "notation";
}
export const trackTuning = (track: Track) => track.staves[0].tuning.slice(); // aguda → grave
/** Fila visual (0 = cuerda más aguda) a número de cuerda de alphaTab (1 = la más grave). */
export const rowToString = (track: Track, row: number) => track.staves[0].tuning.length - row;
export const stringToRow = (track: Track, str: number) => track.staves[0].tuning.length - str;

export function beatAt(score: Score, r: BeatRef): Beat | null {
  const tr = score.tracks[r.t];
  const bar = tr?.staves[0]?.bars[r.b];
  const voice = bar?.voices[r.v];
  return voice?.beats[r.i] ?? null;
}
export const refOf = (beat: Beat): BeatRef => ({
  t: beat.voice.bar.staff.track.index,
  b: beat.voice.bar.index,
  v: beat.voice.index,
  i: beat.index,
});
function findNote(beat: Beat, k: NoteKey): Note | null {
  if (k.str != null) return beat.notes.find((n) => n.string === k.str) ?? null;
  if (k.art != null) return beat.notes.find((n) => n.percussionArticulation === k.art) ?? null;
  if (k.pitch != null) return beat.notes.find((n) => n.realValue === k.pitch) ?? null;
  return null;
}
function newRestBeat(dur: number, dots = 0): Beat {
  const b = new M.Beat();
  b.duration = dur as at.model.Duration;
  b.dots = dots;
  b.isEmpty = false;
  return b;
}
function relinkBeats(voice: at.model.Voice) {
  const beats = voice.beats.slice();
  voice.beats.length = 0;
  for (const b of beats) {
    b.previousBeat = null;
    b.nextBeat = null;
    voice.addBeat(b);
  }
}
// En alphaTab realValue = octave × 12 + tone. Antes se restaba 1 a la octava y cada nota de teclado
// sonaba y se escribía una octava abajo de la tecla tocada (y tocarla otra vez no la quitaba).
function setPitchOnNote(n: Note, midi: number) {
  n.octave = Math.floor(midi / 12);
  n.tone = midi % 12;
}

// ---------- portapapeles: del modelo de alphaTab a tiempos neutros y de vuelta ----------
/** Altura real de una cuerda (sin capo): la afinación va de aguda a grave y la cuerda 1 es la más grave. */
const stringPitch = (track: Track, str: number) => track.staves[0].tuning[track.staves[0].tuning.length - str];

export function beatToClip(track: Track, beat: Beat): ClipBeat {
  const kind = kindOf(track);
  return {
    dur: beat.duration, dots: beat.dots, tup: beat.hasTuplet ? beat.tupletNumerator : 0,
    text: beat.text ?? null, dyn: dynIndex(beat.dynamics),
    notes: beat.notes.map((n) => {
      const fx = NOTE_FX_ALL.filter((f) => f !== "bend" && noteFxState(n, f));
      const bend = n.hasBend && n.bendPoints ? { type: n.bendType as number, pts: n.bendPoints.map((p) => [p.offset, p.value] as [number, number]) } : undefined;
      if (kind === "drums") return { drum: track.percussionArticulations[n.percussionArticulation]?.outputMidiNumber ?? n.percussionArticulation, fx };
      if (kind === "tab") return { pitch: stringPitch(track, n.string) + n.fret, str: n.string, fret: n.fret, fx, bend };
      return { pitch: n.realValue, fx, bend };
    }),
  };
}

/** Cuerda y traste para una altura: respeta la cuerda original si se puede; si no, la posición más cercana. */
function placeOnStrings(track: Track, cn: ClipNote, taken: Set<number>): { str: number; fret: number } | null {
  const n = track.staves[0].tuning.length;
  if (cn.pitch == null) return null;
  if (cn.str != null && cn.str >= 1 && cn.str <= n && !taken.has(cn.str)) {
    const f = cn.pitch - stringPitch(track, cn.str);
    if (f >= 0 && f <= 24) return { str: cn.str, fret: f };
  }
  let best: { str: number; fret: number } | null = null;
  const want = cn.fret ?? 3;
  for (let s = 1; s <= n; s++) {
    if (taken.has(s)) continue;
    const f = cn.pitch - stringPitch(track, s);
    if (f < 0 || f > 24) continue;
    if (!best || Math.abs(f - want) < Math.abs(best.fret - want)) best = { str: s, fret: f };
  }
  return best;
}

/** Construye un tiempo de alphaTab para la pista destino. Las notas que no caben (fuera de rango, batería ↔ melodía) se omiten. */
function clipToBeat(track: Track, cb: ClipBeat): Beat {
  const b = newRestBeat(cb.dur, cb.dots);
  if (cb.tup > 1) { b.tupletNumerator = cb.tup; b.tupletDenominator = cb.tup === 3 ? 2 : 4; }
  if (cb.text) b.text = cb.text;
  if (cb.dyn != null) b.dynamics = dynValue(cb.dyn);
  const kind = kindOf(track);
  const taken = new Set<number>(), pitches = new Set<number>();
  // De aguda a grave: las notas altas toman primero las cuerdas agudas.
  for (const cn of cb.notes.slice().sort((x, y) => (y.pitch ?? 0) - (x.pitch ?? 0))) {
    const n = new M.Note();
    if (kind === "drums") {
      if (cn.drum == null) continue;
      const idx = track.percussionArticulations.findIndex((a) => a.outputMidiNumber === cn.drum);
      if (idx < 0) continue;
      n.percussionArticulation = idx;
    } else if (kind === "tab") {
      const p = placeOnStrings(track, cn, taken);
      if (!p) continue;
      taken.add(p.str);
      n.string = p.str;
      n.fret = p.fret;
    } else {
      if (cn.pitch == null || pitches.has(cn.pitch)) continue;
      pitches.add(cn.pitch);
      setPitchOnNote(n, cn.pitch);
    }
    n.dynamics = b.dynamics;
    b.addNote(n);
    for (const fx of cn.fx) applyNoteFx(n, fx, true);
    if (cn.bend && kind !== "drums") { for (const [o, v] of cn.bend.pts) n.addBendPoint(new M.BendPoint(o, v)); n.bendType = cn.bend.type as at.model.BendType; }
  }
  return b;
}

// ---------- creación ----------
function trackTex(p: Preset, name: string, tuning: number[] | undefined, bars: number) {
  const rest = Array.from({ length: bars }, () => "r.1").join(" | ");
  if (p.kind === "drums") {
    const chord = `(${(p.kit ?? [38, 36, 42]).join(" ")}).1`;
    const restB = bars > 1 ? " | " + Array.from({ length: bars - 1 }, () => "r.1").join(" | ") : "";
    return `\\track "${esc(name)}" \\staff {score} \\instrument percussion \\articulation defaults ${chord}${restB} |`;
  }
  if (p.kind === "tab") {
    const tun = (tuning ?? p.tuning ?? TUNINGS.std.strings).map(texPitch).join(" ");
    return `\\track "${esc(name)}" \\staff {${p.notation ? "score tabs" : "tabs"}} \\tuning ${tun} \\instrument ${p.program} ${rest} |`;
  }
  return `\\track "${esc(name)}" \\staff {score} \\instrument ${p.program} ${rest} |`;
}
/** Ajustes que alphaTex no expresa: kit, clave, transposición, notas de plantilla. */
function finishTrack(track: Track, p: Preset) {
  const st = track.staves[0];
  track.playbackInfo.program = p.program;
  if (p.kind === "drums") {
    // El primer compás traía todas las piezas para registrar las articulaciones: se vacía.
    const beat = st.bars[0].voices[0].beats[0];
    for (const n of beat.notes.slice()) beat.removeNote(n);
  }
  if (p.kind === "notation" && p.clef === "F") for (const bar of st.bars) bar.clef = M.Clef.F4;
  if (p.transpose) st.displayTranspositionPitch = -p.transpose;
  (track as unknown as { __preset?: string }).__preset = p.id;
}

export function createSong(styleId = "blank_gtr", bars = 8, title = "Sin título"): Score {
  const style = styleById(styleId) ?? styleById("blank_gtr")!;
  let tex = `\\title "${esc(title)}" \\tempo ${style.tempo} `;
  const ps: Preset[] = [];
  for (const t of style.tracks) {
    const p = presetById(t.preset)!;
    ps.push(p);
    tex += trackTex(p, t.name, t.tuning ? TUNINGS[t.tuning].strings : undefined, bars) + " ";
  }
  const score = at.importer.ScoreLoader.loadAlphaTex(tex, settings);
  score.tracks.forEach((tr, i) => finishTrack(tr, ps[i]));
  assignChannels(score);
  ps.forEach((p, i) => { if (p.kind === "drums" && p.program) setMeta(score, i, { kit: p.program }); });
  finishScore(score);
  return score;
}

/** Canales MIDI únicos por pista (el 9 es de la batería). */
function assignChannels(score: Score) {
  let ch = 0;
  for (const tr of score.tracks) {
    if (tr.staves[0].isPercussion) {
      tr.playbackInfo.primaryChannel = 9;
      tr.playbackInfo.secondaryChannel = 9;
      continue;
    }
    if (ch === 9) ch++;
    tr.playbackInfo.primaryChannel = ch % 16;
    ch++;
    if (ch === 9) ch++;
    tr.playbackInfo.secondaryChannel = ch % 16;
    ch++;
  }
}

function addTrack(score: Score, presetId: string, name?: string, tuning?: number[]) {
  const p = presetById(presetId) ?? PRESETS[0];
  const bars = score.masterBars.length;
  const tex = `\\title "x" ` + trackTex(p, name ?? p.name, tuning, bars);
  const tmp = at.importer.ScoreLoader.loadAlphaTex(tex, settings);
  const tr = tmp.tracks[0];
  finishTrack(tr, p);
  // Trasplantar la pista al score actual (sus compases ya coinciden en número).
  tr.score = score;
  score.addTrack(tr);
  assignChannels(score);
  if (p.kind === "drums" && p.program) setMeta(score, tr.index, { kit: p.program });
}

// ---------- compases ----------
function rebuildBars(score: Score, masterBars: at.model.MasterBar[], perStaff: Map<at.model.Staff, at.model.Bar[]>) {
  score.masterBars.length = 0;
  for (const mb of masterBars) {
    mb.previousMasterBar = null;
    mb.nextMasterBar = null;
    score.addMasterBar(mb);
  }
  for (const [staff, bars] of perStaff) {
    staff.bars.length = 0;
    for (const b of bars) {
      b.previousBar = null;
      b.nextBar = null;
      staff.addBar(b);
    }
  }
}
function insertBar(score: Score, atIndex: number) {
  const idx = Math.max(0, Math.min(atIndex, score.masterBars.length));
  shiftComments(score, idx, 1);
  const ref = score.masterBars[Math.max(0, idx - 1)];
  const mb = new M.MasterBar();
  if (ref) {
    mb.timeSignatureNumerator = ref.timeSignatureNumerator;
    mb.timeSignatureDenominator = ref.timeSignatureDenominator;
    mb.tripletFeel = ref.tripletFeel;
  }
  const mbs = score.masterBars.slice();
  mbs.splice(idx, 0, mb);
  const per = new Map<at.model.Staff, at.model.Bar[]>();
  for (const tr of score.tracks)
    for (const st of tr.staves) {
      const prev = st.bars[Math.max(0, idx - 1)];
      const bar = new M.Bar();
      if (prev) {
        bar.clef = prev.clef;
        bar.keySignature = prev.keySignature;
        bar.keySignatureType = prev.keySignatureType;
      }
      // Mismas voces que el compás vecino (Guitar Pro trae hasta 4): si no, alphaTab no puede
      // encadenar las voces de un compás al siguiente y falla al dibujar o al tocar.
      const nv = Math.max(1, prev?.voices.length ?? st.bars[idx]?.voices.length ?? 1);
      for (let k = 0; k < nv; k++) {
        const v = new M.Voice();
        bar.addVoice(v);
        const r = newRestBeat(M.Duration.Whole);
        if (k > 0) r.isEmpty = true;
        v.addBeat(r);
      }
      const list = st.bars.slice();
      list.splice(idx, 0, bar);
      per.set(st, list);
    }
  rebuildBars(score, mbs, per);
}
function deleteBar(score: Score, atIndex: number) {
  if (score.masterBars.length <= 1 || atIndex < 0 || atIndex >= score.masterBars.length) return;
  shiftComments(score, atIndex, -1);
  const mbs = score.masterBars.slice();
  const removed = mbs.splice(atIndex, 1)[0];
  // Si el compás borrado tenía el tempo inicial, se conserva en el siguiente.
  if (atIndex === 0 && removed.tempoAutomations.length && mbs[0] && !mbs[0].tempoAutomations.length)
    mbs[0].tempoAutomations.push(...removed.tempoAutomations);
  const per = new Map<at.model.Staff, at.model.Bar[]>();
  for (const tr of score.tracks)
    for (const st of tr.staves) {
      const list = st.bars.slice();
      list.splice(atIndex, 1);
      per.set(st, list);
    }
  rebuildBars(score, mbs, per);
}
/** Tempo vigente en un punto (compás y posición 0–1 dentro del compás). */
export function tempoAt(score: Score, b: number, r = 0): number {
  for (let i = Math.min(b, score.masterBars.length - 1); i >= 0; i--) {
    const list = score.masterBars[i].tempoAutomations.filter((a) => a.type === M.AutomationType.Tempo && (i < b || a.ratioPosition <= r + 1e-6));
    if (list.length) return list.reduce((x, y) => (y.ratioPosition >= x.ratioPosition ? y : x)).value;
  }
  return 120;
}
/** Todos los cambios de tempo de la canción, en orden. */
export function tempoChanges(score: Score) {
  const out: { b: number; r: number; bpm: number }[] = [];
  score.masterBars.forEach((mb, b) => {
    for (const a of mb.tempoAutomations) if (a.type === M.AutomationType.Tempo) out.push({ b, r: a.ratioPosition, bpm: a.value });
  });
  return out.sort((x, y) => x.b - y.b || x.r - y.r);
}
function setTempo(score: Score, b: number, bpm: number) {
  const mb = score.masterBars[b];
  if (!mb) return;
  mb.tempoAutomations = mb.tempoAutomations.filter((a) => a.type !== M.AutomationType.Tempo);
  const a = M.Automation.buildTempoAutomation(false, 0, bpm, 2);
  mb.tempoAutomations.push(a);
}

// ---------- aplicar operaciones ----------
const DYN = [M.DynamicValue.PPP, M.DynamicValue.PP, M.DynamicValue.P, M.DynamicValue.MP, M.DynamicValue.MF, M.DynamicValue.F, M.DynamicValue.FF, M.DynamicValue.FFF];
export const DYN_NAMES = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
export const dynIndex = (v: number) => Math.max(0, DYN.indexOf(v as at.model.DynamicValue));
export const dynValue = (i: number) => DYN[Math.max(0, Math.min(7, i))];

function applyNoteFx(n: Note, fx: NoteFx, on: boolean) {
  switch (fx) {
    case "hammer": n.isHammerPullOrigin = on; break;
    case "slide": n.slideOutType = on ? M.SlideOutType.Legato : M.SlideOutType.None; break;
    case "bend":
      n.bendPoints = null;
      n.bendType = M.BendType.None;
      if (on) {
        n.bendType = M.BendType.Bend;
        n.addBendPoint(new M.BendPoint(0, 0));
        n.addBendPoint(new M.BendPoint(15, 4));
        n.addBendPoint(new M.BendPoint(60, 4));
      }
      break;
    case "vibrato": n.vibrato = on ? M.VibratoType.Slight : M.VibratoType.None; break;
    case "palmMute": n.isPalmMute = on; break;
    case "letRing": n.isLetRing = on; break;
    case "dead": n.isDead = on; break;
    case "ghost": n.isGhost = on; break;
    case "accent": n.accentuated = on ? M.AccentuationType.Normal : M.AccentuationType.None; break;
    case "heavyAccent": n.accentuated = on ? M.AccentuationType.Heavy : M.AccentuationType.None; break;
    case "harmonic": n.harmonicType = on ? M.HarmonicType.Natural : M.HarmonicType.None; n.harmonicValue = on ? 12 : 0; break;
    case "staccato": n.isStaccato = on; break;
    case "tie": n.isTieDestination = on; break;
  }
}
export function noteFxState(n: Note, fx: NoteFx): boolean {
  switch (fx) {
    case "hammer": return n.isHammerPullOrigin;
    case "slide": return n.slideOutType !== M.SlideOutType.None;
    case "bend": return n.hasBend;
    case "vibrato": return n.vibrato !== M.VibratoType.None;
    case "palmMute": return n.isPalmMute;
    case "letRing": return n.isLetRing;
    case "dead": return n.isDead;
    case "ghost": return n.isGhost;
    case "accent": return n.accentuated === M.AccentuationType.Normal;
    case "heavyAccent": return n.accentuated === M.AccentuationType.Heavy;
    case "harmonic": return n.harmonicType !== M.HarmonicType.None;
    case "staccato": return n.isStaccato;
    case "tie": return n.isTieDestination;
  }
}

/** Aplica una operación. Devuelve false si no se pudo (referencia inválida). */
export function applyOp(score: Score, op: Op): Score {
  switch (op.k) {
    case "load":
      return at.model.JsonConverter.jsonToScore(op.json, settings);
    case "trackDup": return dupTrack(score, op.t, !!op.empty);
    case "trackPaste": return pasteTrack(score, op.json, op.name);
    case "retune": retune(score, op.t, op.tuning); break;
    case "trackMeta": setMeta(score, op.t, op.meta); break;
    case "comment": {
      const list = comments(score).filter((c) => c.id !== (op.c?.id ?? op.del));
      if (op.c) list.push({ ...op.c, text: String(op.c.text).slice(0, 500) });
      writeTag(score, CM_TAG, list.sort((a, b) => a.b - b.b || a.at - b.at));
      break;
    }
    case "proposal": {
      const list = proposals(score).filter((p) => p.id !== (op.p?.id ?? op.del));
      if (op.p) list.push(op.p);
      writeTag(score, PR_TAG, list);
      break;
    }
    case "fret": {
      const beat = beatAt(score, op);
      if (!beat) break;
      let n = beat.notes.find((x) => x.string === op.str);
      if (!n) {
        n = new M.Note();
        n.string = op.str;
        beat.addNote(n);
      }
      n.fret = Math.max(0, Math.min(36, op.fret));
      beat.isEmpty = false;
      break;
    }
    case "pitch": {
      const beat = beatAt(score, op);
      if (!beat) break;
      const ex = beat.notes.find((x) => x.realValue === op.pitch);
      if (op.on && !ex) {
        const n = new M.Note();
        setPitchOnNote(n, op.pitch);
        beat.addNote(n);
        beat.isEmpty = false;
      } else if (!op.on && ex) beat.removeNote(ex);
      break;
    }
    case "perc": {
      const beat = beatAt(score, op);
      if (!beat) break;
      const ex = beat.notes.find((x) => x.percussionArticulation === op.art);
      if (op.on && !ex) {
        const n = new M.Note();
        n.percussionArticulation = op.art;
        beat.addNote(n);
        beat.isEmpty = false;
      } else if (!op.on && ex) beat.removeNote(ex);
      break;
    }
    case "delNote": {
      const beat = beatAt(score, op);
      const n = beat && findNote(beat, op);
      if (beat && n) beat.removeNote(n);
      break;
    }
    case "clear": {
      const beat = beatAt(score, op);
      if (beat) for (const n of beat.notes.slice()) beat.removeNote(n);
      break;
    }
    case "insBeat": {
      const voice = score.tracks[op.t]?.staves[0]?.bars[op.b]?.voices[op.v];
      if (!voice) break;
      const nb = newRestBeat(op.dur, op.dots ?? 0);
      const list = voice.beats.slice();
      list.splice(op.after + 1, 0, nb);
      voice.beats.length = 0;
      for (const b of list) voice.beats.push(b);
      relinkBeats(voice);
      break;
    }
    case "delBeat": {
      const beat = beatAt(score, op);
      if (!beat) break;
      const voice = beat.voice;
      if (voice.beats.length <= 1) {
        for (const n of beat.notes.slice()) beat.removeNote(n);
        break;
      }
      voice.beats.splice(op.i, 1);
      relinkBeats(voice);
      break;
    }
    case "dur": { const b = beatAt(score, op); if (b) b.duration = op.dur as at.model.Duration; break; }
    case "dots": { const b = beatAt(score, op); if (b) b.dots = Math.max(0, Math.min(2, op.n)); break; }
    case "tuplet": {
      const b = beatAt(score, op);
      if (!b) break;
      if (op.n <= 1) { b.tupletNumerator = -1; b.tupletDenominator = -1; }
      else { b.tupletNumerator = op.n; b.tupletDenominator = op.n === 3 ? 2 : op.n === 6 ? 4 : 4; }
      break;
    }
    case "noteFx": {
      const beat = beatAt(score, op);
      const n = beat && findNote(beat, op);
      if (n) applyNoteFx(n, op.fx, op.on);
      break;
    }
    case "beatFx": {
      const b = beatAt(score, op);
      if (!b) break;
      const v = op.val;
      switch (op.fx) {
        case "dynamics": b.dynamics = dynValue(Number(v)); for (const n of b.notes) n.dynamics = b.dynamics; break;
        case "crescendo": b.crescendo = Number(v) as at.model.CrescendoType; break;
        case "tap": b.tap = !!v; break;
        case "slap": b.slap = !!v; break;
        case "pop": b.pop = !!v; break;
        case "text": b.text = v ? String(v) : null; break;
        case "chord": b.chordId = v ? String(v) : null; break;
        case "pickStroke": b.pickStroke = Number(v) as at.model.PickStroke; break;
        case "fadeIn": b.fade = v ? M.FadeType.FadeIn : M.FadeType.None; break;
        case "brush": b.brushType = Number(v) as at.model.BrushType; break;
        case "vibratoBeat": b.vibrato = v ? M.VibratoType.Wide : M.VibratoType.None; break;
      }
      break;
    }
    case "dynFrom": {
      // Cambia la dinámica desde este tiempo hasta donde seguía la dinámica anterior.
      const start = beatAt(score, op);
      if (!start) break;
      const old = start.dynamics, nv = dynValue(op.val);
      const staff = start.voice.bar.staff;
      let on = false;
      outer: for (const bar of staff.bars) {
        if (bar.index < op.b) continue;
        const v = bar.voices[op.v];
        if (!v) continue;
        for (const b of v.beats) {
          if (bar.index === op.b && b.index < op.i) continue;
          if (on && b.dynamics !== old) break outer;
          on = true;
          b.dynamics = nv;
          for (const n of b.notes) n.dynamics = nv;
        }
      }
      break;
    }
    case "barIns": insertBar(score, op.at); break;
    case "barDel": deleteBar(score, op.at); break;
    case "barProp": {
      const mb = score.masterBars[op.b];
      if (!mb) break;
      const v = op.val;
      switch (op.prop) {
        case "ts": {
          const [n, d] = String(v).split("/").map(Number);
          if (n > 0 && [1, 2, 4, 8, 16, 32].includes(d)) { mb.timeSignatureNumerator = n; mb.timeSignatureDenominator = d; }
          break;
        }
        case "repeatOpen": mb.isRepeatStart = !!v; break;
        case "repeatClose": mb.repeatCount = Number(v) || 0; break;
        case "doubleBar": mb.isDoubleBar = !!v; break;
        case "alternate": mb.alternateEndings = Number(v) || 0; break;
        case "section": {
          if (!v) mb.section = null;
          else { const s = new M.Section(); const [marker, ...rest] = String(v).split("|"); s.marker = marker; s.text = rest.join("|") || marker; mb.section = s; }
          break;
        }
        case "tempo": setTempo(score, op.b, Number(v)); break;
        case "key": for (const tr of score.tracks) for (const st of tr.staves) { const bar = st.bars[op.b]; if (bar) bar.keySignature = Number(v) as at.model.KeySignature; } break;
      }
      break;
    }
    case "trackAdd": addTrack(score, op.preset, op.name, op.tuning); break;
    case "bend": {
      const beat = beatAt(score, op);
      const n = beat?.notes.find((x) => x.string === op.str);
      if (n) setBend(n, op.shape);
      break;
    }
    case "tempo": {
      const mb = score.masterBars[op.b];
      if (!mb) break;
      const initial = score.tempo || 120;
      mb.tempoAutomations = mb.tempoAutomations.filter((a) => a.type !== M.AutomationType.Tempo);
      const list = op.list.slice().sort((x, y) => x.r - y.r);
      // El primer compás siempre lleva el tempo inicial.
      if (op.b === 0 && !list.some((x) => x.r === 0)) list.unshift({ r: 0, bpm: initial });
      for (const x of list) mb.tempoAutomations.push(M.Automation.buildTempoAutomation(false, Math.max(0, Math.min(0.999, x.r)), Math.max(20, Math.min(400, Math.round(x.bpm))), 2, x.r === 0));
      break;
    }
    case "master": writeMaster(score, op.fx); break;
    case "trackFx": {
      const map = fxMap(score);
      if (op.fx) map[op.t] = op.fx; else delete map[op.t];
      writeFx(score, map);
      break;
    }
    case "trackDel": {
      if (score.tracks.length <= 1) break;
      remapTrackData(score, (i) => (i < op.t ? i : i > op.t ? i - 1 : null)); // efectos y datos siguen a su pista
      score.tracks.splice(op.t, 1);
      score.tracks.forEach((t, i) => (t.index = i));
      break;
    }
    case "trackMove": {
      const [tr] = score.tracks.splice(op.t, 1);
      if (!tr) break;
      {
        const ids = Array.from({ length: score.tracks.length + 1 }, (_, i) => i);
        const [moved] = ids.splice(op.t, 1);
        ids.splice(Math.max(0, Math.min(op.to, ids.length)), 0, moved);
        remapTrackData(score, (old) => ids.indexOf(old));
      }
      score.tracks.splice(Math.max(0, Math.min(op.to, score.tracks.length)), 0, tr);
      score.tracks.forEach((t, i) => (t.index = i));
      break;
    }
    case "trackProp": {
      const tr = score.tracks[op.t];
      if (!tr) break;
      const st = tr.staves[0];
      const v = op.val;
      switch (op.prop) {
        case "name": tr.name = String(v).slice(0, 60); tr.shortName = tr.name.slice(0, 10); break;
        case "program":
          tr.playbackInfo.program = Number(v);
          if (tr.isPercussion) setMeta(score, op.t, { kit: Number(v) || undefined });
          break;
        case "tuning": if (Array.isArray(v) && v.length === st.tuning.length) st.stringTuning = new M.Tuning("", (v as number[]).slice(), false); break;
        case "capo": st.capo = Math.max(0, Math.min(12, Number(v))); break;
        case "clef": {
          const c = ({ G2: M.Clef.G2, F4: M.Clef.F4, C3: M.Clef.C3, C4: M.Clef.C4 } as Record<string, at.model.Clef>)[String(v)];
          if (c !== undefined) for (const bar of st.bars) bar.clef = c;
          break;
        }
        case "volume": tr.playbackInfo.volume = Math.max(0, Math.min(16, Number(v))); break;
        case "balance": tr.playbackInfo.balance = Math.max(0, Math.min(16, Number(v))); break;
        case "showTab": if (st.isStringed) st.showTablature = !!v; if (!st.showTablature && !st.showStandardNotation) st.showStandardNotation = true; break;
        case "showNotation": st.showStandardNotation = !!v; if (!st.showTablature && !st.showStandardNotation) st.showTablature = st.isStringed; break;
        case "color": break;
        case "mute": tr.playbackInfo.isMute = !!v; break;
        case "solo": tr.playbackInfo.isSolo = !!v; break;
      }
      break;
    }
    case "songProp": {
      const v = op.val;
      if (op.prop === "tempo") setTempo(score, 0, Number(v));
      else (score as unknown as Record<string, string>)[op.prop] = String(v).slice(0, 120);
      break;
    }
    case "chordDef": {
      const tr = score.tracks[op.t];
      if (!tr) break;
      const st = tr.staves[0];
      const c = new M.Chord();
      c.name = op.name;
      // alphaTab guarda los trastes de la cuerda más aguda a la más grave.
      c.strings = op.frets.slice();
      const played = op.frets.filter((f) => f > 0);
      c.firstFret = played.length ? Math.max(1, Math.min(...played)) : 1;
      if (Math.max(0, ...played) <= 4) c.firstFret = 1;
      c.showDiagram = true;
      c.showName = true;
      st.addChord(op.id, c);
      break;
    }
    case "voices": {
      // Garantiza n voces en cada compás de la pista (las nuevas empiezan vacías).
      const tr = score.tracks[op.t];
      if (!tr) break;
      for (const bar of tr.staves[0].bars)
        while (bar.voices.length < Math.min(4, op.n)) {
          const v = new M.Voice();
          bar.addVoice(v);
          const b = new M.Beat();
          b.duration = M.Duration.Whole;
          b.isEmpty = true;
          v.addBeat(b);
        }
      break;
    }
    case "setVoice": {
      const tr = score.tracks[op.t];
      const bar = tr?.staves[0]?.bars[op.b];
      if (!bar) break;
      while (bar.voices.length <= op.v) {
        const v = new M.Voice();
        const r = newRestBeat(M.Duration.Whole);
        r.isEmpty = true;
        v.addBeat(r);
        bar.addVoice(v);
      }
      const voice = bar.voices[op.v];
      const beats = op.beats.length ? op.beats.map((cb) => clipToBeat(tr, cb)) : [newRestBeat(M.Duration.Whole)];
      if (!op.beats.length) beats[0].isEmpty = true;
      voice.beats.length = 0;
      for (const b of beats) voice.addBeat(b);
      break;
    }
    case "lyrics": {
      const tr = score.tracks[op.t];
      if (!tr) break;
      for (const bar of tr.staves[0].bars) for (const v of bar.voices) for (const b of v.beats) b.lyrics = null;
      const l = new M.Lyrics();
      l.startBar = 0;
      l.text = op.text;
      l.finish();
      tr.applyLyrics([l]);
      (tr as unknown as { __lyrics?: string }).__lyrics = op.text;
      break;
    }
  }
  return score;
}

/** alphaTab reinicia los ids al leer alphaTex; tras unir pistas hay que renumerarlos. */
export function renumberIds(score: Score) {
  let bar = 0, voice = 0, beat = 0, note = 0;
  for (const tr of score.tracks)
    for (const st of tr.staves)
      for (const b of st.bars) {
        b.id = bar++;
        for (const v of b.voices) {
          v.id = voice++;
          for (const bt of v.beats) {
            bt.id = beat++;
            for (const n of bt.notes) n.id = note++;
          }
        }
      }
}
/** Todos los compases de un pentagrama con el mismo número de voces (las que falten, vacías). */
function evenVoices(score: Score) {
  for (const tr of score.tracks) for (const st of tr.staves) {
    let nv = 1;
    for (const bar of st.bars) nv = Math.max(nv, bar.voices.length);
    for (const bar of st.bars) while (bar.voices.length < nv) {
      const v = new M.Voice();
      const r = newRestBeat(M.Duration.Whole);
      r.isEmpty = true;
      v.addBeat(r);
      bar.addVoice(v);
    }
  }
}
export function finishScore(score: Score) {
  evenVoices(score);
  renumberIds(score);
  score.finish(settings);
}
export const toJson = (score: Score) => at.model.JsonConverter.scoreToJson(score);
export const fromJson = (json: string) => {
  const s = at.model.JsonConverter.jsonToScore(json, settings);
  return s;
};

// ---------- consultas de tiempo ----------
/** Duración en ticks (negra = 960) de un valor rítmico con puntillos y tresillo. */
export function beatTicks(beat: Beat): number {
  let t = 3840 / beat.duration;
  let add = t / 2;
  for (let i = 0; i < beat.dots; i++) { t += add; add /= 2; }
  if (beat.hasTuplet) t = (t * beat.tupletDenominator) / beat.tupletNumerator;
  return t;
}
export function barCapacity(mb: at.model.MasterBar) {
  return (3840 / mb.timeSignatureDenominator) * mb.timeSignatureNumerator;
}
export function voiceUsed(voice: at.model.Voice) {
  return voice.beats.reduce((s, b) => s + beatTicks(b), 0);
}

// ---------- menú de pista: duplicar, pegar de otra canción, reafinar ----------
type JsObj = Record<string, unknown> & { tracks: Record<string, unknown>[] };
// JSON simple (claves en minúsculas, como lo escribe alphaTab).
const toObj = (score: Score) => JSON.parse(at.model.JsonConverter.scoreToJson(score)) as JsObj;
const fromObj = (o: JsObj) => { const sc = at.model.JsonConverter.jsonToScore(JSON.stringify(o), settings); assignChannels(sc); finishScore(sc); return sc; };
/** Una pista en JSON (para copiarla a otra canción). */
export const trackJson = (score: Score, t: number) => JSON.stringify(toObj(score).tracks[t]);

/** Copia una pista justo debajo de la original (con notas, sonido, afinación, efectos y datos). */
function dupTrack(score: Score, t: number, empty: boolean): Score {
  const src = score.tracks[t];
  if (!src) return score;
  const o = toObj(score);
  const copy = JSON.parse(JSON.stringify(o.tracks[t])) as Record<string, unknown>;
  copy.name = `${src.name} (copia)`.slice(0, 60);
  copy.shortname = String(copy.name).slice(0, 10);
  o.tracks.splice(t + 1, 0, copy);
  const out = fromObj(o);
  const fx = fxMap(score)[t], meta = metaMap(score)[t];
  out.notices = score.notices;
  remapTrackData(out, (i) => (i <= t ? i : i + 1));
  if (fx) { const m = fxMap(out); m[t + 1] = JSON.parse(JSON.stringify(fx)); writeFx(out, m); }
  if (meta) setMeta(out, t + 1, { ...meta, locked: undefined });
  if (empty) for (const bar of out.tracks[t + 1].staves[0].bars) for (const v of bar.voices) for (const b of v.beats) for (const n of b.notes.slice()) b.removeNote(n);
  if (empty) finishScore(out);
  return out;
}

/** Inserta al final una pista copiada de otra canción; ajusta su número de compases. */
function pasteTrack(score: Score, trackJson: string, name?: string): Score {
  let tr: Record<string, unknown> & { staves: { bars: unknown[] }[] };
  try { tr = JSON.parse(trackJson); } catch { return score; }
  const o = toObj(score);
  const n = score.masterBars.length;
  // Compases de relleno: uno vacío de la propia pista (sin notas).
  const emptyBar = (() => {
    const bars = tr.staves[0]?.bars as Record<string, unknown>[] | undefined;
    const b = bars?.[bars.length - 1];
    if (!b) return null;
    const c = JSON.parse(JSON.stringify(b)) as Record<string, unknown> & { voices?: { beats?: { notes?: unknown[]; isEmpty?: boolean }[] }[] };
    for (const v of c.voices ?? []) for (const be of v.beats ?? []) { be.notes = []; }
    return c;
  })();
  for (const st of tr.staves) {
    if (st.bars.length > n) st.bars.length = n;
    while (st.bars.length < n && emptyBar) st.bars.push(JSON.parse(JSON.stringify(emptyBar)));
  }
  if (name) tr.name = name;
  o.tracks.push(tr);
  const out = fromObj(o);
  out.notices = score.notices;
  return out;
}

/** Cambia la afinación conservando el sonido: cada nota se mueve a la cuerda y traste más cercanos. */
function retune(score: Score, t: number, tuning: number[]) {
  const tr = score.tracks[t], st = tr?.staves[0];
  if (!st || !st.isStringed || tuning.length !== st.tuning.length) return;
  const old = st.tuning.slice();
  // En alphaTab la cuerda 1 es la más grave (índice tuning.length - 1 en el arreglo).
  const pitch = (str: number, fret: number, tun: number[]) => tun[tun.length - str] + fret + st.capo;
  for (const bar of st.bars) for (const v of bar.voices) for (const b of v.beats) {
    const used = new Set<number>();
    const notes = b.notes.slice().sort((a, c) => pitch(a.string, a.fret, old) - pitch(c.string, c.fret, old));
    for (const n of notes) {
      const p = pitch(n.string, n.fret, old);
      let best: { s: number; f: number } | null = null;
      for (let s = 1; s <= tuning.length; s++) {
        if (used.has(s)) continue;
        const f = p - tuning[tuning.length - s] - st.capo;
        if (f < 0 || f > 24) continue;
        const stay = s === n.string ? -0.5 : 0; // si puede quedarse en su cuerda, mejor
        if (!best || f + stay < best.f + (best.s === n.string ? -0.5 : 0)) best = { s, f };
      }
      if (best) { used.add(best.s); n.string = best.s; n.fret = best.f; }
    }
  }
  st.stringTuning = new M.Tuning("", tuning.slice(), false);
}
