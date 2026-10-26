// Entrada con el teclado normal del teléfono (Samsung, Gboard) y de la computadora.
// En Android el evento keydown llega como "Unidentified", así que se lee lo que el teclado
// inserta en un campo oculto con un texto centinela y se vuelve a dejar igual cada vez.
import type { Editor } from "./editor";
import type { NoteFx } from "../score/model";
import * as at from "@coderline/alphatab";

const D = at.model.Duration;
export interface KeyHelp { keys: string; what: string; group: string }

export const KEY_HELP: KeyHelp[] = [
  { group: "Escribir", keys: "0 – 9", what: "Traste en la cuerda elegida (dos dígitos seguidos = 10 a 24)" },
  { group: "Escribir", keys: "Espacio", what: "Siguiente tiempo (lo crea si el compás tiene lugar)" },
  { group: "Escribir", keys: "Borrar ⌫", what: "Quita la nota de la cuerda; si el tiempo está vacío, lo elimina" },
  { group: "Escribir", keys: "Enter", what: "Siguiente compás (lo crea al final)" },
  { group: "Escribir", keys: "Z", what: "Silencio: vacía el tiempo" },
  { group: "Escribir", keys: "K / J", what: "Cuerda más aguda / más grave (también puedes tocarla)" },
  { group: "Duración", keys: "R B N C S F", what: "Redonda, blanca, negra, corchea, semicorchea, fusa" },
  { group: "Duración", keys: ".", what: "Puntillo" },
  { group: "Duración", keys: ",", what: "Tresillo" },
  { group: "Dinámica", keys: "+  /  −", what: "Más fuerte / más suave desde aquí (ppp … fff)" },
  { group: "Dinámica", keys: "<  /  >", what: "Crescendo / decrescendo" },
  { group: "Dinámica", keys: "A  /  !", what: "Acento / acento fuerte" },
  { group: "Efectos", keys: "H", what: "Ligado (hammer-on / pull-off)" },
  { group: "Efectos", keys: "D", what: "Deslizar (slide)" },
  { group: "Efectos", keys: "E", what: "Estirar (bend de un tono)" },
  { group: "Efectos", keys: "V", what: "Vibrato" },
  { group: "Efectos", keys: "P", what: "Palm mute (apagado)" },
  { group: "Efectos", keys: "L", what: "Dejar sonar (let ring)" },
  { group: "Efectos", keys: "X", what: "Nota muerta" },
  { group: "Efectos", keys: "G", what: "Nota fantasma" },
  { group: "Efectos", keys: "T", what: "Tapping" },
  { group: "Efectos", keys: "M", what: "Armónico natural" },
  { group: "Efectos", keys: "I", what: "Staccato" },
  { group: "Efectos", keys: "U", what: "Unir con la nota anterior (ligadura)" },
  { group: "Teclados y batería", keys: "1 2 4 8 6 3", what: "Duración: redonda, blanca, negra, corchea, semicorchea, fusa" },
];

const FX: Record<string, NoteFx> = { h: "hammer", d: "slide", e: "bend", v: "vibrato", p: "palmMute", l: "letRing", x: "dead", g: "ghost", m: "harmonic", i: "staccato", u: "tie", a: "accent", "!": "heavyAccent" };
const DURS: Record<string, number> = { r: D.Whole, b: D.Half, n: D.Quarter, c: D.Eighth, s: D.Sixteenth, f: D.ThirtySecond };

