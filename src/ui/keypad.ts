// Teclado propio de MusicFees: trastes, movimiento y duraciones en la pantalla, sin depender
// del teclado del teléfono (que tapa media partitura y en Android a veces no se abre).
import * as at from "@coderline/alphatab";
import type { Editor } from "../editor/editor";
import { kindOf } from "../score/model";
import { h } from "./dom";
import { pcName } from "../score/chords";

const D = at.model.Duration;
type Key = { label: string; aria: string; act: () => void; cls?: string; on?: () => boolean };

export interface KeypadHooks {
  hide: () => void;
  toast: (m: string) => void;
  /** Abre la lista de patrones de rasgueo. */
  strums: () => void;
  /** Diapasón al revés (zurdos). */
  lefty: () => boolean;
}

export function buildKeypad(ed: Editor, hooks: KeypadHooks) {
  const el = h("div", { class: "pad", role: "group", "aria-label": "Teclado de MusicFees" });
  const digit = (n: number): Key => ({ label: String(n), aria: `Traste ${n}`, act: () => ed.digit(n), cls: "num" });
  const dur = (d: number, g: string, name: string): Key => ({ label: g, aria: name, act: () => ed.setDuration(d), cls: "mus", on: () => (ed.beat?.duration ?? -1) === d });
  const nav: Record<string, Key> = {
    prev: { label: "←", aria: "Tiempo anterior", act: () => ed.prevBeat(), cls: "nav" },
    next: { label: "→", aria: "Siguiente tiempo (espacio)", act: () => ed.advance(), cls: "nav" },
    bar: { label: "↵", aria: "Siguiente compás", act: () => ed.gotoNextBar(), cls: "nav" },
    del: { label: "⌫", aria: "Borrar", act: () => ed.backspace(), cls: "del" },
    rest: { label: "𝄽", aria: "Silencio: vaciar el tiempo", act: () => ed.clearBeat(), cls: "mus" },
    undo: { label: "↶", aria: "Deshacer", act: () => ed.undo(), cls: "nav" },
    dot: { label: "·", aria: "Puntillo", act: () => ed.toggleDot(), cls: "mus", on: () => !!ed.beat?.dots },
    sel: { label: "⬚", aria: "Seleccionar (copiar, cortar, pegar, transponer)", act: () => ed.toggleSelecting(true), cls: "nav" },
    hide: { label: "▾", aria: "Ocultar el teclado", act: () => hooks.hide(), cls: "nav" },
  };
  // Herramientas de escritura activa (fila extra, siempre visible).
  let fretMode = false;
  const tools: Record<string, Key> = {
    redo: { label: "↷", aria: "Rehacer", act: () => ed.redo(), cls: "nav" },
    repeat: { label: "Repetir", aria: "Repetir el tiempo anterior", act: () => { const m = ed.repeatPrev(); if (m) hooks.toast(m); }, cls: "txt small" },
    fill: { label: "Completar", aria: "Completar el compás con silencios", act: () => hooks.toast(ed.fillBar()), cls: "txt small", on: () => Math.abs(ed.barGap) > 1 },
    fret: { label: "Diapasón", aria: "Escribir tocando un diapasón", act: () => { fretMode = !fretMode; drawn = ""; update(); }, cls: "txt small", on: () => fretMode },
    strum: { label: "Rasgueo", aria: "Aplicar un patrón de rasgueo", act: () => hooks.strums(), cls: "txt small" },
    redoTxt: { label: "↷ Rehacer", aria: "Rehacer", act: () => ed.redo(), cls: "txt small" },
  };
  const durs = [dur(D.Whole, "𝅝", "Redonda"), dur(D.Half, "𝅗𝅥", "Blanca"), dur(D.Quarter, "♩", "Negra"), dur(D.Eighth, "♪", "Corchea"), dur(D.Sixteenth, "𝅘𝅥𝅯", "Semicorchea")];

  const layouts = {
    tab: [
      [1, 2, 3, 4, 5].map(digit).concat(nav.prev, nav.next, nav.del),
      [6, 7, 8, 9, 0].map(digit).concat(nav.rest, nav.bar, nav.undo),
      durs.concat(nav.dot, nav.sel, nav.hide),
      [tools.repeat, tools.fill, tools.fret, tools.strum, tools.redoTxt],
    ],
    fret: [
      [nav.prev, nav.next, nav.bar, nav.del, nav.rest, nav.undo, tools.redo, nav.hide],
      durs.concat(nav.dot, nav.sel),
      [tools.repeat, tools.fill, tools.fret, tools.strum],
    ],
    other: [
      [nav.prev, nav.next, nav.bar, nav.del, nav.rest, nav.undo, nav.sel, nav.hide],
      durs.concat(dur(D.ThirtySecond, "𝅘𝅥𝅰", "Fusa"), nav.dot, { label: "3", aria: "Tresillo", act: () => ed.toggleTuplet(3), cls: "mus small", on: () => !!ed.beat?.hasTuplet }),
      [tools.repeat, tools.fill, tools.redoTxt],
    ],
  };
  // ---------- diapasón táctil ----------
  const FRETS = 15, MARKS = new Set([3, 5, 7, 9, 12, 15]);
  const board = h("div", { class: "fretboard", role: "grid", "aria-label": "Diapasón: toca cuerda y traste" });
  let boardKey = "";
  function drawBoard() {
    const tr = ed.track, st = tr.staves[0], n = st.tuning.length;
    const key = `${tr.index}:${st.tuning.join()}:${hooks.lefty()}`;
    const beat = ed.beat;
    if (key !== boardKey) {
      boardKey = key;
      const frets = Array.from({ length: FRETS + 1 }, (_, f) => f);
      if (hooks.lefty()) frets.reverse();
      board.replaceChildren(
        h("div", { class: "fb-row fb-nums" }, h("span", { class: "fb-name" }, ""), ...frets.map((f) => h("span", { class: `fb-num${MARKS.has(f) ? " mk" : ""}` }, String(f)))),
        ...Array.from({ length: n }, (_, row) => {
          const s = ed.stringOfRow(row), open = st.tuning[n - s];
          return h("div", { class: "fb-row", role: "row" }, h("span", { class: "fb-name" }, pcName(open)),
            ...frets.map((f) => h("button", { class: `fb-cell${f === 0 ? " open" : ""}`, "data-row": row, "data-fret": f, "aria-label": `Cuerda ${row + 1}, traste ${f} (${pcName(open + f)})`, onclick: () => ed.fretOn(row, f) }, pcName(open + f))));
        }));
    }
    // Marca las notas del tiempo actual.
    const on = new Set((beat?.notes ?? []).map((x) => `${ed.rowOfString(x.string)}:${x.fret}`));
    for (const b of board.querySelectorAll<HTMLButtonElement>(".fb-cell")) b.classList.toggle("on", on.has(`${b.dataset.row}:${b.dataset.fret}`));
  }
  // Barra de selección: reemplaza al teclado mientras hay algo seleccionado.
  const say = (m: string) => hooks.toast(m);
  const tx = (n: number) => () => say(ed.transpose(n));
  const selRows: Key[][] = [
    [{ label: "Copiar", aria: "Copiar", act: () => say(ed.copySel()), cls: "txt" }, { label: "Cortar", aria: "Cortar (deja silencios)", act: () => say(ed.cutSel()), cls: "txt" },
      { label: "Pegar", aria: "Pegar aquí", act: () => say(ed.paste()), cls: "txt hi" }, { label: "Vaciar", aria: "Vaciar la selección", act: () => ed.deleteSel(), cls: "txt del" }],
    [{ label: "8va ↓", aria: "Transponer una octava abajo", act: tx(-12), cls: "txt" }, { label: "♭ −½", aria: "Transponer medio tono abajo", act: tx(-1), cls: "txt" },
      { label: "♯ +½", aria: "Transponer medio tono arriba", act: tx(1), cls: "txt" }, { label: "8va ↑", aria: "Transponer una octava arriba", act: tx(12), cls: "txt" }],
    [{ label: "←", aria: "Extender a la izquierda", act: () => ed.prevBeat(true), cls: "nav" }, { label: "→", aria: "Extender a la derecha", act: () => ed.nextBeatPlain(true), cls: "nav" },
      { label: "Compases", aria: "Seleccionar compases completos", act: () => ed.selectBars(), cls: "txt" }, { label: "Listo ✕", aria: "Terminar la selección", act: () => ed.clearSelection(), cls: "txt" }],
    [{ label: "Todas las pistas", aria: "Seleccionar estos compases en todas las pistas", act: () => ed.toggleAllTracks(), cls: "txt small", on: () => !!ed.sel?.all },
      { label: "Pegar insertando", aria: "Pegar abriendo compases nuevos", act: () => say(ed.paste(true)), cls: "txt small" },
      { label: "Duplicar", aria: "Duplicar los compases seleccionados", act: () => say(ed.duplicate()), cls: "txt small" },
      { label: "Borrar compases", aria: "Borrar los compases seleccionados", act: () => say(ed.deleteBars()), cls: "txt small del" }],
  ];
  const info = h("div", { class: "pinfo", "aria-live": "polite" });
  let drawn = "";
  let buttons: [HTMLButtonElement, Key][] = [];
  function update() {
    const which = ed.selecting || ed.sel ? "sel" : kindOf(ed.track) === "tab" ? (fretMode ? "fret" : "tab") : "other";
    if (which === "sel") {
      const n = ed.selectedCount, clip = ed.clip;
      const what = ed.sel?.all ? `${n} compás${n === 1 ? "" : "es"} en todas las pistas` : `${n} tiempo${n === 1 ? "" : "s"} seleccionado${n === 1 ? "" : "s"}`;
      info.textContent = `${what} · toca otro tiempo para extender${clip ? ` · en el portapapeles: ${clip.whole ? `${clip.bars.length} compás${clip.bars.length > 1 ? "es" : ""}` : "tiempos"} de ${clip.from}` : ""}`;
    }
    if (which !== drawn) {
      drawn = which;
      buttons = [];
      const rows = which === "sel" ? selRows : layouts[which];
      el.classList.toggle("selmode", which === "sel");
      el.classList.toggle("fretmode", which === "fret");
      boardKey = "";
      el.replaceChildren(...(which === "sel" ? [info] : []), ...(which === "fret" ? [board] : []), ...rows.map((row) => h("div", { class: row.every((k) => k.cls?.includes("txt small")) && which !== "sel" ? "prow trow" : "prow" }, row.map((k) => {
        const b = h("button", { class: `pk ${k.cls ?? ""}`, "aria-label": k.aria, title: k.aria, onclick: () => k.act() }, k.label);
        buttons.push([b, k]);
        return b;
      }))));
    }
    for (const [b, k] of buttons) if (k.on) b.setAttribute("aria-pressed", String(k.on()));
    if (which === "fret") drawBoard();
  }
  update();
  return { el, update };
}
