// Hojas de pantalla completa: Tracks, Sets, menú del logo y diálogos.
import * as at from "@coderline/alphatab";
import type { Editor } from "../editor/editor";
import type { Engine } from "../player/engine";
import type { KeyInput } from "../editor/keys";
import type { Cloud, LiveSession } from "../collab/cloud";
import { localList, forgetSong, loadLocalDoc } from "../collab/cloud";
import type { ClaudeLibrary } from "../collab/claudeLib";
import { kindOf, fxMap, masterOf, type MasterFx, type Op, type Pedal, type PedalType, type PluginRef, type TrackFx } from "../score/model";
import { WAM_CATALOG, PLUGIN_CATS, pluginName, publicPluginUrl } from "../player/wam";
import { FX_PRESETS, FX_SLIDERS, MASTER_PRESETS, MASTER_SLIDERS, PEDALS, octaveSemis, pedalInfo, presetFx } from "../player/fxPresets";
import { PRESETS, STYLES, TUNINGS, presetById } from "../score/instruments";
import { CHORDS, NOTE_NAMES, diagramSvg, keysVoicing, pcName, voicings, G6, type NameSys } from "../score/chords";
import { KEY_HELP } from "../editor/keys";
import { exportAudio, exportGp, exportMidi, exportPdf, importFile } from "../export/exporters";
import { h, icon } from "./dom";
import { ARTIFACT } from "../config";
import type { Bank } from "../player/banks";

export interface AppCtx {
  ed: Editor; engine: Engine; keys: KeyInput; cloud: Cloud;
  claudeLib: ClaudeLibrary | null;
  addSong: (s: at.model.Score, toCloud?: boolean) => Promise<string>;
  setFx: (on: boolean) => Promise<void>;
  toast: (m: string, err?: boolean) => void;
  banks: Bank[];
  readonly bank: Bank;
  setBank: (id: string, onProgress?: (pct: number) => void) => Promise<void>;
  hasPack: (p: NonNullable<Bank["pack"]>) => Promise<boolean>;
  openSong: (id: string) => Promise<void>;
  newSong: (style: string, title: string, bars: number, cloud: boolean) => Promise<void>;
  shareSong: () => Promise<string | null>;
  importScore: (s: at.model.Score, name?: string) => Promise<void>;
  refresh: () => void;
  prefs: Record<string, unknown>;
  savePrefs: () => void;
  readonly songId: string | null;
  readonly isCloud: boolean;
  readonly live: LiveSession | null;
}

const groupBy = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => { (m[k(x)] ??= []).push(x); return m; }, {} as Record<string, T[]>);
function presetOptions(sel?: string) {
  return Object.entries(groupBy(PRESETS, (p) => p.group)).map(([g, ps]) =>
    h("optgroup", { label: g }, ps.map((p) => h("option", { value: p.id, selected: p.id === sel }, p.name))));
}

export class Sheets {
  private el: HTMLElement | null = null;
  constructor(private c: AppCtx) {}

  close() { this.el?.remove(); this.el = null; this.c.refresh(); }
  private open(title: string, side: "left" | "right" | "full" | "gate", ...content: (HTMLElement | null)[]) {
    this.el?.remove();
    this.c.keys.blur();
    const body = h("div", { class: "body" }, ...content);
    const closable = side !== "gate";
    const card = h("div", { class: "card" },
      h("header", null, h("h2", null, title), closable ? h("button", { class: "ibtn", "aria-label": "Cerrar", onclick: () => this.close() }, icon("close", 20)) : null),
      body);
    this.el = h("div", { class: `sheet ${side === "gate" ? "full gate" : side}`, role: "dialog", "aria-label": title, onclick: (e: Event) => { if (closable && e.target === this.el) this.close(); } }, card);
    document.body.append(this.el);
    return body;
  }
  private ops(ops: Op[]) { this.c.ed.commit(ops); }

  // ---------- Tracks: pistas y mezclador ----------
  tracks() {
    const { ed, engine } = this.c;
    const list = h("div", { class: "trlist" });
    const render = () => {
      list.replaceChildren();
      ed.score.tracks.forEach((tr, i) => {
        const kind = kindOf(tr), pi = tr.playbackInfo;
        const colors = ["#e5484d", "#f2a33a", "#46c37b", "#4a8cf0", "#9b5de5", "#e76f51", "#2a9d8f", "#d45d9c"];
        const vol = h("input", { type: "range", min: 0, max: 16, value: pi.volume, "aria-label": `Volumen de ${tr.name}` });
        const pan = h("input", { type: "range", min: 0, max: 16, value: pi.balance, "aria-label": `Paneo de ${tr.name}` });
        vol.onchange = () => this.ops([{ k: "trackProp", t: i, prop: "volume", val: Number(vol.value) }]);
        pan.onchange = () => this.ops([{ k: "trackProp", t: i, prop: "balance", val: Number(pan.value) }]);
        vol.oninput = () => engine.api.changeTrackVolume([tr], Number(vol.value) / 16 * 1.25);
        const mute = h("button", { class: "ibtn", "aria-label": "Silenciar", "aria-pressed": pi.isMute, onclick: () => { this.ops([{ k: "trackProp", t: i, prop: "mute", val: !pi.isMute }]); engine.syncMix(ed.score); render(); } }, icon("mute", 18));
        const solo = h("button", { class: "ibtn solo", "aria-label": "Solo", "aria-pressed": pi.isSolo, onclick: () => { this.ops([{ k: "trackProp", t: i, prop: "solo", val: !pi.isSolo }]); engine.syncMix(ed.score); render(); } }, icon("solo", 18));
        const del = h("button", { class: "ibtn", "aria-label": `Borrar ${tr.name}` }, icon("trash", 18));
        del.onclick = () => {
          if (ed.score.tracks.length <= 1) { this.c.toast("La canción necesita al menos una pista."); return; }
          if (del.dataset.armed) { this.ops([{ k: "trackDel", t: i }]); if (ed.cursor.t >= ed.score.tracks.length) ed.selectTrack(ed.score.tracks.length - 1); render(); return; }
          del.dataset.armed = "1"; del.style.background = "#e5484d"; this.c.toast("Toca otra vez para borrar la pista.");
          setTimeout(() => { delete del.dataset.armed; del.style.background = ""; }, 3000);
        };
        const row = h("div", { class: `tr${i === ed.cursor.t ? " on" : ""}` },
          h("span", { class: "stripe", style: `background:${colors[i % colors.length]}` }),
          h("span", { class: "ic" }, icon(kind === "drums" ? "drum" : kind === "notation" ? "piano" : "guitar", 22)),
          h("button", { class: "nm", style: "background:none;border:0;text-align:left;padding:0", onclick: () => { ed.selectTrack(i); this.close(); } },
            h("b", null, `${i + 1}  ${tr.name}`), h("small", null, PRESETS.find((p) => p.program === pi.program && p.kind === kind)?.name ?? `Sonido GM ${pi.program}`)),
          h("span", { class: "acts" },
            h("button", { class: "ibtn", "aria-label": "Ver esta pista", "aria-pressed": ed.renderTracks().includes(i), onclick: () => { ed.selectTrack(i); this.close(); } }, icon("eye", 18)),
            mute, solo),
          h("div", { class: "mix" }, h("span", null, "Vol."), vol, h("span", null, "Pan"), pan),
          h("div", { class: "inline", style: "grid-column:3/5" },
            h("button", { class: "ibtn", "aria-label": "Subir", disabled: i === 0, onclick: () => { this.ops([{ k: "trackMove", t: i, to: i - 1 }]); render(); } }, icon("up", 18)),
            h("button", { class: "ibtn", "aria-label": "Bajar", disabled: i === ed.score.tracks.length - 1, onclick: () => { this.ops([{ k: "trackMove", t: i, to: i + 1 }]); render(); } }, icon("down", 18)),
            del));
        list.append(row);
      });
    };
    render();
    const sel = h("select", { "aria-label": "Instrumento de la nueva pista" }, presetOptions("piano"));
    const master = h("input", { type: "range", min: 0, max: 100, value: Math.round(engine.master * 100), "aria-label": "Volumen general" });
    master.oninput = () => (engine.master = Number(master.value) / 100);
    this.open("Tracks", "left", list,
      h("div", { class: "sec" }, h("h3", null, "Agregar pista"),
        h("div", { class: "inline" }, sel, h("button", { class: "primary", onclick: () => {
          const p = presetById(sel.value)!;
          this.ops([{ k: "trackAdd", preset: p.id, name: p.name }]);
          ed.selectTrack(ed.score.tracks.length - 1);
          render();
        } }, "+ Agregar"))),
      h("div", { class: "sec" }, h("h3", null, "Master"), h("div", { class: "field" }, h("label", null, "Volumen general"), master)),
      h("p", { class: "note" }, "Silencio y solo se guardan con la canción, igual que en Guitar Pro. El volumen se escucha al instante."));
  }

