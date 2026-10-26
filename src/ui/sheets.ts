// Hojas de pantalla completa: Tracks, Sets, menú del logo y diálogos.
import * as at from "@coderline/alphatab";
import type { Editor } from "../editor/editor";
import type { Engine } from "../player/engine";
import type { KeyInput } from "../editor/keys";
import type { Cloud, LiveSession } from "../collab/cloud";
import { localList, forgetSong } from "../collab/cloud";
import { kindOf, type Op } from "../score/model";
import { PRESETS, STYLES, TUNINGS, presetById } from "../score/instruments";
import { CHORDS, NOTE_NAMES, diagramSvg, keysVoicing, pcName, voicings, G6, type NameSys } from "../score/chords";
import { KEY_HELP } from "../editor/keys";
import { exportAudio, exportGp, exportMidi, exportPdf, importFile } from "../export/exporters";
import { h, icon } from "./dom";

export interface AppCtx {
  ed: Editor; engine: Engine; keys: KeyInput; cloud: Cloud;
  toast: (m: string, err?: boolean) => void;
  openSong: (id: string) => Promise<void>;
  newSong: (style: string, title: string, bars: number, cloud: boolean) => Promise<void>;
  shareSong: () => Promise<string | null>;
  importScore: (s: at.model.Score) => void;
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
  private open(title: string, side: "left" | "right" | "full", ...content: (HTMLElement | null)[]) {
    this.el?.remove();
    this.c.keys.blur();
    const body = h("div", { class: "body" }, ...content);
    const card = h("div", { class: "card" },
      h("header", null, h("h2", null, title), h("button", { class: "ibtn", "aria-label": "Cerrar", onclick: () => this.close() }, icon("close", 20))),
      body);
    this.el = h("div", { class: `sheet ${side}`, role: "dialog", "aria-label": title, onclick: (e: Event) => { if (e.target === this.el) this.close(); } }, card);
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
      h("p", { class: "note" }, "Sonidos del banco GeneralUser GS. Los efectos tipo pedal y amplificador por pista llegan en la siguiente versión.")));
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
        item("Mis canciones", "En este teléfono y en la nube", () => this.openList()),
        item("Importar archivo", "Guitar Pro (.gp, .gp5, .gpx), MusicXML", () => this.importDialog()),
        item("Compartir con tu dúo", "Enlace para editar juntos", () => this.share()),
        item("Exportar", "MP3, WAV, Guitar Pro, MIDI, PDF", () => this.exportDialog()),
      ],
      Editar: [
        item("Deshacer", "", close(() => ed.undo())), item("Rehacer", "", close(() => ed.redo())),
        item("Vaciar tiempo", "Z", close(() => ed.clearBeat())), item("Borrar tiempo", "⌫ en tiempo vacío", close(() => ed.deleteBeat())),
        item("Insertar tiempo", "Espacio al final del compás", close(() => ed.advance())),
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
        item("Mezclador", "Volumen, paneo, solo", () => this.tracks()),
      ],
      Vista: [
        item("Barra compacta", "Más espacio para la partitura", close(() => document.body.classList.toggle("compact"))),
        item(ed.viewAll ? "Ver solo esta pista" : "Ver todas las pistas", "", close(() => { ed.viewAll = !ed.viewAll; ed.rerender(); })),
      ],
      Ayuda: [
        item("Atajos de teclado", "", () => this.help()),
        item("Acerca de MusicFees", "Versión 0.1 y licencias", () => this.about()),
      ],
    };
    body.append(h("div", { class: "menu-grid" }, items[section] ?? []));
  }

  // ---------- canciones ----------
  newSong() {
    let style = "blank_gtr";
    const title = h("input", { type: "text", value: "Nueva canción", "aria-label": "Título" });
    const bars = h("input", { type: "number", min: 1, max: 200, value: 16, "aria-label": "Compases" });
    const toCloud = h("input", { type: "checkbox", checked: true, id: "nc-cloud" });
    const grid = h("div", { class: "style-grid" });
    const draw = () => grid.replaceChildren(...STYLES.map((s) => h("button", { "aria-pressed": s.id === style, onclick: () => { style = s.id; draw(); } },
      h("b", null, s.name), h("small", null, `${s.era ? s.era + " · " : ""}${s.tracks.map((t) => t.name).join(", ")}`))));
    draw();
    this.open("Nueva canción", "full",
      h("div", { class: "field" }, h("label", null, "Título"), title),
      h("div", { class: "field" }, h("label", null, "Compases"), bars),
      h("label", { class: "inline", for: "nc-cloud" }, toCloud, "Guardar en la nube (para editar en dúo)"),
      h("div", { class: "sec" }, h("h3", null, "Estilo e instrumentos"), grid),
      h("div", { class: "inline" }, h("button", { class: "primary", onclick: async () => {
        this.close();
        await this.c.newSong(style, title.value.trim() || "Nueva canción", Math.max(1, Math.min(200, Number(bars.value) || 16)), toCloud.checked);
      } }, "Crear")));
  }
  async openList() {
    const listEl = h("div", { class: "trlist" });
    const link = h("input", { type: "text", placeholder: "Pega el enlace o código de tu dúo", "aria-label": "Enlace" });
    this.open("Mis canciones", "full",
      h("div", { class: "inline" }, link, h("button", { class: "primary", onclick: () => {
        const m = link.value.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
        if (!m) { this.c.toast("Ese enlace no trae una canción válida.", true); return; }
        this.close(); this.c.openSong(m[1]);
      } }, "Abrir")),
      listEl);
    const entries = localList();
    const draw = (titles: Map<string, string>) => listEl.replaceChildren(...(entries.length ? entries.map((e) => h("div", { class: "tr", style: "grid-template-columns:1fr auto" },
      h("button", { class: "listbtn", onclick: () => { this.close(); this.c.openSong(e.id); } }, titles.get(e.id) ?? e.title,
        h("small", null, `${e.cloud ? "Nube" : "Solo este teléfono"} · ${new Date(e.updated).toLocaleString("es-MX")}${e.id === this.c.songId ? " · abierta" : ""}`)),
      h("button", { class: "ibtn", "aria-label": `Quitar ${e.title} de la lista`, onclick: () => { forgetSong(e.id); entries.splice(entries.indexOf(e), 1); draw(titles); } }, icon("trash", 18))))
      : [h("p", { class: "note" }, "Todavía no hay canciones. Crea una desde Archivo → Nueva canción.")]));
    draw(new Map());
    try {
      const rows = await this.c.cloud.list(entries.filter((e) => e.cloud).map((e) => e.id));
      draw(new Map(rows.map((r) => [r.id, r.title])));
    } catch { /* sin nube: se queda la lista local */ }
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
        this.c.importScore(score);
        this.c.toast(`Importé «${score.title || f.name}»: ${score.tracks.length} pistas, ${score.masterBars.length} compases.`);
      } catch (e) { this.c.toast(`No pude leer ese archivo: ${(e as Error).message}`, true); }
    };
    this.open("Importar archivo", "full", input,
      h("p", { class: "note" }, "Reemplaza la canción abierta por el archivo. Formatos: Guitar Pro 3 a 8 (.gp3 .gp4 .gp5 .gpx .gp), MusicXML y alphaTex. Si la canción está en la nube, tu dúo recibe la versión importada."));
  }
  exportDialog() {
    const { ed, engine } = this.c;
    let type = "mp3";
    const prog = h("div", { class: "progress" });
    const metro = h("input", { type: "checkbox", id: "ex-m" });
    const per = h("input", { type: "checkbox", id: "ex-p" });
    const all = h("input", { type: "checkbox", id: "ex-a", checked: true });
    const quality = h("select", { "aria-label": "Calidad" }, [["128", "Normal (128 kbps)"], ["192", "Alta (192 kbps)"], ["320", "Máxima (320 kbps)"]].map(([v, l]) => h("option", { value: v, selected: v === "192" }, l)));
    const types = h("div", { class: "menu-tabs" });
    const draw = () => types.replaceChildren(...[["mp3", "MP3"], ["wav", "WAV"], ["gp", "Guitar Pro"], ["midi", "MIDI"], ["pdf", "PDF"]].map(([v, l]) => h("button", { "aria-pressed": v === type, onclick: () => { type = v; draw(); } }, l)));
    draw();
    const go = h("button", { class: "primary" }, "Exportar");
    go.onclick = async () => {
      go.disabled = true;
      try {
        if (type === "gp") exportGp(ed.score);
        else if (type === "midi") exportMidi(ed.score);
        else if (type === "pdf") await exportPdf(ed.score, all.checked ? ed.score.tracks.map((t) => t.index) : [ed.cursor.t], (m) => (prog.textContent = m));
        else await exportAudio(engine.api, ed.score, type as "mp3" | "wav", { metronome: metro.checked, perTrack: per.checked, quality: Number(quality.value) }, (m) => (prog.textContent = m));
        prog.textContent = "Listo. Revisa tus descargas.";
      } catch (e) { prog.textContent = `No se pudo exportar: ${(e as Error).message}`; }
      go.disabled = false;
    };
    this.open("Exportar", "full", h("div", { class: "sec" }, h("h3", null, "Archivo"), types),
      h("div", { class: "sec" }, h("h3", null, "Ajustes"),
        h("label", { class: "inline", for: "ex-a" }, all, "PDF con todas las pistas (si no, solo la actual)"),
        h("label", { class: "inline", for: "ex-p" }, per, "Audio: un archivo por pista"),
        h("label", { class: "inline", for: "ex-m" }, metro, "Audio: incluir metrónomo"),
        h("div", { class: "field" }, h("label", null, "Calidad MP3"), quality)),
      h("div", { class: "inline" }, go, h("button", { class: "ghost", onclick: () => this.close() }, "Cancelar")), prog,
      h("p", { class: "note" }, "El audio se genera en el teléfono con el mismo banco de sonidos; una canción de 3 minutos puede tardar un rato."));
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
      h("p", { class: "note" }, "Toca la tablatura sobre la cuerda que quieras: se abre el teclado del teléfono y todo lo que escribes va al cursor azul. Las letras funcionan en mayúscula o minúscula."),
      h("table", { class: "help-table" }, rows));
  }
  about() {
    this.open("Acerca de MusicFees", "full",
      h("p", null, "MusicFees 0.1 — tablaturas y partituras multipista con edición en dúo."),
      h("p", { class: "note" }, "Partitura y reproducción: alphaTab (MPL-2.0). Fuente musical: Bravura (SIL OFL). Sonidos: GeneralUser GS de S. Christian Collins (uso libre, también comercial). Nube: Supabase."));
  }
}
