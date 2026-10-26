// Teclado propio de MusicFees: trastes, movimiento y duraciones en la pantalla, sin depender
// del teclado del teléfono (que tapa media partitura y en Android a veces no se abre).
import * as at from "@coderline/alphatab";
import type { Editor } from "../editor/editor";
import { kindOf } from "../score/model";
import { h } from "./dom";

const D = at.model.Duration;
type Key = { label: string; aria: string; act: () => void; cls?: string; on?: () => boolean };

export interface KeypadHooks {
  native: () => void; // cambiar al teclado del teléfono
  hide: () => void;
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
    kbd: { label: "⌨", aria: "Usar el teclado del teléfono", act: () => hooks.native(), cls: "nav" },
    hide: { label: "▾", aria: "Ocultar el teclado", act: () => hooks.hide(), cls: "nav" },
  };
  const durs = [dur(D.Whole, "𝅝", "Redonda"), dur(D.Half, "𝅗𝅥", "Blanca"), dur(D.Quarter, "♩", "Negra"), dur(D.Eighth, "♪", "Corchea"), dur(D.Sixteenth, "𝅘𝅥𝅯", "Semicorchea")];

  const layouts = {
    tab: [
      [1, 2, 3, 4, 5].map(digit).concat(nav.prev, nav.next, nav.del),
      [6, 7, 8, 9, 0].map(digit).concat(nav.rest, nav.bar, nav.undo),
      durs.concat(nav.dot, nav.kbd, nav.hide),
    ],
    other: [
      [nav.prev, nav.next, nav.bar, nav.del, nav.rest, nav.undo, nav.kbd, nav.hide],
      durs.concat(dur(D.ThirtySecond, "𝅘𝅥𝅰", "Fusa"), nav.dot, { label: "3", aria: "Tresillo", act: () => ed.toggleTuplet(3), cls: "mus small", on: () => !!ed.beat?.hasTuplet }),
    ],
  };
  let drawn = "";
  let buttons: [HTMLButtonElement, Key][] = [];
  function update() {
    const which = kindOf(ed.track) === "tab" ? "tab" : "other";
    if (which !== drawn) {
      drawn = which;
      buttons = [];
      el.replaceChildren(...layouts[which].map((row) => h("div", { class: "prow" }, row.map((k) => {
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