  // ---------- Sets: canción y pista ----------
  sets(tab: "song" | "track" = "track") {
    const { ed } = this.c;
    const body = this.open("Sets", "right");
    const tabs = h("div", { class: "tabs2" },
      h("button", { "aria-pressed": tab === "song", onclick: () => this.sets("song") }, "CANCIÓN"),
      h("button", { "aria-pressed": tab === "track", onclick: () => this.sets("track") }, "PISTA"));
    body.append(tabs);
    const field = (label: string, input: HTMLElement) => h("div", { class: "field" }, h("label", null, label), input);
    if (tab === "song") {
      const sc = ed.score;
      const txt = (prop: "title" | "artist" | "album" | "music" | "words", label: string) => {
        const i = h("input", { type: "text", value: (sc as unknown as Record<string, string>)[prop] ?? "", "aria-label": label });
        i.onchange = () => this.ops([{ k: "songProp", prop, val: i.value }]);
        return field(label, i);
      };
      const tempo = h("input", { type: "number", min: 30, max: 300, value: Math.round(sc.tempo), "aria-label": "Tempo" });
      tempo.onchange = () => this.ops([{ k: "songProp", prop: "tempo", val: Number(tempo.value) }]);
      const name = h("input", { type: "text", value: String(this.c.prefs.name ?? ""), placeholder: "Cómo te ve tu dúo", "aria-label": "Tu nombre" });
      name.onchange = () => { this.c.prefs.name = name.value.trim().slice(0, 24); this.c.savePrefs(); this.c.toast("Se verá al reabrir la canción."); };
      body.append(
        h("div", { class: "sec" }, h("h3", null, "Información"), txt("title", "Título"), txt("artist", "Artista"), txt("album", "Álbum"), txt("music", "Música"), txt("words", "Letra de"), field("Tempo inicial", tempo)),
        h("div", { class: "sec" }, h("h3", null, "Dúo en vivo"), field("Tu nombre", name),
          h("p", { class: "note" }, this.c.isCloud ? "Esta canción está en la nube. Comparte el enlace desde el menú (logo → Archivo → Compartir) y edítenla al mismo tiempo." : "Esta canción solo está en este teléfono. Al compartirla se sube a la nube.")));
      return;
    }
    const tr = ed.track, st = tr.staves[0], kind = kindOf(tr), i = ed.cursor.t;
    const nm = h("input", { type: "text", value: tr.name, "aria-label": "Nombre de la pista" });
    nm.onchange = () => this.ops([{ k: "trackProp", t: i, prop: "name", val: nm.value }]);
    const prog = h("select", { "aria-label": "Sonido" }, presetOptions(PRESETS.find((p) => p.program === tr.playbackInfo.program && p.kind === kind)?.id));
    prog.onchange = () => {
      const p = presetById(prog.value)!;
      if (p.kind !== kind) { this.c.toast(`«${p.name}» se escribe distinto a esta pista. Agrega una pista nueva desde Tracks.`, true); prog.value = PRESETS.find((x) => x.program === tr.playbackInfo.program && x.kind === kind)?.id ?? ""; return; }
      this.ops([{ k: "trackProp", t: i, prop: "program", val: p.program }]);
    };
    body.append(h("div", { class: "sec" }, h("h3", null, "Información"), field("Nombre", nm), field("Sonido", prog)));
    if (kind === "tab") {
      const n = st.tuning.length;
      const tunSel = h("select", { "aria-label": "Afinación" },
        Object.entries(TUNINGS).filter(([, t]) => t.strings.length === n).map(([id, t]) => h("option", { value: id, selected: t.strings.join() === st.tuning.join() }, t.name)),
        h("option", { value: "", selected: !Object.values(TUNINGS).some((t) => t.strings.join() === st.tuning.join()) }, "Personalizada"));
      tunSel.onchange = () => { const t = TUNINGS[tunSel.value]; if (t) this.ops([{ k: "trackProp", t: i, prop: "tuning", val: t.strings }]); };
      const strings = h("div", { class: "inline" }, st.tuning.map((m, r) => {
        const s = h("select", { "aria-label": `Cuerda ${r + 1}` }, Array.from({ length: 49 }, (_, k) => 24 + k).map((v) => h("option", { value: v, selected: v === m }, `${pcName(v)}${Math.floor(v / 12) - 1}`)));
        s.style.width = "72px";
        s.onchange = () => { const nt = st.tuning.slice(); nt[r] = Number(s.value); this.ops([{ k: "trackProp", t: i, prop: "tuning", val: nt }]); };
        return s;
      }));
      const capo = h("input", { type: "number", min: 0, max: 12, value: st.capo, "aria-label": "Capo" });
      capo.onchange = () => this.ops([{ k: "trackProp", t: i, prop: "capo", val: Number(capo.value) }]);
      body.append(h("div", { class: "sec" }, h("h3", null, "Notación musical"),
        field("Mostrar", h("div", { class: "inline" },
          h("button", { class: "ghost", "aria-pressed": st.showTablature, style: st.showTablature ? "background:#4a8cf0" : "", onclick: () => { this.ops([{ k: "trackProp", t: i, prop: "showTab", val: !st.showTablature }]); this.sets("track"); } }, "Tablatura"),
          h("button", { class: "ghost", "aria-pressed": st.showStandardNotation, style: st.showStandardNotation ? "background:#4a8cf0" : "", onclick: () => { this.ops([{ k: "trackProp", t: i, prop: "showNotation", val: !st.showStandardNotation }]); this.sets("track"); } }, "Partitura"))),
        field("Afinación", tunSel), field("Cuerdas", strings), field("Capo", capo)));
    }
    const vol = h("input", { type: "range", min: 0, max: 16, value: tr.playbackInfo.volume, "aria-label": "Volumen" });
    vol.onchange = () => this.ops([{ k: "trackProp", t: i, prop: "volume", val: Number(vol.value) }]);
    const pan = h("input", { type: "range", min: 0, max: 16, value: tr.playbackInfo.balance, "aria-label": "Paneo" });
    pan.onchange = () => this.ops([{ k: "trackProp", t: i, prop: "balance", val: Number(pan.value) }]);
    body.append(h("div", { class: "sec" }, h("h3", null, "Sonido"), field("Volumen", vol), field("Paneo", pan),
      h("p", { class: "note" }, `Sonidos del banco ${this.c.bank.name} (cámbialo en el menú → Sonido).`)));
    body.append(this.fxSection(i));
  }

