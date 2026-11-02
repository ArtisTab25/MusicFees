// Interfaz del módulo «Análisis»: transcribir audio a pistas y analizar la canción abierta.
// Se carga solo cuando se usa (el modelo de notas y TensorFlow.js viven en su propio worker).
import type { AppCtx, Sheets } from "../ui/sheets";
import { h } from "../ui/dom";
import { PRESETS } from "../score/instruments";
import { analysisOf, kindOf, type Op, type SongAnalysis } from "../score/model";
import { CHORDS, voicings } from "../score/chords";
import { TUNINGS } from "../score/instruments";
import { ARTIFACT } from "../config";
import { buildScore, ROLE_NAMES, suggestPreset, summarize } from "./build";
import { analyzeScore } from "./symbolic";
import type { Analysis, Role, TranscribeOpts } from "./types";
import type { WorkerIn, WorkerOut } from "./worker";

const SR = 22050;
const MAX_SECONDS = 8 * 60;

/** Decodifica cualquier audio (o video) a mono a 22 050 Hz, lo que pide el modelo de notas. */
async function decode(buf: ArrayBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, SR);
  const ab = await ctx.decodeAudioData(buf);
  const n = ab.length, out = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
  if (ab.sampleRate === SR) return out;
  // Por si el navegador no remuestreó: interpolación lineal.
  const ratio = ab.sampleRate / SR, m = Math.floor(n / ratio), res = new Float32Array(m);
  for (let i = 0; i < m; i++) { const x = i * ratio, k = Math.floor(x), f = x - k; res[i] = out[k] * (1 - f) + (out[k + 1] ?? 0) * f; }
  return res;
}