export class KeyInput {
  private input: HTMLInputElement;
  private readonly SENT = "··";
  constructor(private ed: Editor, private toast: (msg: string) => void) {
    const el = document.createElement("input");
    el.type = "text";
    el.id = "kbd";
    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("enterkeyhint", "next");
    el.setAttribute("aria-label", "Teclado de edición");
    el.inputMode = "text";
    el.value = this.SENT;
    document.body.appendChild(el);
    this.input = el;
    el.addEventListener("keydown", (e) => this.onKeyDown(e));
    el.addEventListener("input", () => this.onInput());
    el.addEventListener("compositionend", () => this.onInput());
    el.addEventListener("focus", () => { document.body.classList.add("typing"); this.reset(); });
    el.addEventListener("blur", () => document.body.classList.remove("typing"));
    // Teclado físico (computadora, tableta con funda): escribe aunque el campo oculto no tenga el foco.
    document.addEventListener("keydown", (e) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a === this.input || a.closest("input,textarea,select,[contenteditable]"))) return;
      if (document.querySelector(".sheet")) return;
      this.onKeyDown(e);
    });
  }
  /** Abre el teclado del teléfono. Si el campo ya tenía el foco (el usuario bajó el teclado con
   *  «atrás»), volver a enfocarlo no hace nada en Android: hay que soltarlo y tomarlo otra vez. */
  focus() {
    if (this.focused) this.input.blur();
    this.input.focus({ preventScroll: true });
    this.reset();
  }
  blur() { this.input.blur(); }
  get focused() { return document.activeElement === this.input; }
  private reset() {
    this.input.value = this.SENT;
    try { this.input.setSelectionRange(this.SENT.length, this.SENT.length); } catch { /* algunos navegadores */ }
  }
  private onKeyDown(e: KeyboardEvent) {
    if (e.isComposing || e.key === "Unidentified" || e.key === "Process" || e.keyCode === 229) return;
    const k = e.key;
    let handled = true;
    if (k === "Backspace" || k === "Delete") this.ed.backspace();
    else if (k === "Enter") this.ed.gotoNextBar();
    else if (k === "ArrowLeft") this.ed.prevBeat();
    else if (k === "ArrowRight") this.ed.nextBeatPlain();
    else if (k === "ArrowUp") this.ed.stringUp();
    else if (k === "ArrowDown") this.ed.stringDown();
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") e.shiftKey ? this.ed.redo() : this.ed.undo();
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "y") this.ed.redo();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) handled = this.char(k);
    else handled = false;
    if (handled) { e.preventDefault(); this.reset(); }
  }
  private onInput() {
    const v = this.input.value;
    if (v.length < this.SENT.length) {
      for (let i = 0; i < this.SENT.length - v.length; i++) this.ed.backspace();
    } else {
      const added = v.startsWith(this.SENT) ? v.slice(this.SENT.length) : v.replace(/·/g, "");
      for (const ch of added) {
        if (ch === "\n") this.ed.gotoNextBar();
        else this.char(ch);
      }
    }
    this.reset();
  }
  /** Interpreta un carácter. Devuelve false si no tiene atajo. */
  char(ch: string): boolean {
    const ed = this.ed, lower = ch.toLowerCase();
    if (/^[0-9]$/.test(ch)) { ed.digit(Number(ch)); return true; }
    if (ch === " ") { ed.advance(); return true; }
    if (ch === ".") { ed.toggleDot(); return true; }
    if (ch === ",") { ed.toggleTuplet(3); return true; }
    if (ch === "+" || ch === "=") { ed.louder(); return true; }
    if (ch === "-" || ch === "–" || ch === "−" || ch === "_") { ed.softer(); return true; }
    if (ch === "<") { ed.hairpin(1); return true; }
    if (ch === ">") { ed.hairpin(2); return true; }
    if (lower === "z") { ed.clearBeat(); return true; }
    if (lower === "k") { ed.stringUp(); return true; }
    if (lower === "j") { ed.stringDown(); return true; }
    if (lower === "t") { ed.beatFx("tap"); return true; }
    if (DURS[lower] !== undefined) { ed.setDuration(DURS[lower]); return true; }
    if (FX[ch] || FX[lower]) {
      const msg = ed.toggleNoteFx(FX[ch] ?? FX[lower]);
      if (msg) this.toast(msg);
      return true;
    }
    return false;
  }
}