  /** Efectos de la pista: preset y perillas. Se oyen al momento; se guardan al soltar. */
  private fxSection(i: number) {
    const { ed, engine } = this.c;
    const sec = h("div", { class: "sec" }, h("h3", null, "Efectos"));
    if (!engine.fx) {
      const btn = h("button", { class: "primary" }, "Activar efectos");
      btn.onclick = async () => { btn.disabled = true; btn.textContent = "Preparando…"; await this.c.setFx(true); this.sets("track"); };
      sec.append(h("p", { class: "note" }, "Amplificador con distorsión, ecualizador, compresor, chorus, delay, reverb y pedales para cada pista. Usan el motor de estudio (también toca metrónomo y cuenta inicial)."), btn);
      return sec;
    }
    let cur: TrackFx | null = fxMap(ed.score)[i] ?? null;
    const save = () => ed.commit([{ k: "trackFx", t: i, fx: cur }], { render: false }); // sin redibujar: no corta la reproducción
    const sel = h("select", { "aria-label": "Preset de efectos", id: "fx-preset" },
      h("option", { value: "", selected: !cur }, "Sin efectos"),
      FX_PRESETS.map((p) => h("option", { value: p.id, selected: cur?.preset === p.id }, p.name)),
      h("option", { value: "custom", selected: cur?.preset === "custom" }, "Personalizado"));
    const knobs = h("div", { class: "knobs" });
    const pedalsBox = h("div", { class: "pedals" });
    const live = () => engine.fx?.setTrackFx(i, cur);
    const drawPedals = () => {
      const list = cur?.pedals ?? [];
      const setList = (next: Pedal[], saveNow = true) => { cur = { ...(cur ?? { ...presetFx("clean")! }), pedals: next }; live(); if (saveNow) save(); drawPedals(); };
      pedalsBox.replaceChildren(
        ...list.map((p, k) => {
          const info = pedalInfo(p.type);
          const typeSel = h("select", { "aria-label": `Pedal ${k + 1}` }, PEDALS.map((x) => h("option", { value: x.type, selected: x.type === p.type }, x.name)));
          typeSel.onchange = () => setList(list.map((q, j) => (j === k ? { ...q, type: typeSel.value as PedalType } : q)));
          const knob = (key: "mix" | "a" | "b", label: string) => {
            if (label === "—") return null;
            const id = `pd-${k}-${key}`;
            const r = h("input", { type: "range", min: 0, max: 10, step: 1, value: p[key], id, "aria-label": `${info.name}: ${label}` });
            const show = (v: number) => (key === "a" && p.type === "octave" ? `${octaveSemis(v) > 0 ? "+" : ""}${octaveSemis(v)}` : String(v));
            const out = h("output", { for: id }, show(p[key]));
            r.oninput = () => { const v = Number(r.value); out.textContent = show(v); cur = { ...cur!, pedals: (cur!.pedals ?? []).map((q, j) => (j === k ? { ...q, [key]: v } : q)) }; live(); };
            r.onchange = save;
            return h("label", { class: "knob", for: id }, h("span", null, label), r, out);
          };
          const del = h("button", { class: "ibtn", "aria-label": `Quitar ${info.name}`, onclick: () => setList(list.filter((_, j) => j !== k)) }, icon("trash", 18));
          const up = k > 0 ? h("button", { class: "ibtn", "aria-label": "Antes en la cadena", onclick: () => { const n = list.slice(); [n[k - 1], n[k]] = [n[k], n[k - 1]]; setList(n); } }, icon("up", 18)) : null;
          return h("div", { class: "pedal" }, h("div", { class: "inline" }, h("b", null, `${k + 1}.`), typeSel, up, del),
            h("div", { class: "knobs" }, knob("mix", "Mezcla"), knob("a", info.a), knob("b", info.b)));
        }),
        list.length < 4 ? h("button", { class: "ghost", onclick: () => setList([...list, { type: "phaser", mix: 5, a: 4, b: 6 }]) }, "+ Agregar pedal") : h("p", { class: "note" }, "Máximo 4 pedales por pista."));
    };
    // ---------- plugins WAM de terceros ----------
    const plugBox = h("div", { class: "pedals" });
    const drawPlugins = () => {
      const list = cur?.plugins ?? [];
      const setList = (next: PluginRef[]) => { cur = { ...(cur ?? { ...presetFx("clean")! }), plugins: next }; save(); live(); setTimeout(drawPlugins, 300); };
      const err = engine.fx?.pluginErrors.get(i);
      const add = h("select", { "aria-label": "Agregar plugin", id: "plug-add" },
        h("option", { value: "" }, "+ Agregar plugin…"),
        PLUGIN_CATS.map((c) => h("optgroup", { label: c }, WAM_CATALOG.filter((p) => p.cat === c).map((p) => h("option", { value: p.src }, `${p.name} — ${p.note}`)))),
        h("option", { value: "url" }, "Desde una dirección (WAM 2.0)…"));
      add.onchange = async () => {
        let src = add.value;
        if (!src) return;
        if (src === "url") {
          const box = h("input", { type: "url", placeholder: "https://…/index.js", "aria-label": "Dirección del plugin", style: "flex:1" });
          const ok = h("button", { class: "primary", onclick: async () => { const u = box.value.trim(); if (!/^https:\/\/.+\.js$/.test(u)) { this.c.toast("Escribe la dirección https del index.js del plugin.", true); return; } setList([...list, { src: u, name: await pluginName(u) }]); } }, "Cargar");
          add.replaceWith(h("div", { class: "inline" }, box, ok));
          box.focus();
          return;
        }
        const cat = WAM_CATALOG.find((p) => p.src === src)!;
        setList([...list, { src, name: cat.name }]);
      };
      plugBox.replaceChildren(
        ...list.map((r, k) => h("div", { class: "pedal inline" },
          h("b", { style: "flex:1;min-width:0" }, `${k + 1}. ${r.name}`),
          h("button", { class: "ghost", onclick: () => this.pluginWindow(i, k) }, "Abrir"),
          h("button", { class: "ibtn", "aria-label": `Quitar ${r.name}`, onclick: () => setList(list.filter((_, j) => j !== k)) }, icon("trash", 18)))),
        ...(err ? [h("p", { class: "note", style: "color:var(--amber)" }, err)] : []),
        list.length < 3 ? add : h("p", { class: "note" }, "Máximo 3 plugins por pista."),
        h("button", { class: "ghost", onclick: () => this.pluginLibrary() }, "Biblioteca de plugins y direcciones"));
    };
    const draw = () => {
      drawPlugins();
      knobs.replaceChildren(...(cur ? FX_SLIDERS.map(([k, label]) => {
        const r = h("input", { type: "range", min: 0, max: 10, step: 1, value: Number(cur![k]), id: `fx-${k}`, "aria-label": label });
        const out = h("output", { for: `fx-${k}` }, String(cur![k]));
        r.oninput = () => { cur = { ...cur!, [k]: Number(r.value), preset: "custom" }; out.textContent = r.value; engine.fx?.setTrackFx(i, cur); sel.value = "custom"; };
        r.onchange = save;
        return h("label", { class: "knob", for: `fx-${k}` }, h("span", null, label), r, out);
      }) : [h("p", { class: "note" }, "Elige un preset para empezar; después ajusta las perillas.")]));
      drawPedals();
    };
    sel.onchange = () => {
      const keepPedals = cur?.pedals;
      cur = sel.value === "custom" ? (cur ?? { ...presetFx("clean")!, preset: "custom" }) : sel.value ? { ...presetFx(sel.value)!, pedals: keepPedals } : null;
      engine.fx?.setTrackFx(i, cur);
      save(); draw();
    };
    draw();
    sec.append(h("div", { class: "field" }, h("label", { for: "fx-preset" }, "Preset"), sel), knobs,
      h("h3", { style: "margin-top:10px" }, "Pedales"), pedalsBox,
      h("h3", { style: "margin-top:10px" }, "Plugins (WAM 2.0)"), plugBox,
      h("p", { class: "note" }, "Plugins de terceros con el estándar Web Audio Modules. «Abrir» muestra la interfaz del propio plugin; lo que ajustes se guarda con la canción."),
      h("div", { class: "inline" }, h("button", { class: "ghost", onclick: async () => { await this.c.setFx(false); this.sets("track"); } }, "Apagar efectos")),
      h("p", { class: "note" }, "Los efectos y pedales se guardan con la canción y se graban al exportar MP3 o WAV."));
    return sec;
  }

  // ---------- menú del logo ----------
  menu(section = "Archivo") {
    const { ed, engine } = this.c;
    const body = this.open("MusicFees", "full");
    const sections = ["Archivo", "Editar", "Pista", "Compás", "Nota", "Sección", "Herramientas", "Sonido", "Vista", "Ayuda"];
    body.append(h("div", { class: "menu-tabs" }, sections.map((s) => h("button", { "aria-pressed": s === section, onclick: () => this.menu(s) }, s))));
    const item = (label: string, sub: string, fn: () => void) => h("button", { onclick: () => fn() }, label, sub ? h("small", null, sub) : null);
    const close = (fn: () => void) => () => { this.close(); fn(); };
    const items: Record<string, HTMLElement[]> = {
      Archivo: [
        item("Nueva canción", "Por estilo: rock, bossa, corrido…", () => this.newSong()),
        item("Biblioteca", "Tus canciones y pistas de muestra", () => this.library()),
        item("Importar archivo", "Guitar Pro (.gp, .gp5, .gpx), MusicXML", () => this.importDialog()),
        item("Compartir con tu dúo", "Enlace para editar juntos", () => this.share()),
        item("Exportar", "MP3, WAV, Guitar Pro, MIDI, PDF", () => this.exportDialog()),
      ],
      Editar: [
        item("Deshacer", "", close(() => ed.undo())), item("Rehacer", "", close(() => ed.redo())),
        item("Vaciar tiempo", "Z", close(() => ed.clearBeat())), item("Borrar tiempo", "⌫ en tiempo vacío", close(() => ed.deleteBeat())),
        item("Insertar tiempo", "Espacio al final del compás", close(() => ed.advance())),
        item("Seleccionar", "O mantén el dedo sobre un tiempo", close(() => ed.toggleSelecting(true))),
        item("Seleccionar compás", "Compases completos desde el cursor", close(() => ed.selectBars())),
        item("Seleccionar toda la pista", "Ctrl + A", close(() => ed.selectBars(true))),
        item("Compases en todas las pistas", "Para copiar, duplicar o borrar partes de la canción", close(() => { ed.selectBars(); ed.toggleAllTracks(); })),
        item("Pegar insertando", "Abre compases nuevos en el cursor", close(() => this.c.toast(ed.paste(true)))),
        item("Duplicar compases", "Repite la selección justo después", close(() => this.c.toast(ed.duplicate()))),
        item("Borrar compases", "De toda la canción", close(() => this.c.toast(ed.deleteBars()))),
        item("Copiar", ed.sel ? "La selección" : "El tiempo del cursor", close(() => this.c.toast(ed.copySel()))),
        item("Cortar", "Deja silencios en su lugar", close(() => this.c.toast(ed.cutSel()))),
        item("Pegar", ed.clip ? `${ed.clip.whole ? `${ed.clip.bars.length} compás(es)` : "Tiempos"} de ${ed.clip.from}` : "El portapapeles está vacío", close(() => this.c.toast(ed.paste()))),
        item("Transponer +½ tono", ed.sel ? "La selección" : "Toda la pista", close(() => this.c.toast(ed.transpose(1)))),
        item("Transponer −½ tono", ed.sel ? "La selección" : "Toda la pista", close(() => this.c.toast(ed.transpose(-1)))),
        item("Subir una octava", ed.sel ? "La selección" : "Toda la pista", close(() => this.c.toast(ed.transpose(12)))),
        item("Bajar una octava", ed.sel ? "La selección" : "Toda la pista", close(() => this.c.toast(ed.transpose(-12)))),
      ],
      Pista: [
        item("Agregar pista", "Elige instrumento", () => this.tracks()),
        item("Propiedades de la pista", "Afinación, capo, sonido", () => this.sets("track")),
        item("Siguiente pista", "", close(() => ed.selectTrack((ed.cursor.t + 1) % ed.score.tracks.length))),
        item(ed.viewAll ? "Ver solo esta pista" : "Ver todas las pistas", "", close(() => { ed.viewAll = !ed.viewAll; ed.rerender(); })),
      ],
      Compás: [
        item("Insertar después", "", close(() => ed.insertBar(true))), item("Insertar antes", "", close(() => ed.insertBar(false))),
        item("Borrar compás", "", close(() => ed.deleteBar())),
        ...["3/4", "4/4", "6/8", "12/8"].map((t) => item(`Compás ${t}`, "Desde este compás", close(() => ed.barProp("ts", t)))),
        item("Inicio de repetición", "", close(() => ed.barProp("repeatOpen", !ed.masterBar.isRepeatStart))),
        item("Fin de repetición", "×2", close(() => ed.barProp("repeatClose", ed.masterBar.repeatCount ? 0 : 2))),
      ],
      Nota: [
        ...([["Redonda", 1], ["Blanca", 2], ["Negra", 4], ["Corchea", 8], ["Semicorchea", 16], ["Fusa", 32]] as [string, number][]).map(([n, d]) => item(n, "", close(() => ed.setDuration(d)))),
        item("Puntillo", ".", close(() => ed.toggleDot())), item("Tresillo", ",", close(() => ed.toggleTuplet(3))),
      ],
      Sección: ["Intro", "Verso", "Pre-coro", "Coro", "Puente", "Solo", "Outro"].map((n) => item(n, "Marca desde este compás", close(() => {
        const letter = String.fromCharCode(65 + ed.score.masterBars.filter((m, i) => m.section && i < ed.cursor.b).length);
        ed.barProp("section", `${letter}|${n}`);
      }))),
      Herramientas: [
        item("Biblioteca de acordes", "Diagramas e inserción", () => this.chords()),
        item("Letra", "Sílabas bajo las notas", () => this.lyrics()),
        item("Atajos de teclado", "Todo lo que puedes escribir", () => this.help()),
      ],
      Sonido: [
        item(engine.metronome > 0 ? "Apagar metrónomo" : "Encender metrónomo", "", close(() => (engine.metronome = engine.metronome > 0 ? 0 : 1))),
        item(engine.countIn > 0 ? "Quitar cuenta inicial" : "Cuenta inicial", "Un compás antes de tocar", close(() => (engine.countIn = engine.countIn > 0 ? 0 : 1))),
        item(engine.loop ? "Quitar bucle" : "Bucle", "", close(() => (engine.loop = !engine.loop))),
        item("Tempo", "Por compás, gradual, tap", () => this.tempo()),
        item("Masterizado", "EQ, compresión, ancho, volumen final", () => this.mastering()),
        item("Banco de sonidos", this.c.bank.name, () => this.banks()),
        item(engine.fx ? "Apagar motor de estudio" : "Activar efectos", engine.fx ? "Vuelve al sonido básico" : "Distorsión, pedales, EQ, reverb por pista", close(() => this.c.setFx(!engine.fx))),
        item("Mezclador", "Volumen, paneo, solo", () => this.tracks()),
      ],
      Vista: [
        item("Barra compacta", "Más espacio para la partitura", close(() => document.body.classList.toggle("compact"))),
        item(ed.viewAll ? "Ver solo esta pista" : "Ver todas las pistas", "", close(() => { ed.viewAll = !ed.viewAll; ed.rerender(); })),
      ],
      Ayuda: [
        item("Atajos de teclado", "", () => this.help()),
        item("Acerca de MusicFees", "Versión 0.8 y licencias", () => this.about()),
      ],
    };
    body.append(h("div", { class: "menu-grid" }, items[section] ?? []));
  }