const presetSelect = (sel: string, kinds?: string[]) => h("select", null, Object.entries(PRESETS.filter((p) => !kinds || kinds.includes(p.kind)).reduce((m, p) => { (m[p.group] ??= []).push(p); return m; }, {} as Record<string, typeof PRESETS>))
  .map(([g, ps]) => h("optgroup", { label: g }, ps.map((p) => h("option", { value: p.id, selected: p.id === sel }, p.name)))));
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- transcribir ----------
export function transcribeSheet(sheets: Sheets, c: AppCtx) {
  let pcm: Float32Array | null = null, name = "";
  let worker: Worker | null = null;
  const status = h("p", { class: "note", role: "status" }, "Elige una canción, pista o grabación. Se procesa en tu dispositivo: el audio no se sube a ningún lado.");
  const file = h("input", { type: "file", accept: "audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.webm,.mp4", "aria-label": "Archivo de audio", onchange: async () => {
    const f = file.files?.[0];
    if (f) await load(await f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ""));
  } });
  const recBtn = h("button", { class: "ghost", onclick: () => void toggleRec() }, "● Grabar");
  let rec: MediaRecorder | null = null, recT = 0, recStart = 0;
  async function toggleRec() {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const chunks: Blob[] = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recT); rec = null; recBtn.textContent = "● Grabar";
        await load(await new Blob(chunks).arrayBuffer(), `Grabación ${new Date().toLocaleString()}`);
      };
      rec.start();
      recStart = Date.now();
      recT = window.setInterval(() => { recBtn.textContent = `■ Detener (${fmtTime((Date.now() - recStart) / 1000)})`; if (Date.now() - recStart > MAX_SECONDS * 1000) rec?.stop(); }, 250);
      recBtn.textContent = "■ Detener (0:00)";
    } catch (e) { c.toast(`No pude usar el micrófono: ${(e as Error).message}. Revisa el permiso del micrófono.`, true); }
  }
  // Recorte
  const from = h("input", { type: "number", min: 0, step: 1, value: 0, "aria-label": "Desde (segundos)" });
  const to = h("input", { type: "number", min: 1, step: 1, value: 0, "aria-label": "Hasta (segundos)" });
  const trim = h("div", { class: "sec", hidden: true }, h("h3", null, "Fragmento"),
    h("div", { class: "field" }, h("label", null, "Desde (s)"), from),
    h("div", { class: "field" }, h("label", null, "Hasta (s)"), to),
    h("p", { class: "note" }, "En el teléfono, un fragmento corto (un verso y un coro) tarda mucho menos."));
  async function load(buf: ArrayBuffer, n: string) {
    status.textContent = "Leyendo el audio…";
    try {
      pcm = await decode(buf);
      name = n;
      title.value = n || "Transcripción";
      const dur = pcm.length / SR;
      to.value = String(Math.ceil(Math.min(dur, MAX_SECONDS)));
      to.max = String(Math.ceil(dur));
      trim.hidden = false;
      go.disabled = false;
      status.textContent = `Listo: ${n || "audio"} · ${fmtTime(dur)}${dur > MAX_SECONDS ? ` (se usan los primeros ${MAX_SECONDS / 60} min)` : ""}.`;
    } catch (e) { pcm = null; go.disabled = true; status.textContent = `No pude leer ese archivo (${(e as Error).message}). Prueba con MP3, WAV, M4A u OGG.`; }
  }
  // Opciones
  let mode: "mix" | "solo" = "mix";
  const modeBtns = h("div", { class: "menu-tabs", role: "group", "aria-label": "Qué tiene la grabación" },
    h("button", { "aria-pressed": true, onclick: () => setMode("mix") }, "Canción completa"),
    h("button", { "aria-pressed": false, onclick: () => setMode("solo") }, "Un instrumento"));
  const soloSel = presetSelect("gtr_steel", ["tab", "notation"]);
  const soloField = h("div", { class: "field", hidden: true }, h("label", null, "Instrumento"), soloSel);
  const drums = h("input", { type: "checkbox", checked: true, id: "tr-drums" });
  const drumsRow = h("label", { class: "inline", for: "tr-drums" }, drums, "Detectar la batería (bombo, caja y hi-hat)");
  function setMode(m: "mix" | "solo") {
    mode = m;
    [...modeBtns.children].forEach((b, i) => b.setAttribute("aria-pressed", String((i === 0) === (m === "mix"))));
    soloField.hidden = m === "mix"; drumsRow.hidden = m === "solo";
  }
  const sens = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Sensibilidad" });
  const mark = h("input", { type: "checkbox", checked: true, id: "tr-mark" });
  const title = h("input", { type: "text", value: "Transcripción", "aria-label": "Título" });
  const bar = h("progress", { max: 100, value: 0, hidden: true, style: "width:100%" });
  const cancel = h("button", { class: "ghost", hidden: true, onclick: () => { worker?.terminate(); worker = null; busy(false); status.textContent = "Cancelado."; } }, "Cancelar");
  const go = h("button", { class: "primary", disabled: true, onclick: () => run() }, "Transcribir");
  function busy(on: boolean) { bar.hidden = !on; cancel.hidden = !on; go.disabled = on; file.disabled = on; recBtn.disabled = on; }
  function run() {
    if (!pcm) return;
    const a = Math.max(0, Number(from.value) || 0), b = Math.min(pcm.length / SR, Math.max(a + 2, Number(to.value) || pcm.length / SR), a + MAX_SECONDS);
    const slice = pcm.slice(Math.floor(a * SR), Math.floor(b * SR));
    const opts: TranscribeOpts = { mode, presets: mode === "solo" ? { all: soloSel.value } : {}, drums: mode === "mix" && drums.checked, sensitivity: Number(sens.value) / 100, markDoubtful: mark.checked, title: title.value.trim() || name || "Transcripción" };
    busy(true);
    status.textContent = "Preparando…";
    worker?.terminate();
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const modelUrl = new URL(`${import.meta.env.BASE_URL}models/basic-pitch/${ARTIFACT ? "model.art.json" : "model.json"}`, document.baseURI).href;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "progress") { bar.value = m.pct; status.textContent = m.msg; }
      else if (m.type === "error") { busy(false); worker?.terminate(); worker = null; status.textContent = `No se pudo transcribir: ${m.message}`; }
      else { busy(false); worker?.terminate(); worker = null; result(sheets, c, m.analysis, opts, `${(m.ms / 1000).toFixed(0)} s · ${m.backend === "webgl" ? "aceleración gráfica" : m.backend === "wasm" ? "WebAssembly" : "procesador"}`); }
    };
    worker.onerror = (e) => { busy(false); status.textContent = `No se pudo transcribir: ${e.message || "error del proceso"}`; };
    const wasmUrl = new URL(`${import.meta.env.BASE_URL}models/tfjs-wasm/`, document.baseURI).href;
    const prefer = (c.prefs.mlBackend as string | undefined) || undefined;
    const msg: WorkerIn = { pcm: slice, sr: SR, modelUrl, wasmUrl, prefer, mode, drums: opts.drums, sensitivity: opts.sensitivity };
    worker.postMessage(msg, [slice.buffer]);
  }
  sheets.panel("Transcribir audio", "full",
    h("p", { class: "note" }, "Convierte una canción, una pista o una grabación en una canción de MusicFees: una pista por parte, con su instrumento, en tablatura y partitura, con tempo, compás, tonalidad, acordes, secciones y análisis."),
    h("div", { class: "sec" }, h("h3", null, "Audio"), h("div", { class: "inline" }, file, recBtn), status),
    trim,
    h("div", { class: "sec" }, h("h3", null, "Qué tiene la grabación"), modeBtns, soloField, drumsRow),
    h("div", { class: "sec" }, h("h3", null, "Ajustes"),
      h("div", { class: "field" }, h("label", null, "Título"), title),
      h("div", { class: "field" }, h("label", null, "Sensibilidad"), sens),
      h("p", { class: "note" }, "Más sensibilidad encuentra notas suaves pero también ruido; menos deja solo las notas claras."),
      h("label", { class: "inline", for: "tr-mark" }, mark, "Marcar con 💬 los compases dudosos para revisarlos")),
    h("div", { class: "inline" }, go, cancel), bar,
    h("p", { class: "note" }, "Cómo funciona: un modelo de reconocimiento de notas (Basic Pitch de Spotify, Apache-2.0) escucha las alturas; los algoritmos propios de MusicFees encuentran el pulso y el compás, separan bajo, acordes, melodía y batería, reconocen tonalidad y acordes, la estructura y el contrapunto, y eligen la digitación más cómoda en el diapasón. El resultado es un borrador muy completo: revísalo y corrígelo en el editor."),
    h("p", { class: "note" }, "Transcribe solo música propia o que tengas derecho a usar."));
}

