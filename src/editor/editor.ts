// Estado de edición: cursor, cuerda, duración actual, historial y aplicación de operaciones.
import * as at from "@coderline/alphatab";
import {
  applyOp, barCapacity, beatAt, beatTicks, dynIndex, finishScore, fromJson, kindOf, noteFxState,
  rowToString, stringToRow, toJson, voiceUsed, type BeatRef, type Kind, type NoteFx, type Op,
} from "../score/model";
import type { Engine } from "../player/engine";

type Score = at.model.Score;
type Beat = at.model.Beat;
const D = at.model.Duration;

export interface Cursor extends BeatRef { row: number }
export type Listener = () => void;

export class Editor {
  score: Score;
  cursor: Cursor = { t: 0, b: 0, v: 0, i: 0, row: 0 };
  curDur = D.Quarter as number;
  viewAll = false;
  octave = 4;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners: Listener[] = [];
  /** Envía operaciones al dúo; lo conecta la capa de colaboración. */
  outbox: ((ops: Op[]) => void) | null = null;
  onDirty: (() => void) | null = null;
  private digitBuf = { key: "", first: -1, at: 0 };

  constructor(score: Score, public engine: Engine) {
    this.score = score;
  }
  onChange(fn: Listener) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(); }

  // ---------- consultas ----------
  get track() { return this.score.tracks[this.cursor.t]; }
  get kind(): Kind { return kindOf(this.track); }
  get beat(): Beat | null { return beatAt(this.score, this.cursor); }
  get bar() { return this.track.staves[0].bars[this.cursor.b]; }
  get masterBar() { return this.score.masterBars[this.cursor.b]; }
  get stringCount() { return this.kind === "tab" ? this.track.staves[0].tuning.length : 0; }
  get str() { return rowToString(this.track, this.cursor.row); }
  noteAtCursor() {
    const b = this.beat;
    if (!b) return null;
    if (this.kind === "tab") return b.notes.find((n) => n.string === this.str) ?? null;
    return b.notes[0] ?? null;
  }
  renderTracks(): number[] {
    return this.viewAll ? this.score.tracks.map((_, i) => i) : [this.cursor.t];
  }

  // ---------- aplicar cambios ----------
  /** Aplica cambios del usuario: guarda historial, envía al dúo y vuelve a dibujar. */
  commit(ops: Op[], opts: { history?: boolean; render?: boolean } = {}) {
    if (!ops.length) return;
    if (opts.history !== false) {
      this.undoStack.push(toJson(this.score));
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    for (const op of ops) this.score = applyOp(this.score, op);
    finishScore(this.score);
    this.clampCursor();
    this.outbox?.(ops);
    this.onDirty?.();
    if (opts.render !== false) this.rerender();
    this.emit();
  }
  /** Cambios que llegan del dúo: sin historial ni reenvío. */
  applyRemote(ops: Op[]) {
    for (const op of ops) this.score = applyOp(this.score, op);
    finishScore(this.score);
    this.clampCursor();
    this.rerender();
    this.emit();
  }
  replaceScore(score: Score, keepHistory = false) {
    this.score = score;
    if (!keepHistory) { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.clampCursor();
    this.rerender();
    this.emit();
  }
  rerender() {
    this.engine.render(this.score, this.renderTracks());
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(toJson(this.score));
    this.score = fromJson(prev);
    finishScore(this.score);
    this.clampCursor();
    this.outbox?.([{ k: "load", json: prev }]);
    this.onDirty?.();
    this.rerender();
    this.emit();
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(toJson(this.score));
    this.score = fromJson(next);
    finishScore(this.score);
    this.clampCursor();
    this.outbox?.([{ k: "load", json: next }]);
    this.onDirty?.();
    this.rerender();
    this.emit();
  }

  clampCursor() {
    const c = this.cursor;
    c.t = Math.max(0, Math.min(c.t, this.score.tracks.length - 1));
    const bars = this.track.staves[0].bars;
    c.b = Math.max(0, Math.min(c.b, bars.length - 1));
    const voice = bars[c.b].voices[c.v] ?? bars[c.b].voices[0];
    c.v = voice.index;
    c.i = Math.max(0, Math.min(c.i, voice.beats.length - 1));
    if (this.kind === "tab") c.row = Math.max(0, Math.min(c.row, this.stringCount - 1));
  }

  // ---------- movimiento ----------
  setCursor(ref: Partial<Cursor>, silent = false) {
    Object.assign(this.cursor, ref);
    this.clampCursor();
    this.digitBuf.key = "";
    if (!silent) this.emit();
  }
  selectTrack(t: number) {
    this.cursor.t = t;
    this.cursor.v = 0;
    this.clampCursor();
    this.rerender();
    this.emit();
  }
  prevBeat() {
    const c = this.cursor;
    if (c.i > 0) c.i--;
    else if (c.b > 0) { c.b--; c.i = this.bar.voices[c.v].beats.length - 1; }
    this.setCursor({});
  }
  nextBeatPlain() {
    const c = this.cursor, voice = this.bar.voices[c.v];
    if (c.i < voice.beats.length - 1) c.i++;
    else if (c.b < this.track.staves[0].bars.length - 1) { c.b++; c.i = 0; }
    this.setCursor({});
  }
  stringUp() { if (this.kind === "tab") this.setCursor({ row: Math.max(0, this.cursor.row - 1) }); }
  stringDown() { if (this.kind === "tab") this.setCursor({ row: Math.min(this.stringCount - 1, this.cursor.row + 1) }); }

  /** Espacio: avanza un tiempo; si el compás tiene lugar crea uno nuevo, si no pasa al siguiente compás. */
  advance() {
    const c = this.cursor, voice = this.bar.voices[c.v], beat = this.beat!;
    const ops: Op[] = [];
    if (c.i < voice.beats.length - 1) { this.nextBeatPlain(); return; }
    const cap = barCapacity(this.masterBar), used = voiceUsed(voice);
    if (used < cap - 1) {
      const dur = fitDuration(beat.duration, cap - used);
      ops.push({ k: "insBeat", t: c.t, b: c.b, v: c.v, after: c.i, dur });
      this.commit(ops);
      this.setCursor({ i: c.i + 1 });
      return;
    }
    this.gotoNextBar(beat.duration);
  }
  /** Enter: siguiente compás (lo crea si es el último). */
  gotoNextBar(dur?: number) {
    const c = this.cursor, ops: Op[] = [];
    const bars = this.track.staves[0].bars.length;
    if (c.b + 1 >= bars) ops.push({ k: "barIns", at: bars });
    if (ops.length) this.commit(ops);
    this.setCursor({ b: c.b + 1, i: 0 }, true);
    // Compás vacío (silencio de redonda): toma la duración con la que se venía escribiendo.
    const nb = this.beat;
    const d = dur ?? this.curDur;
    if (nb && nb.voice.beats.length === 1 && nb.isRest && nb.duration !== d)
      this.commit([{ k: "dur", ...this.ref(), dur: d }], { history: false });
    this.emit();
  }
  ref(): BeatRef { const { t, b, v, i } = this.cursor; return { t, b, v, i }; }

  // ---------- escritura ----------
  /** Dígito en tablatura: dos dígitos seguidos (menos de 0.8 s) forman trastes de 10 a 24. */
  digit(d: number) {
    if (this.kind !== "tab") { this.setDurationByDigit(d); return; }
    const key = `${this.cursor.t}:${this.cursor.b}:${this.cursor.i}:${this.cursor.row}`;
    const now = Date.now(), buf = this.digitBuf;
    if (buf.key === key && now - buf.at < 800 && buf.first >= 1 && buf.first * 10 + d <= 24) {
      this.digitBuf = { key: "", first: -1, at: 0 };
      this.writeFret(buf.first * 10 + d);
      return;
    }
    this.digitBuf = { key, first: d, at: now };
    this.writeFret(d);
  }
  writeFret(fret: number) {
    const b = this.beat;
    if (!b) return;
    const ops: Op[] = [];
    if (b.isRest && b.voice.beats.length === 1 && b.duration !== this.curDur) ops.push({ k: "dur", ...this.ref(), dur: this.curDur });
    ops.push({ k: "fret", ...this.ref(), str: this.str, fret });
    this.commit(ops);
    const n = this.noteAtCursor();
    if (n) this.engine.playNote(n);
  }
  togglePitch(midi: number) {
    const b = this.beat;
    if (!b) return;
    const on = !b.notes.some((n) => n.realValue === midi);
    const ops: Op[] = [];
    if (on && b.isRest && b.voice.beats.length === 1 && b.duration !== this.curDur) ops.push({ k: "dur", ...this.ref(), dur: this.curDur });
    ops.push({ k: "pitch", ...this.ref(), pitch: midi, on });
    this.commit(ops);
    if (on) { const n = this.beat?.notes.find((x) => x.realValue === midi); if (n) this.engine.playNote(n); }
  }
  togglePerc(articulationIndex: number) {
    const b = this.beat;
    if (!b) return;
    const on = !b.notes.some((n) => n.percussionArticulation === articulationIndex);
    const ops: Op[] = [];
    if (on && b.isRest && b.voice.beats.length === 1 && b.duration !== this.curDur) ops.push({ k: "dur", ...this.ref(), dur: this.curDur });
    ops.push({ k: "perc", ...this.ref(), art: articulationIndex, on });
    this.commit(ops);
    if (on) { const n = this.beat?.notes.find((x) => x.percussionArticulation === articulationIndex); if (n) this.engine.playNote(n); }
  }
  /** Borrar: quita la nota de la cuerda; si el tiempo ya estaba vacío lo elimina y retrocede. */
  backspace() {
    const b = this.beat;
    if (!b) return;
    const n = this.kind === "tab" ? this.noteAtCursor() : null;
    if (n) { this.commit([{ k: "delNote", ...this.ref(), str: n.string }]); return; }
    if (b.notes.length && this.kind !== "tab") { this.commit([{ k: "clear", ...this.ref() }]); return; }
    if (b.voice.beats.length > 1) {
      const i = this.cursor.i;
      this.commit([{ k: "delBeat", ...this.ref() }]);
      this.setCursor({ i: Math.max(0, i - 1) });
      return;
    }
    this.prevBeat();
  }
  clearBeat() { this.commit([{ k: "clear", ...this.ref() }]); }
  deleteBeat() { this.commit([{ k: "delBeat", ...this.ref() }]); }

  setDuration(dur: number) {
    this.curDur = dur;
    const b = this.beat;
    if (b && b.duration !== dur) this.commit([{ k: "dur", ...this.ref(), dur }]);
    else this.emit();
  }
  setDurationByDigit(d: number) {
    const map: Record<number, number> = { 1: D.Whole, 2: D.Half, 4: D.Quarter, 8: D.Eighth, 6: D.Sixteenth, 3: D.ThirtySecond };
    if (map[d]) this.setDuration(map[d]);
  }
  shorter() { const b = this.beat; if (b && b.duration < 64) this.setDuration(b.duration * 2); }
  longer() { const b = this.beat; if (b && b.duration > 1) this.setDuration(b.duration / 2); }
  toggleDot() { const b = this.beat; if (b) this.commit([{ k: "dots", ...this.ref(), n: b.dots ? 0 : 1 }]); }
  toggleDoubleDot() { const b = this.beat; if (b) this.commit([{ k: "dots", ...this.ref(), n: b.dots === 2 ? 0 : 2 }]); }
  toggleTuplet(n = 3) { const b = this.beat; if (b) this.commit([{ k: "tuplet", ...this.ref(), n: b.hasTuplet && b.tupletNumerator === n ? 0 : n }]); }

  toggleNoteFx(fx: NoteFx): string | null {
    const b = this.beat;
    if (!b) return null;
    const notes = this.kind === "tab" ? [this.noteAtCursor()].filter(Boolean) : b.notes;
    if (!notes.length) return "Primero escribe una nota en esta cuerda.";
    const on = !noteFxState(notes[0]!, fx);
    this.commit(notes.map((n) => ({ k: "noteFx", ...this.ref(), fx, on, ...(this.kind === "tab" ? { str: n!.string } : this.kind === "drums" ? { art: n!.percussionArticulation } : { pitch: n!.realValue }) }) as Op));
    return null;
  }
  beatFx(fx: "tap" | "slap" | "pop" | "fadeIn" | "vibratoBeat") {
    const b = this.beat;
    if (!b) return;
    const cur = fx === "tap" ? b.tap : fx === "slap" ? b.slap : fx === "pop" ? b.pop : fx === "fadeIn" ? b.fade !== at.model.FadeType.None : b.vibrato !== at.model.VibratoType.None;
    this.commit([{ k: "beatFx", ...this.ref(), fx, val: !cur }]);
  }
  pickStroke(dir: 0 | 1 | 2) { const b = this.beat; if (b) this.commit([{ k: "beatFx", ...this.ref(), fx: "pickStroke", val: b.pickStroke === dir ? 0 : dir }]); }
  /** Dinámica efectiva en el cursor (la del propio tiempo). */
  get dynamic() { return this.beat ? dynIndex(this.beat.dynamics) : 5; }
  setDynamic(i: number) { this.commit([{ k: "dynFrom", ...this.ref(), val: Math.max(0, Math.min(7, i)) }]); }
  louder() { this.setDynamic(this.dynamic + 1); }
  softer() { this.setDynamic(this.dynamic - 1); }
  hairpin(type: 1 | 2) { const b = this.beat; if (b) this.commit([{ k: "beatFx", ...this.ref(), fx: "crescendo", val: b.crescendo === type ? 0 : type }]); }
  text(t: string) { this.commit([{ k: "beatFx", ...this.ref(), fx: "text", val: t || null }]); }

  // ---------- compases ----------
  insertBar(after = true) {
    const at2 = this.cursor.b + (after ? 1 : 0);
    this.commit([{ k: "barIns", at: at2 }]);
    this.setCursor({ b: at2, i: 0 });
  }
  deleteBar() { this.commit([{ k: "barDel", at: this.cursor.b }]); }
  barProp(prop: Extract<Op, { k: "barProp" }>["prop"], val: number | string | boolean | null) {
    this.commit([{ k: "barProp", b: this.cursor.b, prop, val }]);
  }

  stringOfRow = (row: number) => rowToString(this.track, row);
  rowOfString = (s: number) => stringToRow(this.track, s);
}

/** La duración más larga que cabe en lo que queda del compás, sin pasar la actual. */
function fitDuration(cur: number, remaining: number): number {
  for (const d of [cur, cur * 2, cur * 4, cur * 8, cur * 16]) {
    if (d > 64) break;
    const t = 3840 / d;
    if (t <= remaining + 0.5) return d;
  }
  return 64;
}
export { beatTicks };