  // ---------- canciones ----------
  newSong() {
    let style = "blank_gtr";
    const title = h("input", { type: "text", value: "Nueva canción", "aria-label": "Título" });
    const bars = h("input", { type: "number", min: 1, max: 200, value: 16, "aria-label": "Compases" });
    const toCloud = h("input", { type: "checkbox", checked: !ARTIFACT, disabled: ARTIFACT, id: "nc-cloud" });
    const showCloud = !ARTIFACT && !this.c.cloud.session; // con cuenta, va a tu biblioteca
    const grid = h("div", { class: "style-grid" });
    const draw = () => grid.replaceChildren(...STYLES.map((s) => h("button", { "aria-pressed": s.id === style, onclick: () => { style = s.id; draw(); } },
      h("b", null, s.name), h("small", null, `${s.era ? s.era + " · " : ""}${s.tracks.map((t) => t.name).join(", ")}`))));
    draw();
    this.open("Nueva canción", "full",
      h("div", { class: "field" }, h("label", null, "Título"), title),
      h("div", { class: "field" }, h("label", null, "Compases"), bars),
      showCloud ? h("label", { class: "inline", for: "nc-cloud" }, toCloud, "Guardar en la nube (para editar en dúo)") : null,
      h("div", { class: "sec" }, h("h3", null, "Estilo e instrumentos"), grid),
      h("div", { class: "inline" }, h("button", { class: "primary", onclick: async () => {
        this.close();
        await this.c.newSong(style, title.value.trim() || "Nueva canción", Math.max(1, Math.min(200, Number(bars.value) || 16)), toCloud.checked);
      } }, "Crear")));
  }
  // ---------- biblioteca ----------
  async library() {
    const { cloud, claudeLib } = this.c;
    const mine = h("div", { class: "trlist" }, h("p", { class: "note" }, "Cargando…"));
    const local = h("div", { class: "trlist" });
    const samples = h("div", { class: "trlist" });
    const row = (title: string, sub: string, open: () => void, del?: () => Promise<void> | void, extra?: HTMLElement | null) => {
      const delBtn = del ? h("button", { class: "ibtn", "aria-label": `Borrar ${title}` }, icon("trash", 18)) : null;
      if (delBtn && del) delBtn.onclick = async () => {
        if (!delBtn.dataset.armed) { delBtn.dataset.armed = "1"; delBtn.style.background = "#e5484d"; this.c.toast("Toca otra vez para borrarla."); setTimeout(() => { delete delBtn.dataset.armed; delBtn.style.background = ""; }, 3000); return; }
        try { await del(); this.library(); } catch (e) { this.c.toast((e as Error).message, true); }
      };
      return h("div", { class: "tr", style: "grid-template-columns:1fr auto" },
        h("button", { class: "listbtn", onclick: open }, title, h("small", null, sub)),
        h("span", { class: "acts" }, extra ?? null, delBtn));
    };
    const when = (t: number | string) => new Date(t).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
    const openId = (id: string) => () => { this.close(); this.c.openSong(id); };

    // Cuenta
    const who = claudeLib ? "Tu biblioteca usa tu cuenta de Claude: solo tú ves tus canciones."
      : cloud.session ? `Entraste como ${cloud.session.username}${cloud.session.isAdmin ? " (administrador)" : ""}.` : "Sin cuenta: lo que escribas queda solo en este dispositivo.";
    const account = h("div", { class: "inline" },
      h("span", { class: "note", style: "flex:1;min-width:180px" }, who),
      !claudeLib && cloud.session?.isAdmin ? h("button", { class: "ghost", onclick: () => this.users() }, "Usuarios") : null,
      !claudeLib && cloud.session ? h("button", { class: "ghost", onclick: async () => { await cloud.logout(); this.login(); } }, "Cerrar sesión") : null,
      !claudeLib && !cloud.session ? h("button", { class: "primary", onclick: () => this.login() }, "Entrar") : null);

    const actions = h("div", { class: "inline" },
      h("button", { class: "primary", onclick: () => this.newSong() }, "+ Nueva canción"),
      h("button", { class: "ghost", onclick: () => this.importDialog() }, "Importar archivo"));

    // Pistas de muestra (se copian a tu biblioteca al abrirlas)
    const SAMPLES: [string, string, string][] = [
      ["a-line-bass.gp", "A Line Bass", "Bajo, batería y dos guitarras · 153 compases"],
      ["xd.gp", "XD", "Guitarras con overdrive, bajo y batería · 119 compases"],
      ["relaf-ed-6.gp", "RelaF ed 6", "Sintetizador, bajo, batería y guitarras · 106 compases"],
    ];
    samples.replaceChildren(...SAMPLES.map(([file, title, sub]) => row(title, `${sub} · se copia a tu biblioteca`, async () => {
      try {
        const bytes = new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}samples/${file}${ARTIFACT ? ".ogg" : ""}`) /* el artefacto solo sirve extensiones conocidas */).arrayBuffer());
        const score = importFile(bytes);
        score.title = title;
        this.close();
        await this.c.addSong(score);
        this.c.toast(`«${title}» está en tu biblioteca.`);
      } catch (e) { this.c.toast(`No pude abrir la muestra: ${(e as Error).message}`, true); }
    })));

    const entries = localList();
    const onDevice = entries.filter((e) => e.id.startsWith("local-"));
    local.replaceChildren(...(onDevice.length ? onDevice.map((e) => row(e.title, `${when(e.updated)}${e.id === this.c.songId ? " · abierta" : ""}`, openId(e.id), () => forgetSong(e.id),
      (cloud.session || claudeLib) ? h("button", { class: "ibtn", "aria-label": "Subir a mi biblioteca", title: "Subir a mi biblioteca", onclick: async () => {
        const json = loadLocalDoc(e.id);
        if (!json) return;
        this.close();
        const { fromJson } = await import("../score/model");
        await this.c.addSong(fromJson(json));
        forgetSong(e.id);
        this.c.toast("Se subió a tu biblioteca.");
      } }, icon("up", 18)) : null))
      : [h("p", { class: "note" }, "Nada guardado solo en este dispositivo.")]));

    this.open("Biblioteca", "full", account, actions,
      h("div", { class: "sec" }, h("h3", null, claudeLib ? "Mis canciones" : cloud.session ? "Mis canciones (en la nube)" : "Mis canciones"), mine),
      h("div", { class: "sec" }, h("h3", null, "Solo en este dispositivo"), local),
      h("div", { class: "sec" }, h("h3", null, "Pistas de muestra"), samples),
      h("div", { class: "sec" }, h("h3", null, "Plugins de efectos"),
        h("p", { class: "note" }, `${WAM_CATALOG.length} plugins WAM 2.0 probados con MusicFees, con su dirección para usarlos aquí o en cualquier programa compatible.`),
        h("button", { class: "ghost", onclick: () => this.pluginLibrary() }, "Abrir biblioteca de plugins")));

    // Lista de la cuenta
    try {
      if (claudeLib) {
        const ok = await claudeLib.ready;
        const list = ok ? await claudeLib.list() : [];
        mine.replaceChildren(...(!ok ? [h("p", { class: "note" }, "Inicia sesión en Claude para guardar tu biblioteca. Mientras, todo queda en este navegador.")]
          : list.length ? list.map((x) => row(x.title, `${when(x.updated)}${`claude-${x.id}` === this.c.songId ? " · abierta" : ""}`, openId(`claude-${x.id}`), () => claudeLib.remove(x.id)))
          : [h("p", { class: "note" }, "Todavía no hay canciones. Crea una, importa un archivo o abre una muestra.")]));
      } else if (cloud.session) {
        const list = await cloud.mySongs();
        mine.replaceChildren(...(list.length ? list.map((x) => row(x.title, `${when(x.updated_at)}${x.id === this.c.songId ? " · abierta" : ""}`, openId(x.id), () => cloud.deleteMine(x.id)))
          : [h("p", { class: "note" }, "Todavía no hay canciones. Crea una, importa un archivo o abre una muestra.")]));
        if (this.c.isCloud && this.c.songId && !list.some((x) => x.id === this.c.songId))
          mine.append(h("button", { class: "ghost", onclick: async () => { try { await cloud.claim(this.c.songId!); this.c.toast("La canción abierta quedó en tu biblioteca."); this.library(); } catch (e) { this.c.toast((e as Error).message, true); } } }, "Guardar la canción abierta en mi biblioteca"));
      } else {
        const shared = entries.filter((e) => !e.id.startsWith("local-") && !e.id.startsWith("claude-"));
        mine.replaceChildren(...(shared.length ? shared.map((e) => row(e.title, `Compartida por enlace · ${when(e.updated)}`, openId(e.id), () => forgetSong(e.id)))
          : [h("p", { class: "note" }, "Entra con tu cuenta para ver las canciones guardadas en la nube.")]));
      }
    } catch (e) { mine.replaceChildren(h("p", { class: "note" }, (e as Error).message)); }
  }

  /** Pantalla de acceso. `gate` la deja sin botón de cerrar (al arrancar). */
  async login(gate = false) {
    const { cloud } = this.c;
    const user = h("input", { type: "text", id: "lg-user", autocomplete: "username", "aria-label": "Usuario", placeholder: "Usuario" });
    const pass = h("input", { type: "password", id: "lg-pass", autocomplete: "current-password", "aria-label": "Contraseña", placeholder: "Contraseña" });
    const msg = h("p", { class: "progress", "aria-live": "polite" });
    const go = h("button", { class: "primary" }, "Entrar");
    const offline = h("button", { class: "ghost", onclick: () => { this.c.prefs.offline = true; this.c.savePrefs(); this.close(); this.library(); } }, "Usar sin cuenta");
    const form = h("form", { class: "login", onsubmit: async (e: Event) => {
      e.preventDefault();
      go.disabled = true; msg.textContent = "Entrando…";
      try {
        if (setup) await cloud.setupAdmin(user.value, pass.value); else await cloud.login(user.value, pass.value);
        this.c.prefs.offline = false; this.c.savePrefs();
        this.close();
        this.c.toast(`Hola, ${cloud.session!.username}.`);
        this.library();
      } catch (err) { msg.textContent = (err as Error).message; }
      go.disabled = false;
    } }, h("div", { class: "field" }, h("label", { for: "lg-user" }, "Usuario"), user), h("div", { class: "field" }, h("label", { for: "lg-pass" }, "Contraseña"), pass), h("div", { class: "inline" }, go, offline), msg);
    const intro = h("p", { class: "note" }, "Entra con la cuenta que te dio el administrador para ver tu biblioteca en cualquier dispositivo.");
    this.open("MusicFees", gate ? "gate" : "full", h("img", { src: `${import.meta.env.BASE_URL}icons/icon-192.png`, alt: "", class: "login-logo" }), intro, form);
    let setup = false;
    try {
      setup = await cloud.needSetup();
      if (setup) { intro.textContent = "Primera vez: crea la cuenta de administrador. Con ella después creas las cuentas de los demás (por ejemplo USUARIO 1)."; go.textContent = "Crear administrador"; pass.setAttribute("autocomplete", "new-password"); }
    } catch (e) { msg.textContent = (e as Error).message; }
    user.focus();
  }

  /** Administración de cuentas (solo administradores). */
  async users() {
    const { cloud } = this.c;
    const list = h("div", { class: "trlist" });
    const nu = h("input", { type: "text", id: "nu-user", placeholder: "USUARIO 1", "aria-label": "Usuario nuevo" });
    const np = h("input", { type: "text", id: "nu-pass", placeholder: "Contraseña (mínimo 4)", "aria-label": "Contraseña nueva" });
    const adm = h("input", { type: "checkbox", id: "nu-admin" });
    const msg = h("p", { class: "progress", "aria-live": "polite" });
    const draw = async () => {
      try {
        const rows = await cloud.users();
        list.replaceChildren(...rows.map((u) => {
          const pw = h("button", { class: "ghost", onclick: async () => {
            const field = h("input", { type: "text", placeholder: "Nueva contraseña", "aria-label": `Nueva contraseña de ${u.username}` });
            const ok = h("button", { class: "primary", onclick: async () => { try { await cloud.setPassword(u.id, field.value); msg.textContent = `Contraseña de ${u.username} cambiada.`; draw(); } catch (e) { msg.textContent = (e as Error).message; } } }, "Guardar");
            pw.replaceWith(h("span", { class: "inline" }, field, ok));
            field.focus();
          } }, "Contraseña");
          const del = h("button", { class: "ibtn", "aria-label": `Borrar ${u.username}` }, icon("trash", 18));
          del.onclick = async () => {
            if (!del.dataset.armed) { del.dataset.armed = "1"; del.style.background = "#e5484d"; msg.textContent = `Toca otra vez para borrar a ${u.username}. Sus canciones siguen abriendo por enlace.`; return; }
            try { await cloud.deleteUser(u.id); draw(); } catch (e) { msg.textContent = (e as Error).message; }
          };
          return h("div", { class: "tr", style: "grid-template-columns:1fr auto" },
            h("div", { class: "nm" }, h("b", null, u.username), h("small", null, `${u.is_admin ? "Administrador · " : ""}${u.songs} ${u.songs === 1 ? "canción" : "canciones"}`)),
            h("span", { class: "acts" }, pw, u.username === cloud.session?.username ? null : del));
        }));
      } catch (e) { msg.textContent = (e as Error).message; }
    };
    this.open("Usuarios", "full",
      h("form", { class: "sec", onsubmit: async (e: Event) => {
        e.preventDefault();
        try { await cloud.createUser(nu.value, np.value, adm.checked); msg.textContent = `Cuenta «${nu.value.trim()}» creada. Ya puede entrar.`; nu.value = np.value = ""; adm.checked = false; draw(); }
        catch (err) { msg.textContent = (err as Error).message; }
      } }, h("h3", null, "Nueva cuenta"),
        h("div", { class: "field" }, h("label", { for: "nu-user" }, "Usuario"), nu),
        h("div", { class: "field" }, h("label", { for: "nu-pass" }, "Contraseña"), np),
        h("label", { class: "inline", for: "nu-admin" }, adm, "También es administrador"),
        h("div", { class: "inline" }, h("button", { class: "primary" }, "Crear cuenta"), h("button", { type: "button", class: "ghost", onclick: () => this.library() }, "Volver a la biblioteca"))),
      msg, h("div", { class: "sec" }, h("h3", null, "Cuentas"), list));
    draw();
  }

  async share() {
    const url = await this.c.shareSong();
    if (!url) return;
    const field = h("input", { type: "text", value: url, readonly: true, "aria-label": "Enlace" });
    const copy = h("button", { class: "primary", onclick: async () => {
      try { await navigator.clipboard.writeText(url); this.c.toast("Enlace copiado."); } catch { field.select(); this.c.toast("Selecciona y copia el enlace."); }
    } }, "Copiar enlace");
    const shareBtn = "share" in navigator ? h("button", { class: "ghost", onclick: () => navigator.share({ title: this.c.ed.score.title, url }).catch(() => {}) }, "Enviar…") : null;
    this.open("Compartir con tu dúo", "full", field, h("div", { class: "inline" }, copy, shareBtn),
      h("p", { class: "note" }, "Quien abra este enlace puede escuchar y editar la canción contigo en vivo: verás su cursor en ámbar y sus cambios al instante. No compartas el enlace con quien no deba editar."));
  }
  importDialog() {
    const input = h("input", { type: "file", accept: ".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.cap,.tex" });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const score = importFile(new Uint8Array(await f.arrayBuffer()));
        this.close();
        await this.c.importScore(score, f.name);
        this.c.toast(`Importé «${score.title}»: ${score.tracks.length} pistas, ${score.masterBars.length} compases.`);
      } catch (e) { this.c.toast(`No pude leer ese archivo: ${(e as Error).message}`, true); }
    };
    this.open("Importar archivo", "full", input,
      h("p", { class: "note" }, "Se agrega a tu biblioteca como canción nueva y se abre. Formatos: Guitar Pro 3 a 8 (.gp3 .gp4 .gp5 .gpx .gp), MusicXML y alphaTex."));
  }
  exportDialog() {
    const { ed, engine } = this.c;
    let type = "mp3";
    const prog = h("div", { class: "progress" });
    const metro = h("input", { type: "checkbox", id: "ex-m" });
    const per = h("input", { type: "checkbox", id: "ex-p" });
    // Con efectos y masterizado si la canción tiene alguno (o el motor de estudio está activo).
    const hasStudio = Object.keys(fxMap(ed.score)).length > 0 || !!masterOf(ed.score) || !!engine.fx;
    const studio = h("input", { type: "checkbox", id: "ex-s", checked: hasStudio });
    const all = h("input", { type: "checkbox", id: "ex-a", checked: true });
    const quality = h("select", { "aria-label": "Calidad" }, [["128", "Normal (128 kbps)"], ["192", "Alta (192 kbps)"], ["320", "Máxima (320 kbps)"]].map(([v, l]) => h("option", { value: v, selected: v === "192" }, l)));
    const types = h("div", { class: "menu-tabs" });
    const TYPES: [string, string, string][] = [["mp3", "MP3", ".mp3"], ["wav", "WAV", ".wav"], ["gp", "Guitar Pro", ".gp"], ["midi", "MIDI", ".mid"], ["pdf", "PDF", ".pdf"]];
    const label = () => { const t = TYPES.find((x) => x[0] === type)!; return `${t[1]} (${t[2]})`; };
    const go = h("button", { class: "primary" }, "");
    // Solo se muestran los ajustes que sirven para el tipo elegido.
    const audioOnly = () => type === "mp3" || type === "wav";
    const draw = () => {
      types.replaceChildren(...TYPES.map(([v, l]) => h("button", { "aria-pressed": v === type, onclick: () => { type = v; prog.textContent = ""; draw(); } }, l)));
      go.textContent = `Exportar ${label()}`;
      rowAll.hidden = type !== "pdf";
      rowPer.hidden = rowMetro.hidden = rowStudio.hidden = !audioOnly();
      rowQ.hidden = type !== "mp3";
    };
    go.onclick = async () => {
      go.disabled = true;
      try {
        if (type === "gp") await exportGp(ed.score);
        else if (type === "midi") await exportMidi(ed.score);
        else if (type === "pdf") await exportPdf(ed.score, all.checked ? ed.score.tracks.map((t) => t.index) : [ed.cursor.t], (m) => (prog.textContent = m));
        else await exportAudio(engine.api, ed.score, type as "mp3" | "wav", { metronome: metro.checked, perTrack: per.checked, quality: Number(quality.value), soundFont: () => engine.soundFontBytes(), studio: studio.checked }, (m) => (prog.textContent = m));
        prog.textContent = `Listo: ${label()}. Revisa tus descargas.`;
      } catch (e) { prog.textContent = `No se pudo exportar: ${(e as Error).message}`; }
      go.disabled = false;
    };
    const rowAll = h("label", { class: "inline", for: "ex-a" }, all, "Todas las pistas (si no, solo la actual)");
    const rowPer = h("label", { class: "inline", for: "ex-p" }, per, "Un archivo por pista");
    const rowMetro = h("label", { class: "inline", for: "ex-m" }, metro, "Incluir metrónomo");
    const rowStudio = h("label", { class: "inline", for: "ex-s" }, studio, "Con efectos y masterizado (tarda más: procesa pista por pista)");
    const rowQ = h("div", { class: "field" }, h("label", null, "Calidad MP3"), quality);
    draw();
    this.open("Exportar", "full", h("div", { class: "sec" }, h("h3", null, "Tipo de archivo"), types),
      h("div", { class: "sec" }, h("h3", null, "Ajustes"), rowAll, rowStudio, rowPer, rowMetro, rowQ),
      h("div", { class: "inline" }, go, h("button", { class: "ghost", onclick: () => this.close() }, "Cancelar")), prog,
      h("p", { class: "note" }, `El audio se genera en el teléfono con el banco ${this.c.bank.name}; una canción de 3 minutos puede tardar un rato.`));
  }

  // ---------- tempo ----------
  tempo() {
    const { ed } = this.c;
    const c = ed.cursor;
    const cur = Math.round(ed.tempoHere);
    const val = h("input", { type: "number", id: "tp-bpm", min: 20, max: 400, value: cur, inputmode: "numeric", "aria-label": "Tempo en negras por minuto" });
    const bump = (d: number) => h("button", { type: "button", class: "ghost", onclick: () => { val.value = String(Math.max(20, Math.min(400, Number(val.value) + d))); } }, d > 0 ? `+${d}` : String(d));
    // Tap tempo: toca al ritmo y se promedian los últimos intervalos.
    let taps: number[] = [];
    const tap = h("button", { type: "button", class: "ghost tap" }, "Tap");
    tap.onclick = () => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 2500).concat(now).slice(-6);
      if (taps.length >= 2) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); val.value = String(Math.round(60000 / avg)); }
      tap.textContent = `Tap (${taps.length})`;
    };
    const bpm = () => Math.max(20, Math.min(400, Math.round(Number(val.value) || cur)));
    const where = c.i > 0 ? `compás ${c.b + 1}, tiempo ${c.i + 1}` : `compás ${c.b + 1}`;
    const endBar = h("input", { type: "number", id: "tp-end", min: c.b + 1, max: ed.score.masterBars.length, value: Math.min(ed.score.masterBars.length, c.b + 4), "aria-label": "Hasta el compás" });
    const toBpm = h("input", { type: "number", id: "tp-to", min: 20, max: 400, value: Math.round(cur * 0.8), "aria-label": "Tempo final" });
    const list = h("div", { class: "trlist" });
    const drawList = () => list.replaceChildren(...ed.tempoList.map((t) => h("div", { class: "tr", style: "grid-template-columns:1fr auto" },
      h("button", { class: "listbtn", onclick: () => { ed.setCursor({ b: t.b, i: 0 }); this.close(); } }, `♩ = ${Math.round(t.bpm)}`,
        h("small", null, `Compás ${t.b + 1}${t.r > 0 ? ` · a ${Math.round(t.r * 100)} % del compás` : ""}`)),
      t.b === 0 && t.r === 0 ? null : h("button", { class: "ibtn", "aria-label": `Quitar el cambio del compás ${t.b + 1}`, onclick: () => { ed.removeTempo(t.b, t.r); drawList(); } }, icon("trash", 18)))));
    drawList();
    this.open("Tempo", "full",
      h("p", { class: "note" }, `Ahora: ♩ = ${cur} en el ${where}. Los cambios se ven sobre la partitura y se oyen al tocar.`),
      h("div", { class: "sec" }, h("h3", null, "Nuevo tempo"),
        h("div", { class: "inline" }, bump(-10), bump(-1), val, bump(1), bump(10), tap),
        h("div", { class: "inline" },
          h("button", { class: "primary", onclick: () => { ed.setTempo(bpm(), "from"); this.c.toast(`♩ = ${bpm()} desde el ${where}.`); this.close(); } }, "Desde aquí"),
          h("button", { class: "ghost", onclick: () => { ed.setTempo(bpm(), "bar"); this.c.toast(`♩ = ${bpm()} solo en el compás ${c.b + 1}.`); this.close(); } }, "Solo este compás"),
          h("button", { class: "ghost", onclick: () => { ed.commit([{ k: "songProp", prop: "tempo", val: bpm() }]); this.c.toast(`Tempo inicial: ♩ = ${bpm()}.`); this.close(); } }, "Tempo inicial"))),
      h("div", { class: "sec" }, h("h3", null, "Cambio gradual (accelerando / ritardando)"),
        h("div", { class: "field" }, h("label", { for: "tp-to" }, "Llegar a ♩ ="), toBpm),
        h("div", { class: "field" }, h("label", { for: "tp-end" }, "En el compás"), endBar),
        h("button", { class: "ghost", onclick: () => {
          const to = Math.max(20, Math.min(400, Number(toBpm.value) || cur)), end = Math.max(c.b, Number(endBar.value) - 1);
          ed.tempoRamp(to, end);
          this.c.toast(`${to < cur ? "Ritardando" : "Accelerando"}: de ${cur} a ${to} hasta el compás ${end + 1}.`); this.close();
        } }, "Aplicar cambio gradual"),
        h("p", { class: "note" }, "Se reparte tiempo por tiempo desde el cursor.")),
      h("div", { class: "sec" }, h("h3", null, "Cambios en la canción"), list));
    val.focus(); val.select();
  }

  /** Ventana con la interfaz propia de un plugin WAM. Al cerrarla se guarda su estado en la canción. */
  /** Biblioteca de plugins: cada uno con su dirección pública, para copiarla o agregarlo a la pista actual. */
  pluginLibrary() {
    const { ed } = this.c;
    const t = ed.cursor.t, track = ed.score.tracks[t];
    const copy = async (url: string) => {
      try { await navigator.clipboard.writeText(url); this.c.toast("Dirección copiada."); }
      catch { this.c.toast(url); }
    };
    const add = async (p: (typeof WAM_CATALOG)[number]) => {
      const cur = fxMap(ed.score)[t] ?? { ...presetFx("clean")! };
      const list = cur.plugins ?? [];
      if (list.length >= 3) { this.c.toast("Esta pista ya tiene 3 plugins. Quita uno en Sets → Pista → Efectos.", true); return; }
      ed.commit([{ k: "trackFx", t, fx: { ...cur, plugins: [...list, { src: p.src, name: p.name }] } }], { render: false });
      if (!this.c.engine.fx) await this.c.setFx(true);
      else this.c.engine.fx.setTrackFx(t, fxMap(ed.score)[t] ?? null);
      this.c.toast(`«${p.name}» se agregó a ${track?.name || `la pista ${t + 1}`}. Ábrelo en Sets → Pista → Efectos.`);
    };
    const groups = PLUGIN_CATS.map((c) => h("details", { class: "plugcat", open: c === "Distorsión y amplis" },
      h("summary", null, `${c} (${WAM_CATALOG.filter((p) => p.cat === c).length})`),
      ...WAM_CATALOG.filter((p) => p.cat === c).map((p) => {
        const url = publicPluginUrl(p.src);
        return h("div", { class: "plugrow" },
          h("div", { class: "plugtxt" }, h("b", null, p.name), h("small", null, `${p.note} · ${p.by} · ${p.license}${p.mb ? ` · ${p.mb} MB` : ""}`),
            h("code", { class: "plugurl" }, url)),
          h("div", { class: "inline" },
            h("button", { class: "ghost", onclick: () => copy(url) }, "Copiar URL"),
            h("button", { class: "primary", onclick: () => add(p) }, "Agregar")));
      })));
    this.open("Biblioteca de plugins", "full",
      h("p", { class: "note" }, `«Agregar» lo pone en la pista actual (${track?.name || `pista ${t + 1}`}) y enciende el motor de estudio. Las direcciones sirven en cualquier anfitrión WAM 2.0. La primera vez que abres un plugin se descarga; necesita internet en la app de Android.`),
      ...groups,
      h("p", { class: "note" }, "Licencias y autores: wam/NOTICE.txt. Los plugins de la comunidad vienen del paquete wam-community 0.4.9 (Wimmics, Université Côte d'Azur, y Burns Audio)."));
  }

  private async pluginWindow(t: number, k: number) {
    const { ed, engine } = this.c;
    const inst = engine.fx?.pluginInstances(t)[k];
    if (!inst) {
      const err = engine.fx?.pluginErrors.get(t);
      this.c.toast(err ?? (engine.fx ? "El plugin todavía está cargando. Intenta en un momento." : "Activa el motor de estudio para usar plugins."), true);
      return;
    }
    const ref = fxMap(ed.score)[t]?.plugins?.[k];
    const node = inst.audioNode as unknown as WamParamNode;
    // Controles propios: deslizadores grandes que funcionan igual con el dedo, sin depender de la
    // ventana original del plugin (hecha para ratón y pantalla grande).
    let params: [string, WamParamInfo][] = [];
    try { params = Object.entries(await node.getParameterInfo()).filter(([id, p]) => usableParam(id, p)); } catch { /* sin lista */ }
    let values: Record<string, { value: number }> = {};
    try { values = await node.getParameterValues(false); } catch { /* sin valores */ }
    const sliders = h("div", { class: "plugparams" }, params.length ? params.map(([id, p]) => {
      const steps = p.type === "int" || p.type === "boolean" || p.choices?.length ? 1 : (p.maxValue - p.minValue) / 200;
      const v = values[id]?.value ?? p.defaultValue;
      const out = h("output", null, fmtParam(v, p));
      const r = h("input", { type: "range", min: p.minValue, max: p.maxValue, step: steps, value: v, "aria-label": paramLabel(id, p) });
      r.oninput = () => { const x = Number(r.value); out.textContent = fmtParam(x, p); void node.setParameterValues({ [id]: { id, value: x, normalized: false } }); };
      return h("label", { class: "plugparam" }, h("span", null, paramLabel(id, p)), r, out);
    }) : [h("p", { class: "note" }, "Este plugin no publica sus controles; usa su vista original.")]);
    let gui: HTMLElement | null = null;
    const original = h("div", { class: "plugbody" });
    const showOriginal = async () => {
      if (!gui) {
        try { gui = await inst.createGui(); original.append(gui); }
        catch (e) { original.append(h("p", { class: "note" }, `Sin vista original: ${(e as Error).message}`)); }
      }
    };
    const coarse = matchMedia("(pointer: coarse)").matches;
    const tabs = h("div", { class: "menu-tabs" });
    const body = h("div", { class: "plugview" });
    const show = async (which: "controls" | "original") => {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === which)));
      if (which === "original") { await showOriginal(); body.replaceChildren(original); }
      else body.replaceChildren(sliders);
    };
    tabs.append(h("button", { "data-v": "controls", onclick: () => show("controls") }, "Controles"), h("button", { "data-v": "original", onclick: () => show("original") }, "Vista del plugin"));
    const close = async () => {
      try {
        const state = await inst.audioNode.getState();
        const fx = fxMap(ed.score)[t];
        if (fx?.plugins?.[k]) ed.commit([{ k: "trackFx", t, fx: { ...fx, plugins: fx.plugins.map((p, j) => (j === k ? { ...p, state } : p)) } }], { render: false });
      } catch { /* sin estado */ }
      try { if (gui) inst.destroyGui?.(gui); } catch { /* nada */ }
      win.remove();
    };
    const win = h("div", { class: "plugwin", role: "dialog", "aria-label": ref?.name ?? "Plugin" },
      h("div", { class: "plugcard" },
        h("header", null, h("h2", null, ref?.name ?? "Plugin"), h("button", { class: "ibtn", "aria-label": "Cerrar y guardar", onclick: close }, icon("close", 20))),
        tabs, body));
    document.body.append(win);
    // En el teléfono abre en los controles propios; en computadora, en la vista del plugin.
    await show(coarse || !params.length ? (params.length ? "controls" : "original") : "original");
  }

  // ---------- masterizado ----------
  async mastering() {
    const { ed, engine } = this.c;
    const body = this.open("Masterizado", "full");
    if (!engine.fx) {
      const btn = h("button", { class: "primary" }, "Activar motor de estudio");
      btn.onclick = async () => { btn.disabled = true; btn.textContent = "Preparando…"; await this.c.setFx(true); this.mastering(); };
      body.append(h("p", { class: "note" }, "El masterizado le da el acabado final a toda la canción: ecualización, compresión, ancho estéreo y volumen, con un limitador que evita que sature. Usa el motor de estudio, el mismo de los efectos."), btn);
      return;
    }
    let cur: MasterFx | null = masterOf(ed.score);
    const save = () => ed.commit([{ k: "master", fx: cur }], { render: false });
    const sel = h("select", { id: "ms-preset", "aria-label": "Preset de masterizado" },
      h("option", { value: "", selected: !cur }, "Sin masterizar"),
      MASTER_PRESETS.map((p) => h("option", { value: p.id, selected: cur?.preset === p.id }, p.name)),
      h("option", { value: "custom", selected: cur?.preset === "custom" }, "Personalizado"));
    const knobs = h("div", { class: "knobs" });
    const draw = () => knobs.replaceChildren(...(cur ? MASTER_SLIDERS.map(([k, label]) => {
      const id = `ms-${k}`;
      const r = h("input", { type: "range", min: 0, max: 10, step: 1, value: Number(cur![k]), id, "aria-label": label });
      const out = h("output", { for: id }, String(cur![k]));
      r.oninput = () => { cur = { ...cur!, [k]: Number(r.value), preset: "custom" }; out.textContent = r.value; engine.fx?.setMaster(cur); sel.value = "custom"; };
      r.onchange = save;
      return h("label", { class: "knob", for: id }, h("span", null, label), r, out);
    }) : [h("p", { class: "note" }, "Elige un preset para empezar.")]));
    sel.onchange = () => {
      cur = sel.value === "custom" ? (cur ?? { ...MASTER_PRESETS[0].fx, preset: "custom" }) : sel.value ? { ...MASTER_PRESETS.find((p) => p.id === sel.value)!.fx } : null;
      engine.fx?.setMaster(cur); save(); draw();
    };
    draw();
    // Medidor de salida: verde hasta −6 dB, ámbar hasta −1, rojo arriba.
    const bar = h("div", { class: "meter-fill" }), lbl = h("span", { class: "meter-db" }, "— dB");
    const meter = h("div", { class: "meter", "aria-label": "Nivel de salida" }, bar, lbl);
    const tick = () => {
      if (!meter.isConnected || !engine.fx) return;
      const db = engine.fx.levelDb;
      const pct = Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
      bar.style.width = `${pct}%`;
      bar.dataset.zone = db > -1 ? "hot" : db > -6 ? "warm" : "ok";
      lbl.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : "— dB";
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    body.append(
      h("div", { class: "field" }, h("label", { for: "ms-preset" }, "Preset"), sel), knobs,
      h("div", { class: "sec" }, h("h3", null, "Nivel de salida"), meter,
        h("p", { class: "note" }, "Dale play y ajusta «Volumen final» hasta que el medidor quede casi siempre en ámbar. El limitador no deja pasar de −0.8 dB.")),
      h("p", { class: "note" }, "El masterizado se guarda con la canción y se aplica al exportar MP3 o WAV."));
  }

  // ---------- banco de sonidos ----------
  banks() {
    const list = h("div", { class: "trlist" });
    const status = h("p", { class: "progress", "aria-live": "polite" });
    const draw = async () => {
      const rows = await Promise.all(this.c.banks.map(async (b) => {
        const saved = b.pack ? await this.c.hasPack(b.pack) : true;
        const sub = b.pack ? (saved ? "Descargado en este dispositivo" : `Toca para descargar (${b.mb} MB)`) : "Incluido";
        return h("button", { class: "listbtn bank", "aria-pressed": b.id === this.c.bank.id, onclick: async () => {
          if (b.id === this.c.bank.id) return;
          status.textContent = b.pack && !saved ? `Descargando ${b.name}… 0 %` : `Cambiando a ${b.name}…`;
          try {
            await this.c.setBank(b.id, (p) => (status.textContent = `Descargando ${b.name}… ${p} %`));
            status.textContent = `Listo: ahora suena ${b.name}.`;
          } catch (e) { status.textContent = (e as Error).message; }
          draw();
        } }, `${b.name} · ${b.mb} MB`, h("small", null, `${b.note} ${sub}.`));
      }));
      list.replaceChildren(...rows);
    };
    draw();
    this.open("Banco de sonidos", "full", list, status,
      h("p", { class: "note" }, "El banco incluido carga en segundos. Los demás se descargan una sola vez y quedan guardados: después funcionan sin internet. Con datos móviles conviene descargarlos con wifi."));
  }

  // ---------- letra y acordes ----------
  lyrics() {
    const { ed } = this.c;
    const tr = ed.track;
    const words: string[] = [];
    for (const bar of tr.staves[0].bars) for (const b of bar.voices[0].beats) if (b.lyrics?.[0]) words.push(b.lyrics[0]);
    const ta = h("textarea", { rows: 10, "aria-label": "Letra", placeholder: "Escribe la letra. Separa sílabas con guion: ho- la a- mor" }, words.join(" "));
    this.open(`Letra · ${tr.name}`, "full", ta,
      h("p", { class: "note" }, "Cada sílaba cae bajo una nota de esta pista, en orden. Usa «-» al final de una sílaba que continúa (ca- mi- no). Un «_» deja una nota sin sílaba."),
      h("div", { class: "inline" }, h("button", { class: "primary", onclick: () => { ed.commit([{ k: "lyrics", t: ed.cursor.t, text: ta.value }]); this.close(); } }, "Aplicar letra")));
  }
  chords(rootStart = 9, typeStart = 1) {
    const { ed, engine } = this.c;
    const sys = (this.c.prefs.names as NameSys) ?? "en";
    let root = rootStart, type = typeStart;
    const box = h("div");
    const draw = () => {
      const c = CHORDS[type], name = pcName(root, sys) + c.k, kind = kindOf(ed.track);
      const vs = voicings(root, c);
      const rootsEl = h("div", { class: "roots" }, NOTE_NAMES[sys].map((n, i) => h("button", { "aria-pressed": i === root, onclick: () => { root = i; draw(); } }, n)));
      const sel = h("select", { "aria-label": "Tipo de acorde" }, Object.entries(groupBy(CHORDS.map((x, i) => ({ ...x, i })), (x) => x.g)).map(([g, xs]) => h("optgroup", { label: g }, xs.map((x) => h("option", { value: x.i, selected: x.i === type }, `${x.k || "(mayor)"} · ${x.n}`)))));
      sel.onchange = () => { type = Number(sel.value); draw(); };
      const insert = (frets: number[] | null) => {
        const id = name;
        const ops: Op[] = [];
        if (kind === "tab" && ed.track.staves[0].tuning.join() === G6.join() && frets) ops.push({ k: "chordDef", t: ed.cursor.t, id, name, frets });
        ops.push({ k: "beatFx", ...ed.ref(), fx: "chord", val: ops.length ? id : null });
        if (frets && kind === "tab" && ed.stringCount === 6) frets.forEach((f, r) => ops.push(f >= 0 ? { k: "fret", ...ed.ref(), str: ed.stringOfRow(r), fret: f } : { k: "delNote", ...ed.ref(), str: ed.stringOfRow(r) }));
        if (kind === "notation") keysVoicing(root, c, 6, 3).forEach((m) => ops.push({ k: "pitch", ...ed.ref(), pitch: m, on: true }));
        if (!ops.some((o) => o.k !== "beatFx")) ops.push({ k: "beatFx", ...ed.ref(), fx: "text", val: name });
        ed.commit(ops);
        this.c.toast(`${name} en el compás ${ed.cursor.b + 1}.`);
      };
      const hear = (frets: number[]) => {
        const beat = ed.beat;
        if (!beat) return;
        const notes = frets.map((f, s) => (f >= 0 ? G6[s] + f : -1)).filter((m) => m > 0);
        // Vista previa con el piano de alphaTab: se toca el acorde como un tiempo temporal.
        const tmp = new at.model.Beat();
        for (const m of notes) { const n = new at.model.Note(); n.octave = Math.floor(m / 12) - 1; n.tone = m % 12; tmp.addNote(n); }
        tmp.voice = beat.voice; tmp.duration = at.model.Duration.Half;
        try { engine.playBeat(tmp); } catch { /* sin sonido aún */ }
      };
      box.replaceChildren(rootsEl, h("div", { class: "field" }, h("label", null, "Tipo"), sel),
        h("p", null, h("b", { style: "font-size:26px;font-family:var(--f-cond)" }, name), "  ", h("span", { class: "note" }, `${c.n} · ${c.f} · ${c.iv.map((x) => pcName(root + x, sys)).join(" ")}`)),
        vs.length ? h("div", { class: "voicings" }, vs.map((v) => h("div", { class: "voicing", html: "" },
          h("div", { html: diagramSvg(v.frets, root, sys) }),
          h("div", { class: "acts" }, h("button", { onclick: () => hear(v.frets) }, "▶"), h("button", { onclick: () => insert(v.frets) }, "Insertar")))))
          : h("p", { class: "note" }, "No hay una posición cómoda de guitarra con el bajo en la tónica; en teclados sí se puede insertar."),
        h("div", { class: "inline" }, h("button", { class: "ghost", onclick: () => insert(null) }, kind === "notation" ? "Insertar en teclado" : "Solo el nombre")),
        h("p", { class: "note" }, "«Insertar» escribe el acorde en el tiempo del cursor de la pista actual y pone su diagrama arriba de la partitura."));
    };
    draw();
    const nameSys = h("div", { class: "menu-tabs" }, (["en", "es"] as NameSys[]).map((s) => h("button", { "aria-pressed": s === sys, onclick: () => { this.c.prefs.names = s; this.c.savePrefs(); this.chords(root, type); } }, s === "en" ? "C D E" : "Do Re Mi")));
    this.open("Acordes", "full", nameSys, box);
  }

  help() {
    const rows: HTMLElement[] = [];
    let g = "";
    for (const k of KEY_HELP) {
      if (k.group !== g) { g = k.group; rows.push(h("tr", { class: "g" }, h("td", { colspan: 2 }, g))); }
      rows.push(h("tr", null, h("td", null, k.keys), h("td", null, k.what)));
    }
    this.open("Atajos de teclado", "full",
      h("p", { class: "note" }, "Toca la tablatura sobre la cuerda que quieras y escribe con el teclado de MusicFees que aparece abajo. Si prefieres el teclado del teléfono (o tienes uno físico), todo esto funciona con sus teclas; las letras van en mayúscula o minúscula."),
      h("table", { class: "help-table" }, rows));
  }
  about() {
    this.open("Acerca de MusicFees", "full",
      h("p", null, "MusicFees 0.8 — tablaturas y partituras multipista con edición en dúo."),
      h("p", { class: "note" }, "Partitura y reproducción: alphaTab (MPL-2.0). Fuente musical: Bravura (SIL OFL). Sonidos: MuseScore General de S. Christian Collins, basado en Fluid R3 de Frank Wen y Michael Cowgill (licencia MIT), y GeneralUser GS de S. Christian Collins (uso libre, también comercial). Motor de estudio: spessasynth_lib (Apache-2.0) y Tone.js (MIT). Nube: Supabase."));
  }
}

// ---------- parámetros de plugins WAM ----------
interface WamParamInfo { label?: string; type?: string; minValue: number; maxValue: number; defaultValue: number; choices?: string[]; units?: string }
interface WamParamNode {
  getParameterInfo(): Promise<Record<string, WamParamInfo>>;
  getParameterValues(normalized?: boolean): Promise<Record<string, { value: number }>>;
  setParameterValues(v: Record<string, { id: string; value: number; normalized: boolean }>): Promise<void>;
}
/** Deja fuera parámetros internos: «bypass» y los de rango ilimitado (no se pueden mover con un deslizador). */
function usableParam(id: string, p: WamParamInfo) {
  if (/bypass/i.test(id)) return false;
  return Number.isFinite(p.minValue) && Number.isFinite(p.maxValue) && p.maxValue > p.minValue && p.maxValue - p.minValue < 1e6;
}
function paramLabel(id: string, p: WamParamInfo) {
  const raw = (p.label && p.label !== id ? p.label : id).split("/").filter(Boolean).pop() ?? id;
  return raw.replace(/^\d+_/, "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
function fmtParam(v: number, p: WamParamInfo) {
  if (p.choices?.length) return p.choices[Math.round(v)] ?? String(v);
  const span = p.maxValue - p.minValue;
  return (span <= 2 ? v.toFixed(2) : span <= 50 ? v.toFixed(1) : String(Math.round(v))) + (p.units ? ` ${p.units}` : "");
}