function result(sheets: Sheets, c: AppCtx, a: Analysis, opts: TranscribeOpts, took: string) {
  const parts = a.parts.filter((p) => p.notes.length);
  const rows = parts.map((p) => {
    const on = h("input", { type: "checkbox", checked: p.role !== "drums" || opts.drums });
    const kinds = p.role === "drums" ? ["drums"] : ["tab", "notation"];
    const sel = presetSelect(opts.presets[p.role] ?? suggestPreset(p), kinds);
    return { p, on, sel, el: h("div", { class: "partrow" }, h("label", null, on, h("span", null, ROLE_NAMES[p.role], h("small", null, `${p.notes.length} notas`))), sel) };
  });
  const create = h("button", { class: "primary", onclick: async () => {
    const presets: Partial<Record<Role, string>> = {};
    const keep = rows.filter((r) => r.on.checked);
    if (!keep.length) { c.toast("Elige al menos una parte.", true); return; }
    for (const r of keep) presets[r.p.role] = r.sel.value;
    create.disabled = true; create.textContent = "Creando…";
    try {
      const score = buildScore({ ...a, parts: keep.map((r) => r.p) }, { ...opts, presets, drums: keep.some((r) => r.p.role === "drums") });
      sheets.close();
      await c.addSong(score);
      c.toast(`✓ «${score.title}»: ${score.tracks.length} pistas, ${score.masterBars.length} compases. Revisa los compases con 💬.`);
    } catch (e) { create.disabled = false; create.textContent = "Crear la canción"; c.toast(`No se pudo crear: ${(e as Error).message}`, true); }
  } }, "Crear la canción");
  sheets.panel("Transcripción lista", "full",
    h("p", { class: "note" }, `Analizado en ${took}. ${a.notes} notas.`),
    report(summarize(a, "audio")),
    h("div", { class: "sec" }, h("h3", null, "Pistas e instrumentos"), ...rows.map((r) => r.el),
      h("p", { class: "note" }, "La guitarra y el bajo salen en tablatura con la digitación más cómoda (y afinación Drop D o más grave si hace falta). Puedes elegir cualquier instrumento para cada parte.")),
    h("div", { class: "inline" }, create, h("button", { class: "ghost", onclick: () => transcribeSheet(sheets, c) }, "Otra grabación")));
}

