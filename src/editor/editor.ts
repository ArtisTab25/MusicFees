// Estado de edición: cursor, cuerda, duración actual, historial y aplicación de operaciones.
import * as at from "@coderline/alphatab";
import {
  applyOp, barCapacity, beatAt, beatTicks, bendShapeOf, tempoAt, tempoChanges, dynIndex, finishScore, fromJson, kindOf, noteFxState, type BendShape,
  rowToString, stringToRow, toJson, voiceUsed, type BeatRef, type Kind, type NoteFx, type Op,
} from "../score/model";
import type { Engine } from "../player/engine";
import { copy, countSelected, loadClip, ordered, planClear, planDeleteBars, planPaste, planTranspose, saveClip, type Clip, type Selection } from "../score/clip";

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
  /** Selección activa (una pista y una voz; puede cruzar compases). */
  sel: Selection | null = null;
  /** Modo selección: mover el cursor extiende la selección (celular: botón o toque largo). */
  selecting = false;

  constructor(score: Score, public engine: Engine) {
    this.score = score;
  }

  // ---------- JSON de la canción (historial y guardado) ----------
  // Pasar la canción completa a JSON es lo más caro de cada tecla (medido: ~200 ms por tecla en
  // computadora, ~850 ms en un teléfono). Se calcula una vez por estado, en un momento libre, y lo
  // reusan deshacer, el guardado local, la nube y el dúo.
  private cleanJson: string | null = null;
  /** Hay cambios del usuario cuyo estado aún no se pasó a JSON (está escribiendo seguido). */
  private unsnapped = false;
  private snapT = 0;
  /** La canción actual en JSON (usa la copia ya calculada si la hay). */
  json(): string {
    if (this.cleanJson === null) { this.cleanJson = toJson(this.score); this.unsnapped = false; }
    return this.cleanJson;
  }
  private changed(byUser: boolean) {
    this.cleanJson = null;
    this.unsnapped = byUser;
    clearTimeout(this.snapT);
    this.snapT = window.setTimeout(() => {
      const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(() => this.json(), { timeout: 1500 }); else this.json();
    }, 350);
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
      // Si lo anterior todavía no se pasó a JSON es que se está escribiendo seguido: esos cambios
      // se deshacen juntos (el paso anterior del historial ya guarda cómo estaba antes).
      if (this.cleanJson !== null || !this.unsnapped) {
        this.undoStack.push(this.json());
        if (this.undoStack.length > 60) this.undoStack.shift();
      }
      this.redoStack.length = 0;
    }
    for (const op of ops) this.score = applyOp(this.score, op);
    finishScore(this.score);
    this.changed(true);
    this.clampCursor();
    this.outbox?.(ops);
    this.onDirty?.();
    if (opts.render !== false) this.rerender(firstBar(ops));
    // Efectos y masterizado no cambian el dibujo: se aplican directo al motor de estudio
    // (antes, deshacer o un cambio guardado sin redibujar no llegaba a sonar).
    if (ops.some((o) => o.k === "trackFx" || o.k === "master")) this.engine.syncFx(this.score);
    this.emit();
  }
  /** Cambios que llegan del dúo: sin historial ni reenvío. */
  applyRemote(ops: Op[]) {
    for (const op of ops) this.score = applyOp(this.score, op);
    finishScore(this.score);
    this.changed(false);
    this.clampCursor();
    this.rerender();
    this.emit();
  }
  replaceScore(score: Score, keepHistory = false) {
    this.score = score;
    this.changed(false);
    if (!keepHistory) { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.clampCursor();
    this.rerender();
    this.emit();
  }
  /** Vuelve a dibujar. Con `fromBar`, solo desde el renglón de ese compás (mucho más rápido al escribir). */
  rerender(fromBar?: number) {
    this.engine.render(this.score, this.renderTracks(), fromBar);
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.json());
    this.score = fromJson(prev);
    finishScore(this.score);
    this.cleanJson = prev; this.unsnapped = false;
    this.clampCursor();
    this.outbox?.([{ k: "load", json: prev }]);
    this.onDirty?.();
    this.rerender();
    this.emit();
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.json());
    this.score = fromJson(next);
    finishScore(this.score);
    this.cleanJson = next; this.unsnapped = false;
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
  setCursor(ref: Partial<Cursor>, silent = false, extend = this.selecting && !silent) {
    const prevT = this.cursor.t, prevV = this.cursor.v;
    Object.assign(this.cursor, ref);
    this.clampCursor();
    this.digitBuf.key = "";
    const c = this.cursor;
    if (this.sel && !this.sel.all && (c.t !== this.sel.t || c.v !== this.sel.v)) { this.sel = null; this.selecting = false; }
    else if (this.sel?.all && extend) { this.sel.z = { b: c.b, i: 0 }; this.wholeBars(); if (!silent) this.emit(); return; }
    else if (extend) {
      if (!this.sel) this.sel = { t: prevT, v: prevV, a: { b: c.b, i: c.i }, z: { b: c.b, i: c.i } };
      this.sel.z = { b: c.b, i: c.i };
    } else if (!silent && this.sel && !this.selecting) this.sel = null;
    if (!silent) this.emit();
  }
  selectTrack(t: number) {
    this.cursor.t = t;
    this.cursor.v = 0;
    this.clampCursor();
    this.rerender();
    this.emit();
  }
  prevBeat(extend = this.selecting) {
    const c = this.cursor;
    let { b, i } = c;
    if (i > 0) i--;
    else if (b > 0) { b--; i = this.track.staves[0].bars[b].voices[c.v].beats.length - 1; }
    this.setCursor({ b, i }, false, extend);
  }
  nextBeatPlain(extend = this.selecting) {
    const c = this.cursor, voice = this.bar.voices[c.v];
    let { b, i } = c;
    if (i < voice.beats.length - 1) i++;
    else if (b < this.track.staves[0].bars.length - 1) { b++; i = 0; }
    this.setCursor({ b, i }, false, extend);
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

  // ---------- selección y portapapeles ----------
  /** Empieza a seleccionar desde el cursor (o termina si ya estaba seleccionando). */
  toggleSelecting(on = !this.selecting) {
    this.selecting = on;
    const c = this.cursor;
    if (on && !this.sel) this.sel = { t: c.t, v: c.v, a: { b: c.b, i: c.i }, z: { b: c.b, i: c.i } };
    if (!on) this.sel = null;
    this.emit();
  }
  clearSelection() { if (this.sel || this.selecting) { this.sel = null; this.selecting = false; this.emit(); } }
  /** Extiende la selección a compases completos (o a toda la pista). */
  selectBars(all = false) {
    const c = this.cursor, bars = this.track.staves[0].bars;
    const s = all ? 0 : Math.min(this.sel?.a.b ?? c.b, this.sel?.z.b ?? c.b);
    const e = all ? bars.length - 1 : Math.max(this.sel?.a.b ?? c.b, this.sel?.z.b ?? c.b);
    this.sel = { t: c.t, v: c.v, a: { b: s, i: 0 }, z: { b: e, i: bars[e].voices[c.v].beats.length - 1 }, all: this.sel?.all };
    this.selecting = true;
    this.emit();
  }
  /** Activa o quita «todas las pistas»: la selección pasa a ser de compases completos de la canción. */
  toggleAllTracks() {
    const c = this.cursor;
    if (!this.sel) this.sel = { t: c.t, v: c.v, a: { b: c.b, i: 0 }, z: { b: c.b, i: 0 } };
    this.sel.all = !this.sel.all;
    this.selecting = true;
    if (this.sel.all) this.wholeBars();
    this.emit();
  }
  private wholeBars() {
    const sel = this.sel!, { s, e } = ordered(sel), bars = this.score.tracks[sel.t].staves[0].bars;
    const fwd = sel.a.b <= sel.z.b;
    const first = { b: s.b, i: 0 }, last = { b: e.b, i: bars[e.b].voices[sel.v].beats.length - 1 };
    sel.a = fwd ? first : last; sel.z = fwd ? last : first;
  }
  get selBars() { if (!this.sel) return 0; const { s, e } = ordered(this.sel); return e.b - s.b + 1; }
  /** Lo que hay que copiar: la selección o, sin ella, el tiempo del cursor. */
  private target(): Selection {
    const c = this.cursor;
    return this.sel ?? { t: c.t, v: c.v, a: { b: c.b, i: c.i }, z: { b: c.b, i: c.i } };
  }
  get selectedCount() { return this.sel ? (this.sel.all ? this.selBars : countSelected(this.score, this.sel)) : 0; }
  get clip(): Clip | null { return loadClip(); }
  copySel(): string {
    const clip = copy(this.score, this.target());
    saveClip(clip);
    const n = clip.bars.reduce((k, b) => k + b.length, 0);
    if (clip.tracks) return `Copiado: ${clip.bars.length} compás${clip.bars.length > 1 ? "es" : ""} de todas las pistas.`;
    return clip.whole ? `Copiado: ${clip.bars.length} compás${clip.bars.length > 1 ? "es" : ""} de ${clip.from}.` : `Copiado: ${n} tiempo${n > 1 ? "s" : ""} de ${clip.from}.`;
  }
  cutSel(): string {
    const msg = this.copySel().replace("Copiado", "Cortado");
    this.commit(planClear(this.score, this.target()));
    return msg;
  }
  /** Pega en el inicio de la selección o en el cursor. `insert` abre compases nuevos en vez de sobrescribir. */
  paste(insert = false): string {
    const clip = loadClip();
    if (!clip) return "Primero copia algo.";
    const t = this.target();
    const start = t.a.b < t.z.b || (t.a.b === t.z.b && t.a.i <= t.z.i) ? t.a : t.z;
    const kind = this.kind;
    let warn = "";
    if (!clip.tracks && (clip.kind === "drums") !== (kind === "drums")) warn = " Solo se pegó el ritmo: la batería y los instrumentos con altura no se pueden convertir entre sí.";
    if (insert && !clip.whole) return "Para insertar, copia compases completos (botón «Compases»).";
    this.commit(planPaste(this.score, t.t, t.v, insert ? { b: start.b, i: 0 } : start, clip, insert));
    this.clearSelection();
    this.setCursor({ b: start.b, i: insert ? 0 : start.i });
    return `${insert ? "Insertado" : "Pegado"} en el compás ${start.b + 1}.${warn}`;
  }
  /** Copia los compases seleccionados y los inserta justo después. */
  duplicate(): string {
    if (!this.sel) return "Selecciona primero los compases.";
    this.selectBars();
    const clip = copy(this.score, this.sel);
    const { e } = ordered(this.sel);
    this.commit(planPaste(this.score, this.sel.t, this.sel.v, { b: e.b + 1, i: 0 }, clip, true));
    const n = clip.bars.length;
    this.clearSelection();
    this.setCursor({ b: e.b + 1, i: 0 });
    return `Duplicado: ${n} compás${n > 1 ? "es" : ""}.`;
  }
  /** Borra de la canción los compases seleccionados (en todas las pistas). */
  deleteBars(): string {
    const t = this.target();
    const n = ordered(t).e.b - ordered(t).s.b + 1;
    this.commit(planDeleteBars(this.score, t));
    this.clearSelection();
    this.setCursor({ b: Math.min(ordered(t).s.b, this.track.staves[0].bars.length - 1), i: 0 });
    return `Se borraron ${n} compás${n > 1 ? "es" : ""}.`;
  }
  deleteSel() { this.commit(planClear(this.score, this.target())); }
  /** Transpone la selección; sin selección, toda la pista. */
  transpose(semis: number): string {
    if (this.kind === "drums") return "La batería no se transpone.";
    const bars = this.track.staves[0].bars, c = this.cursor;
    const sel = this.sel ?? { t: c.t, v: c.v, a: { b: 0, i: 0 }, z: { b: bars.length - 1, i: bars[bars.length - 1].voices[c.v].beats.length - 1 } };
    const { ops, lost } = planTranspose(this.score, sel, semis);
    this.commit(ops);
    const what = this.sel ? "la selección" : "toda la pista";
    return `${semis > 0 ? "+" : ""}${semis} semitono${Math.abs(semis) > 1 ? "s" : ""} en ${what}.${lost ? ` ${lost} nota${lost > 1 ? "s" : ""} quedaba${lost > 1 ? "n" : ""} fuera del rango del instrumento y se quitó.` : ""}`;
  }

  // ---------- tempo ----------
  /** Posición del cursor dentro de su compás (0 = inicio, 1 = final), por duración. */
  get beatRatio() {
    const c = this.cursor, voice = this.bar.voices[c.v];
    let t = 0;
    for (let i = 0; i < c.i && i < voice.beats.length; i++) t += beatTicks(voice.beats[i]);
    return Math.min(0.999, t / barCapacity(this.masterBar));
  }
  get tempoHere() { return tempoAt(this.score, this.cursor.b, this.beatRatio); }
  get tempoList() { return tempoChanges(this.score); }
  private barTempos(b: number) {
    return this.score.masterBars[b].tempoAutomations.filter((a) => a.type === at.model.AutomationType.Tempo).map((a) => ({ r: a.ratioPosition, bpm: a.value }));
  }
  /** Cambia el tempo. `from`: desde este tiempo en adelante. `bar`: solo este compás (después vuelve el anterior). */
  setTempo(bpm: number, mode: "from" | "bar" = "from") {
    const c = this.cursor, r = mode === "bar" ? 0 : this.beatRatio;
    const ops: Op[] = [];
    const after = tempoAt(this.score, c.b + 1, 0);
    const keep = mode === "bar" ? [] : this.barTempos(c.b).filter((x) => Math.abs(x.r - r) > 1e-3);
    ops.push({ k: "tempo", b: c.b, list: [...keep, { r, bpm }] });
    const next = c.b + 1;
    if (mode === "bar" && next < this.score.masterBars.length && !this.barTempos(next).some((x) => x.r === 0))
      ops.push({ k: "tempo", b: next, list: [{ r: 0, bpm: after }, ...this.barTempos(next)] });
    this.commit(ops);
  }
  /** Accelerando o ritardando: del tempo actual a `to` bpm, repartido tiempo por tiempo hasta el compás `endBar`. */
  tempoRamp(to: number, endBar: number) {
    const c = this.cursor, from = this.tempoHere, last = Math.max(c.b, Math.min(endBar, this.score.masterBars.length - 1));
    const steps: { b: number; r: number }[] = [];
    for (let b = c.b; b <= last; b++) {
      const n = this.score.masterBars[b].timeSignatureNumerator;
      for (let k = 0; k < n; k++) { const r = k / n; if (b > c.b || r >= this.beatRatio - 1e-6) steps.push({ b, r }); }
    }
    const ops: Op[] = [];
    for (let b = c.b; b <= last; b++) {
      const mine = steps.filter((x) => x.b === b);
      const list = mine.map((x) => { const j = steps.indexOf(x); return { r: x.r, bpm: from + ((to - from) * (j + 1)) / steps.length }; });
      const keep = b === c.b ? this.barTempos(b).filter((x) => x.r < this.beatRatio - 1e-6) : [];
      ops.push({ k: "tempo", b, list: [...keep, ...list] });
    }
    this.commit(ops);
  }
  removeTempo(b: number, r: number) {
    this.commit([{ k: "tempo", b, list: this.barTempos(b).filter((x) => Math.abs(x.r - r) > 1e-3) }]);
  }

  // ---------- bends ----------
  get bendShape(): BendShape { return this.kind === "tab" ? bendShapeOf(this.noteAtCursor()) : "none"; }
  bend(shape: BendShape): string | null {
    const n = this.noteAtCursor();
    if (this.kind !== "tab" || !n) return "Primero escribe una nota en esta cuerda.";
    this.commit([{ k: "bend", ...this.ref(), str: n.string, shape: this.bendShape === shape ? "none" : shape }]);
    const fresh = this.noteAtCursor();
    if (fresh) this.engine.playNote(fresh);
    return null;
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

/** Primer compás que tocan los cambios, si todos son locales (notas, compases, tempo). Si alguno
 *  cambia la pista o la canción entera, `undefined` = dibujar todo. */
function firstBar(ops: Op[]): number | undefined {
  let min = Infinity;
  for (const o of ops) {
    if ("b" in o && typeof o.b === "number") min = Math.min(min, o.b);
    else if ((o.k === "barIns" || o.k === "barDel")) min = Math.min(min, o.at);
    else return undefined;
  }
  return Number.isFinite(min) ? min : undefined;
}
