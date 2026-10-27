// Teclado propio de MusicFees: trastes, movimiento y duraciones en la pantalla, sin depender
// del teclado del teléfono (que tapa media partitura y en Android a veces no se abre).
import * as at from "@coderline/alphatab";
import type { Editor } from "../editor/editor";
import { kindOf } from "../score/model";
import { h } from "./dom";

const D = at.model.Duration;
type Key = { label: string; aria: string; act: () => void; cls?: string; on?: () => boolean };

export interface KeypadHooks {
  hide: () => void;
  toast: (m: string) => void;
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
  const durs = [dur(D.Whole, "𝅝", "Redonda"), dur(D.Half, "𝅗𝅥", "Blanca"), dur(D.Quarter, "♩", "Negra"), dur(D.Eighth, "♪", "Corchea"), dur(D.Sixteenth, "𝅘𝅥𝅯", "Semicorchea")];

  const layouts = {
    tab: [
      [1, 2, 3, 4, 5].map(digit).concat(nav.prev, nav.next, nav.del),
      [6, 7, 8, 9, 0].map(digit).concat(nav.rest, nav.bar, nav.undo),
      durs.concat(nav.dot, nav.sel, nav.hide),
    ],
    other: [
      [nav.prev, nav.next, nav.bar, nav.del, nav.rest, nav.undo, nav.sel, nav.hide],
      durs.concat(dur(D.ThirtySecond, "𝅘𝅥𝅰", "Fusa"), nav.dot, { label: "3", aria: "Tresillo", act: () => ed.toggleTuplet(3), cls: "mus small", on: () => !!ed.beat?.hasTuplet }),
    ],
  };
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
    const which = ed.selecting || ed.sel ? "sel" : kindOf(ed.track) === "tab" ? "tab" : "other";
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
      el.replaceChildren(...(which === "sel" ? [info] : []), ...rows.map((row) => h("div", { class: "prow" }, row.map((k) => {
        const b = h("button", { class: `pk ${k.cls ?? ""}`, "aria-label": k.aria, title: k.aria, onclick: () => k.act() }, k.label);
        buttons.push([b, k]);
        return b;
      }))));
    }
    for (const [b, k] of buttons) if (k.on) b.setAttribute("aria-pressed", String(k.on()));
  }
  update();
  return { el, update };
}