// ---------- reporte ----------
/** Reporte legible del análisis (lo usan la transcripción y el análisis de la partitura). */
export function report(s: SongAnalysis): HTMLElement {
  const box = h("div", { class: "report" });
  box.append(h("div", { class: "kpis" },
    kpi("Tempo", `♩ = ${s.tempo}`), kpi("Compás", `${s.meter}/4`), kpi("Tonalidad", s.key), kpi("Forma", s.sections.map((x) => x.label).join(" ") || "—")));
  if (s.notes.length) box.append(h("div", { class: "warnbox" }, s.notes.map((n) => h("p", null, "⚠ " + n))));
  // Acordes por sección
  const secs = s.sections.length ? s.sections : [{ b0: 0, b1: 1e9, label: "A", name: "Canción" }];
  const list = h("div", { class: "sec" }, h("h3", null, "Armonía por sección"));
  for (const sec of secs) {
    const ch = s.chords.filter((x) => x[0] >= sec.b0 && x[0] <= sec.b1);
    const seq: [string, string][] = [];
    for (const x of ch) if (!seq.length || seq[seq.length - 1][0] !== x[2]) seq.push([x[2], x[3]]);
    // Progresión que se repite: se muestra una vez con ×n.
    const { unit, times } = loop(seq.map((x) => x[0]));
    const shown = seq.slice(0, unit);
    list.append(h("div", { class: "secrow" },
      h("b", null, `${sec.name} `, h("small", null, `${sec.label} · compás ${sec.b0 + 1}${sec.b1 < 1e8 ? `–${sec.b1 + 1}` : ""}`)),
      h("div", { class: "prog" }, shown.length ? shown.map(([n, r]) => h("span", { class: "chordpill" }, n, h("small", null, r))) : h("span", { class: "note" }, "sin acordes"), times > 1 ? h("span", { class: "note" }, ` ×${times}`) : null)));
  }
  box.append(list);
  if (s.counterpoint.length) box.append(h("div", { class: "sec" }, h("h3", null, "Contrapunto"), s.counterpoint.map((t) => h("p", { class: "note" }, t))));
  return box;
}
const kpi = (k: string, v: string) => h("div", { class: "kpi" }, h("small", null, k), h("b", null, v));
/** Busca la unidad más corta que se repite completa (C G Am F C G Am F → unidad 4, ×2). */
function loop(xs: string[]): { unit: number; times: number } {
  for (let u = 1; u <= xs.length / 2; u++) {
    if (xs.length % u) continue;
    let ok = true;
    for (let i = u; i < xs.length && ok; i++) if (xs[i] !== xs[i - u]) ok = false;
    if (ok) return { unit: u, times: xs.length / u };
  }
  return { unit: xs.length, times: 1 };
}

// ---------- analizar la partitura ----------
export function analysisSheet(sheets: Sheets, c: AppCtx) {
  const { ed } = c;
  const pitched = ed.score.tracks.filter((t) => kindOf(t) !== "drums");
  if (!pitched.some((t) => t.staves[0].bars.some((b) => b.voices.some((v) => v.beats.some((x) => x.notes.length))))) {
    c.toast("La canción todavía no tiene notas que analizar.", true); return;
  }
  const upSel = h("select", { "aria-label": "Voz aguda" }, pitched.map((t) => h("option", { value: t.index }, `${t.index + 1}. ${t.name}`)));
  const loSel = h("select", { "aria-label": "Voz grave" }, pitched.map((t) => h("option", { value: t.index }, `${t.index + 1}. ${t.name}`)));
  const out = h("div");
  let last: ReturnType<typeof analyzeScore> | null = null;
  const run = (u?: number, l?: number) => {
    const t0 = performance.now();
    last = analyzeScore(ed.score, u, l);
    upSel.value = String(last.voices.upper); loSel.value = String(last.voices.lower);
    out.replaceChildren(h("p", { class: "note" }, `Analizado en ${Math.round(performance.now() - t0)} ms.`), report(summarize(last, "partitura")));
  };
  run();
  const target = h("select", { "aria-label": "Pista para los acordes" }, ed.score.tracks.filter((t) => kindOf(t) !== "drums").map((t) => h("option", { value: t.index, selected: t.index === ed.cursor.t }, `${t.index + 1}. ${t.name}`)));
  const act = (label: string, sub: string, fn: () => void) => h("button", { onclick: fn }, label, h("small", null, sub));
  sheets.panel("Analizar la canción", "full",
    h("p", { class: "note" }, "Tonalidad, acordes con su grado, estructura y contrapunto de lo que está escrito. Sirve para entender cómo está hecha una canción y para completarla."),
    out,
    h("div", { class: "sec" }, h("h3", null, "Contrapunto entre"),
      h("div", { class: "field" }, h("label", null, "Voz aguda"), upSel),
      h("div", { class: "field" }, h("label", null, "Voz grave"), loSel),
      h("button", { class: "ghost", onclick: () => run(Number(upSel.value), Number(loSel.value)) }, "Volver a analizar")),
    h("div", { class: "sec" }, h("h3", null, "Aplicar a la canción"),
      h("div", { class: "field" }, h("label", null, "Pista"), target),
      h("div", { class: "menu-grid" },
        act("Escribir los acordes", "Nombres (y diagramas en guitarra) donde cambia la armonía", () => { if (last) { const n = writeChords(c, last, Number(target.value)); c.toast(n ? `${n} acordes escritos. Deshacer los quita.` : "No encontré dónde escribirlos (¿pista sin notas?).", !n); } }),
        act("Marcar las secciones", "Intro, Verso, Coro… donde aún no hay", () => { if (last) { const n = writeSections(c, last); c.toast(n ? `${n} secciones marcadas.` : "La canción ya tiene sus secciones.", !n); } }),
        act("Poner la armadura", "Según la tonalidad encontrada", () => { if (last) { c.ed.commit(c.ed.score.masterBars.map((_, b) => ({ k: "barProp", b, prop: "key", val: last!.key.sig }) as Op)); c.toast(`Armadura de ${last.key.name}.`); } }),
        act("Guardar el análisis", "Viaja con la canción (Análisis → Último análisis)", () => { if (last) { c.ed.commit([{ k: "analysis", a: summarize(last, "partitura") }]); c.toast("Análisis guardado con la canción."); } }))));
}

