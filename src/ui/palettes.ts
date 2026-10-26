// Paletas tipo Guitar Pro que se abren sobre la barra (y sobre el teclado del teléfono).
import * as at from "@coderline/alphatab";
import type { Editor } from "../editor/editor";
import { noteFxState, type NoteFx } from "../score/model";
import { h, icon } from "./dom";

const D = at.model.Duration;
interface Ctx { toast: (m: string, err?: boolean) => void; close: () => void }

function pbtn(glyph: string, label: string, onClick: () => void, opts: { pressed?: boolean; cls?: string; text?: string } = {}) {
  return h("button", { class: "pbtn", title: label, "aria-label": label, "aria-pressed": opts.pressed ?? false, onclick: onClick },
    h("span", { class: opts.cls ?? "g" }, glyph), opts.text ? h("span", { class: "t" }, opts.text) : null);
}
function frame(title: string, ctx: Ctx, ...sections: HTMLElement[]) {
  return h("div", { class: "palette", role: "dialog", "aria-label": title },
    h("button", { class: "tbtn close", "aria-label": "Cerrar", onclick: ctx.close }, icon("close", 18)),
    ...sections);
}
const grid = (title: string, ...btns: HTMLElement[]) => h("div", null, h("h3", null, title), h("div", { class: "grid" }, ...btns));

