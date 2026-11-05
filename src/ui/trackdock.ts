// Panel de pistas acoplado abajo (escritorio), como el de Guitar Pro 7: cada pista en una fila con su
// color, nombre, silencio, solo, volumen y paneo, siempre a la vista mientras se escribe. Tocar el
// nombre cambia de pista; ⋯ abre sus opciones; «Mezclador» abre el panel completo (agregar, congelar…).
import type { Editor } from "../editor/editor";
import type { Engine } from "../player/engine";
import { kindOf, drumKit, metaMap, type Op } from "../score/model";
import { PRESETS, gmName } from "../score/instruments";
import { h, icon } from "./dom";

const COLORS = ["#e5484d", "#f2a33a", "#46c37b", "#4a8cf0", "#9b5de5", "#e76f51", "#2a9d8f", "#d45d9c"];

export interface DockCtx {
  ed: Editor; engine: Engine;
  ops: (ops: Op[]) => void;
  mixer: () => void;
  trackMenu: (i: number) => void;
  close: () => void;
  frozen: () => number[];
}

export function buildTrackDock(c: DockCtx) {
  const list = h("div", { class: "dock-list", role: "list" });
  const el = h("section", { class: "trackdock", "aria-label": "Pistas" },
    h("div", { class: "dock-head" },
      h("b", null, "Pistas"),
      h("span", { class: "dock-hint" }, "Toca el nombre para escribir en esa pista"),
      h("button", { class: "tbtn", title: "Agregar pistas, congelar y volumen general", onclick: () => c.mixer() }, icon("sliders", 18), "Mezclador"),
      h("button", { class: "tbtn", "aria-label": "Ocultar pistas", title: "Ocultar pistas", onclick: () => c.close() }, icon("close", 18))),
    list);
  let key = "";
  function update(force = false) {
    const { ed } = c, sc = ed.score;
    const meta = metaMap(sc), fr = c.frozen();
    const k = JSON.stringify([ed.cursor.t, fr, sc.tracks.map((t) => [t.name, t.playbackInfo.isMute, t.playbackInfo.isSolo, t.playbackInfo.volume, t.playbackInfo.balance, t.playbackInfo.program, meta[t.index]?.color, ed.renderTracks().includes(t.index)])]);
    if (!force && k === key) return;
    key = k;
    list.replaceChildren(...sc.tracks.map((tr, i) => {
      const pi = tr.playbackInfo, kind = kindOf(tr), m = meta[i] ?? {};
      const inst = (kind === "drums" ? PRESETS.find((p) => p.program === (drumKit(sc, i) ?? 0) && p.kind === "drums")?.name : PRESETS.find((p) => p.program === pi.program && p.kind === kind)?.name) ?? gmName(pi.program);
      const vol = h("input", { type: "range", min: 0, max: 16, value: pi.volume, "aria-label": `Volumen de ${tr.name}`, title: "Volumen" });
      vol.oninput = () => c.engine.api.changeTrackVolume([tr], Number(vol.value) / 16 * 1.25);
      vol.onchange = () => c.ops([{ k: "trackProp", t: i, prop: "volume", val: Number(vol.value) }]);
      const pan = h("input", { type: "range", min: 0, max: 16, value: pi.balance, "aria-label": `Paneo de ${tr.name}`, title: "Paneo (centro = 8)" });
      pan.onchange = () => c.ops([{ k: "trackProp", t: i, prop: "balance", val: Number(pan.value) }]);
      const mix = (prop: "mute" | "solo", val: boolean) => { c.ops([{ k: "trackProp", t: i, prop, val }]); c.engine.syncMix(sc); update(true); };
      return h("div", { class: `dock-row${i === ed.cursor.t ? " on" : ""}`, role: "listitem" },
        h("span", { class: "stripe", style: `background:${m.color ?? COLORS[i % COLORS.length]}` }),
        h("button", { class: "dock-name", "aria-current": i === ed.cursor.t ? "true" : undefined, title: `Escribir en ${tr.name}`, onclick: () => ed.selectTrack(i) },
          icon(kind === "drums" ? "drum" : kind === "notation" ? "piano" : "guitar", 18),
          h("span", null, h("b", null, `${i + 1}. ${tr.name}${m.locked ? " 🔒" : ""}${fr.includes(i) ? " ❄" : ""}`), h("small", null, inst))),
        h("button", { class: "ibtn", "aria-label": `Silenciar ${tr.name}`, title: "Silenciar", "aria-pressed": pi.isMute, onclick: () => mix("mute", !pi.isMute) }, icon("mute", 18)),
        h("button", { class: "ibtn solo", "aria-label": `Solo ${tr.name}`, title: "Solo", "aria-pressed": pi.isSolo, onclick: () => mix("solo", !pi.isSolo) }, icon("solo", 18)),
        h("label", { class: "dock-fader" }, h("small", null, "Vol"), vol),
        h("label", { class: "dock-fader pan" }, h("small", null, "Pan"), pan),
        h("button", { class: "ibtn", "aria-label": `Opciones de ${tr.name}`, title: "Opciones de la pista", onclick: () => c.trackMenu(i) }, icon("dots", 18)));
    }));
  }
  return { el, update };
}