/** Escribe los acordes encontrados sobre la pista t: en el primer tiempo con notas de cada cambio. */
function writeChords(c: AppCtx, a: Analysis, t: number): number {
  const tr = c.ed.score.tracks[t];
  if (!tr) return 0;
  const std = kindOf(tr) === "tab" && tr.staves[0].tuning.join() === TUNINGS.std.strings.join();
  const starts: number[] = [];
  let acc = 0;
  for (const mb of c.ed.score.masterBars) { starts.push(acc); acc += (3840 / mb.timeSignatureDenominator) * mb.timeSignatureNumerator; }
  const ops: Op[] = [];
  const defined = new Set(tr.staves[0].chords ? [...tr.staves[0].chords.keys()] : []);
  let n = 0, lastName = "";
  for (const ch of a.chords) {
    if (ch.root < 0 || ch.name === lastName) continue;
    const tick = ch.b0 * 960;
    let b = starts.findIndex((s, i) => tick >= s && tick < (starts[i + 1] ?? Infinity));
    if (b < 0) continue;
    const bar = tr.staves[0].bars[b];
    let pos = starts[b], i = -1;
    for (const beat of bar.voices[0].beats) {
      const len = (3840 / beat.duration) * (beat.dots ? 1.5 : 1) * (beat.hasTuplet ? beat.tupletDenominator / beat.tupletNumerator : 1);
      if (pos >= tick - 1 && pos < tick + 960 && !beat.isRest) { i = beat.index; break; }
      pos += len;
    }
    if (i < 0) continue;
    lastName = ch.name;
    if (std) {
      const type = CHORDS.find((k) => k.k === (ch.type === "m7b5" ? "m7♭5" : ch.type));
      const v = type ? voicings(ch.root, type)[0] : null;
      if (v && !defined.has(ch.name)) { ops.push({ k: "chordDef", t, id: ch.name, name: ch.name, frets: v.frets }); defined.add(ch.name); }
      if (v) { ops.push({ k: "beatFx", t, b, v: 0, i, fx: "chord", val: ch.name }); n++; continue; }
    }
    ops.push({ k: "beatFx", t, b, v: 0, i, fx: "text", val: ch.name }); n++;
  }
  if (ops.length) c.ed.commit(ops);
  return n;
}

function writeSections(c: AppCtx, a: Analysis): number {
  const mbs = c.ed.score.masterBars;
  if (mbs.some((m) => m.section)) return 0;
  const ops: Op[] = a.sections.filter((s) => s.b0 < mbs.length).map((s) => ({ k: "barProp", b: s.b0, prop: "section", val: `${s.label}|${s.name}` }) as Op);
  if (ops.length) c.ed.commit(ops);
  return ops.length;
}

/** El último análisis guardado con la canción. */
export function lastAnalysisSheet(sheets: Sheets, c: AppCtx) {
  const s = analysisOf(c.ed.score);
  if (!s) { analysisSheet(sheets, c); return; }
  sheets.panel("Último análisis", "full",
    h("p", { class: "note" }, `${s.source === "audio" ? "De la transcripción" : "De la partitura"} · ${new Date(s.at).toLocaleString()}`),
    report(s),
    h("div", { class: "inline" }, h("button", { class: "ghost", onclick: () => analysisSheet(sheets, c) }, "Analizar de nuevo la partitura")));
}