export function buildPalettes(ed: Editor, ctx: Ctx): Record<string, () => HTMLElement> {
  const fx = (f: NoteFx) => { const m = ed.toggleNoteFx(f); if (m) ctx.toast(m); };
  const fxOn = (f: NoteFx) => { const n = ed.noteAtCursor(); return n ? noteFxState(n, f) : false; };
  return {
    bar() {
      const mb = ed.masterBar;
      const ts = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "9/8", "12/8"];
      const sectionIn = h("input", { type: "text", placeholder: "Nombre (Verso, Coro…)", "aria-label": "Nombre de la sección", value: mb.section?.text ?? "" });
      const nextLetter = () => String.fromCharCode(65 + ed.score.masterBars.filter((m, i) => m.section && i < ed.cursor.b).length);
      const setSection = (name: string) => ed.barProp("section", `${nextLetter()}|${name}`);
      const tempoIn = h("input", { type: "number", min: 30, max: 300, value: Math.round(mb.tempoAutomation?.value ?? ed.score.tempo), "aria-label": "Tempo" });
      const keySel = h("select", { "aria-label": "Armadura" },
        [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map((k) => h("option", { value: k, selected: ed.bar.keySignature === k }, k === 0 ? "Sin alteraciones" : k > 0 ? `${k} ♯` : `${-k} ♭`)));
      keySel.onchange = () => ed.barProp("key", Number(keySel.value));
      return frame("Compás", ctx,
        grid("Compases",
          pbtn("+", "Insertar compás después", () => ed.insertBar(true), { text: "después" }),
          pbtn("+", "Insertar compás antes", () => ed.insertBar(false), { text: "antes" }),
          pbtn("−", "Borrar compás", () => ed.deleteBar(), { text: "borrar" })),
        grid("Compás de tiempo", ...ts.map((t) => pbtn(t, `Compás ${t}`, () => ed.barProp("ts", t), { pressed: `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}` === t, cls: "t" }))),
        grid("Repeticiones",
          pbtn("𝄆", "Inicio de repetición", () => ed.barProp("repeatOpen", !mb.isRepeatStart), { pressed: mb.isRepeatStart }),
          pbtn("𝄇", "Fin de repetición (2 veces)", () => ed.barProp("repeatClose", mb.repeatCount ? 0 : 2), { pressed: mb.repeatCount > 0 }),
          pbtn("1.", "Primera casilla", () => ed.barProp("alternate", mb.alternateEndings === 1 ? 0 : 1), { pressed: mb.alternateEndings === 1, cls: "t" }),
          pbtn("2.", "Segunda casilla", () => ed.barProp("alternate", mb.alternateEndings === 2 ? 0 : 2), { pressed: mb.alternateEndings === 2, cls: "t" }),
          pbtn("𝄁", "Doble barra", () => ed.barProp("doubleBar", !mb.isDoubleBar), { pressed: mb.isDoubleBar })),
        h("div", null, h("h3", null, "Sección"),
          h("div", { class: "inline" }, sectionIn,
            h("button", { class: "ghost", onclick: () => sectionIn.value.trim() && setSection(sectionIn.value.trim()) }, "Marcar"),
            h("button", { class: "ghost", onclick: () => ed.barProp("section", null) }, "Quitar")),
          h("div", { class: "inline", style: "margin-top:6px" }, ["Intro", "Verso", "Pre-coro", "Coro", "Puente", "Solo", "Outro"].map((n) => h("button", { class: "ghost", style: "height:34px", onclick: () => setSection(n) }, n)))),
        h("div", null, h("h3", null, "Tempo y armadura desde este compás"),
          h("div", { class: "inline" }, tempoIn, h("button", { class: "ghost", onclick: () => ed.barProp("tempo", Number(tempoIn.value)) }, "Cambiar tempo"), keySel)),
      );
    },
    note() {
      const b = ed.beat, dur = b?.duration;
      const durs: [number, string, string][] = [[D.Whole, "𝅝", "Redonda (R)"], [D.Half, "𝅗𝅥", "Blanca (B)"], [D.Quarter, "♩", "Negra (N)"], [D.Eighth, "♪", "Corchea (C)"], [D.Sixteenth, "𝅘𝅥𝅯", "Semicorchea (S)"], [D.ThirtySecond, "𝅘𝅥𝅰", "Fusa (F)"], [D.SixtyFourth, "𝅘𝅥𝅱", "Semifusa"]];
      const dyn = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
      return frame("Nota", ctx,
        grid("Duración", ...durs.map(([d, g, l]) => pbtn(g, l, () => ed.setDuration(d), { pressed: dur === d })),
          pbtn("𝄽", "Silencio (Z)", () => ed.clearBeat()),
          pbtn("·", "Puntillo (.)", () => ed.toggleDot(), { pressed: b?.dots === 1 }),
          pbtn("··", "Doble puntillo", () => ed.toggleDoubleDot(), { pressed: b?.dots === 2 }),
          pbtn("3", "Tresillo (,)", () => ed.toggleTuplet(3), { pressed: !!b?.hasTuplet && b.tupletNumerator === 3, cls: "t" }),
          pbtn("5", "Quintillo", () => ed.toggleTuplet(5), { pressed: !!b?.hasTuplet && b.tupletNumerator === 5, cls: "t" }),
          pbtn("6", "Seisillo", () => ed.toggleTuplet(6), { pressed: !!b?.hasTuplet && b.tupletNumerator === 6, cls: "t" }),
          pbtn("⁀", "Ligadura con la anterior (U)", () => fx("tie"), { pressed: fxOn("tie") })),
        grid("Dinámica desde aquí (+ / −)", ...dyn.map((d, i) => pbtn(d, `Dinámica ${d}`, () => ed.setDynamic(i), { pressed: ed.dynamic === i, cls: "dyn" })),
          pbtn("𝆒", "Crescendo (<)", () => ed.hairpin(1), { pressed: b?.crescendo === 1 }),
          pbtn("𝆓", "Decrescendo (>)", () => ed.hairpin(2), { pressed: b?.crescendo === 2 })),
        grid("Articulación",
          pbtn(">", "Acento (A)", () => fx("accent"), { pressed: fxOn("accent") }),
          pbtn("^", "Acento fuerte (!)", () => fx("heavyAccent"), { pressed: fxOn("heavyAccent") }),
          pbtn("·", "Staccato (I)", () => fx("staccato"), { pressed: fxOn("staccato") }),
          pbtn("◇", "Armónico (M)", () => fx("harmonic"), { pressed: fxOn("harmonic") })),
      );
    },
    fx() {
      const b = ed.beat;
      const e = (g: string, l: string, f: NoteFx, txt?: string) => pbtn(g, l, () => fx(f), { pressed: fxOn(f), text: txt });
      return frame("Efectos", ctx,
        grid("Mano izquierda",
          e("◡", "Ligado: hammer-on / pull-off (H)", "hammer", "H"),
          e("╱", "Deslizar / slide (D)", "slide", "D"),
          e("↗", "Estirar / bend (E)", "bend", "E"),
          e("〰", "Vibrato (V)", "vibrato", "V"),
          e("◇", "Armónico natural (M)", "harmonic", "M"),
          pbtn("T", "Tapping (T)", () => ed.beatFx("tap"), { pressed: !!b?.tap, cls: "t", text: "tap" })),
        grid("Mano derecha",
          e("P.M.", "Palm mute (P)", "palmMute", "P"),
          e("◌", "Dejar sonar / let ring (L)", "letRing", "L"),
          e("✕", "Nota muerta (X)", "dead", "X"),
          e("( )", "Nota fantasma (G)", "ghost", "G"),
          pbtn("↓", "Púa abajo", () => ed.pickStroke(2), { pressed: b?.pickStroke === 2 }),
          pbtn("↑", "Púa arriba", () => ed.pickStroke(1), { pressed: b?.pickStroke === 1 }),
          pbtn("S", "Slap", () => ed.beatFx("slap"), { pressed: !!b?.slap, cls: "t", text: "slap" }),
          pbtn("P", "Pop", () => ed.beatFx("pop"), { pressed: !!b?.pop, cls: "t", text: "pop" }),
          pbtn("⟋", "Fade in (volumen)", () => ed.beatFx("fadeIn"), { pressed: b?.fade === at.model.FadeType.FadeIn }),
          pbtn("≈", "Vibrato ancho (palanca)", () => ed.beatFx("vibratoBeat"), { pressed: b ? b.vibrato !== at.model.VibratoType.None : false })),
        h("p", { class: "note" }, "Los efectos se aplican a la nota de la cuerda elegida. Pulsa otra vez para quitarlos."),
      );
    },
    text() {
      const txt = h("input", { type: "text", placeholder: "Texto sobre el tiempo (p. ej. «suave»)", value: ed.beat?.text ?? "", "aria-label": "Texto" });
      return frame("Texto", ctx,
        h("div", null, h("h3", null, "Texto en este tiempo"),
          h("div", { class: "inline" }, txt, h("button", { class: "ghost", onclick: () => ed.text(txt.value.trim()) }, "Aplicar"), h("button", { class: "ghost", onclick: () => ed.text("") }, "Quitar"))),
        h("p", { class: "note" }, "Para acordes con diagrama usa «Acordes»; para la letra, «Letra». Para secciones (Intro, Coro…), la paleta de compás."),
      );
    },
  };
}
