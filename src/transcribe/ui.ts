// Interfaz del módulo «Análisis»: transcribir audio a pistas y analizar la canción abierta.
// Se carga solo cuando se usa (el modelo de notas y TensorFlow.js viven en su propio worker).
import { parseMidi, midiToAnalysis } from "./midifile";
import type { AppCtx, Sheets } from "../ui/sheets";
import { h } from "../ui/dom";
import { PRESETS } from "../score/instruments";
import { analysisOf, kindOf, type Op, type SongAnalysis } from "../score/model";
import { CHORDS, voicings } from "../score/chords";
import { TUNINGS } from "../score/instruments";
import { ARTIFACT } from "../config";
import { downloadPack, hasPack } from "../player/downloads";
import { BEAT_PACKS, BEAT_WEIGHT_BYTES, DEMUCS_WEIGHT_BYTES, SEP_PACKS, sepPlan, threadsFor } from "./packs";
import type { Pack } from "../player/downloads";
import { buildScore, ROLE_NAMES, suggestPreset, summarize } from "./build";
import { analyzeScore } from "./symbolic";
import type { Analysis, InstrumentHint, Role, TranscribeOpts } from "./types";
import type { WorkerIn, WorkerOut } from "./worker";

const SR = 44100;
const MAX_SECONDS = 8 * 60;

/** Decodifica cualquier audio (o video) a estéreo 44.1 kHz (lo que piden los modelos de separación). */
async function decode(buf: ArrayBuffer): Promise<[Float32Array, Float32Array]> {
  const ctx = new OfflineAudioContext(2, 1, SR);
  const ab = await ctx.decodeAudioData(buf);
  const L = ab.getChannelData(0).slice(), R = (ab.numberOfChannels > 1 ? ab.getChannelData(1) : ab.getChannelData(0)).slice();
  if (ab.sampleRate === SR) return [L, R];
  // Por si el navegador no remuestreó: interpolación lineal.
  const ratio = ab.sampleRate / SR, m = Math.floor(L.length / ratio);
  const rs = (x: Float32Array) => { const o = new Float32Array(m); for (let i = 0; i < m; i++) { const p = i * ratio, k = Math.floor(p), f = p - k; o[i] = x[k] * (1 - f) + (x[k + 1] ?? 0) * f; } return o; };
  return [rs(L), rs(R)];
}

const presetSelect = (sel: string, kinds?: string[]) => h("select", null, Object.entries(PRESETS.filter((p) => !kinds || kinds.includes(p.kind)).reduce((m, p) => { (m[p.group] ??= []).push(p); return m; }, {} as Record<string, typeof PRESETS>))
  .map(([g, ps]) => h("optgroup", { label: g }, ps.map((p) => h("option", { value: p.id, selected: p.id === sel }, p.name)))));
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- transcribir ----------
export function transcribeSheet(sheets: Sheets, c: AppCtx) {
  let pcm: [Float32Array, Float32Array] | null = null, name = "";
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
      const dur = pcm[0].length / SR;
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
  // Qué instrumentos hay (opcional): con esto no se inventan partes y las notas se reparten entre el
  // número de guitarras o teclados indicado. «Automático» deja que MusicFees lo decida.
  const yesNo = (label: string) => h("select", { "aria-label": label }, h("option", { value: "" }, "Automático"), h("option", { value: "1" }, "Sí"), h("option", { value: "0" }, "No"));
  const count = (label: string, max: number) => h("select", { "aria-label": label }, h("option", { value: "" }, "Automático"), ...Array.from({ length: max + 1 }, (_, i) => h("option", { value: String(i) }, String(i))));
  const inst = { vocals: yesNo("Voz"), drums: yesNo("Batería"), bass: yesNo("Bajo"), guitars: count("Guitarras", 3), keys: count("Teclados o piano", 2), leads: count("Vientos, cuerdas o sinte con melodía", 3) };
  const instField = (label: string, el: HTMLElement) => h("div", { class: "field" }, h("label", null, label), el);
  const drumsRow = h("div", null,
    h("p", { class: "note" }, "Opcional: dile qué instrumentos tiene. Así no inventa partes y reparte las notas entre las guitarras o teclados que indiques (la 2.ª guitarra sale como punteo). Se aprovecha sobre todo en calidad «Fiel»."),
    instField("Voz", inst.vocals), instField("Batería", inst.drums), instField("Bajo", inst.bass),
    instField("Guitarras", inst.guitars), instField("Teclados o piano", inst.keys), instField("Vientos, cuerdas o sinte con melodía", inst.leads));
  const readHint = (): InstrumentHint => {
    const b = (x: HTMLSelectElement) => (x.value === "" ? undefined : x.value === "1");
    const n = (x: HTMLSelectElement) => (x.value === "" ? undefined : Number(x.value));
    return { vocals: b(inst.vocals as HTMLSelectElement), drums: b(inst.drums as HTMLSelectElement), bass: b(inst.bass as HTMLSelectElement), guitars: n(inst.guitars as HTMLSelectElement), keys: n(inst.keys as HTMLSelectElement), leads: n(inst.leads as HTMLSelectElement) };
  };
  const drums = { get checked() { return (inst.drums as HTMLSelectElement).value !== "0"; } };
  function setMode(m: "mix" | "solo") {
    mode = m;
    [...modeBtns.children].forEach((b, i) => b.setAttribute("aria-pressed", String((i === 0) === (m === "mix"))));
    soloField.hidden = m === "mix"; drumsRow.hidden = m === "solo";
  }
  // Calidad: «Fiel» separa la mezcla antes de transcribir; «Fiel (rápida)» separa con menos modelos y
  // menos solape (~40 % menos tiempo); «Rápida» transcribe la mezcla tal cual.
  type Quality = "fiel" | "fielRapida" | "rapida";
  let quality: Quality = (c.prefs.trQuality as Quality | undefined) ?? (c.prefs.trFaithful === false ? "rapida" : "fiel");
  const Q: [Quality, string][] = [["fiel", "Fiel"], ["fielRapida", "Fiel (rápida)"], ["rapida", "Rápida"]];
  const qBtns = h("div", { class: "menu-tabs", role: "group", "aria-label": "Calidad" }, Q.map(([k, l]) => h("button", { "aria-pressed": quality === k, onclick: () => setQ(k) }, l)));
  const qNote = h("p", { class: "note" });
  // Beat This!: medido con las partituras de Brayand, acierta más los pulsos (+2 a +6 puntos) pero se
  // equivoca más en dónde empieza el compás en canciones no vistas (−10). Por eso es opcional.
  const aiBeat = h("input", { type: "checkbox", checked: !!c.prefs.trBeatAI, onchange: () => { c.prefs.trBeatAI = aiBeat.checked; c.savePrefs(); void drawQ(); } }) as HTMLInputElement;
  const aiNote = h("p", { class: "note" }, "Marca mejor los pulsos, pero a veces pone el inicio del compás en otro tiempo o cuenta al doble en ritmos de shuffle. Descarga 41 MB una vez. Pruébalo si el tempo o el pulso salen mal.");
  const plan = () => sepPlan(quality === "fielRapida", !!c.prefs.noDemucs, readHint().vocals !== false);
  const drawQ = async () => {
    if (quality === "rapida") { qNote.textContent = "Transcribe la mezcla tal cual. Mucho más rápida, menos fiel cuando suenan varios instrumentos."; return; }
    const pl = plan();
    const ai = !!c.prefs.trBeatAI;
    const all = [...pl.packs.map(([, p]) => p), ...(ai ? [BEAT_PACKS.graph, BEAT_PACKS.weights] : [])];
    const have = (await Promise.all(all.map((p) => hasPack(p)))).every(Boolean);
    const mb = pl.mb + (ai ? BEAT_PACKS.graph.mb + BEAT_PACKS.weights.mb : 0);
    const cores = self.crossOriginIsolated ? threadsFor(navigator.hardwareConcurrency) : 1;
    qNote.textContent = `Separa la mezcla con ${pl.label} y transcribe cada fuente por separado.${quality === "fielRapida" ? (pl.engine === "demucs" ? " La batería sale de Demucs (lee un poco peor el hi-hat y la caja)." : " Sin el modelo de voz si dices que no hay voz.") : ""} ${have ? "Modelos ya descargados." : `Descarga ${Math.round(mb)} MB una sola vez${ai ? " (incluye Beat This!)" : ""}.`} Usa ${cores} ${cores === 1 ? "núcleo" : "núcleos"} del procesador. En el teléfono, mejor un fragmento de 30–60 s.`;
  };
  function setQ(k: Quality) {
    quality = k; c.prefs.trQuality = k; c.prefs.trFaithful = k !== "rapida"; c.savePrefs();
    [...qBtns.children].forEach((b, i) => b.setAttribute("aria-pressed", String(Q[i][0] === k)));
    void drawQ();
  }
  void drawQ();
  const sens = h("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Sensibilidad" });
  const mark = h("input", { type: "checkbox", checked: true, id: "tr-mark" });
  const title = h("input", { type: "text", value: "Transcripción", "aria-label": "Título" });
  const bar = h("progress", { max: 100, value: 0, hidden: true, style: "width:100%" });
  const cancel = h("button", { class: "ghost", hidden: true, onclick: () => { worker?.terminate(); worker = null; busy(false); status.textContent = "Cancelado."; } }, "Cancelar");
  const go = h("button", { class: "primary", disabled: true, onclick: () => void run() }, "Transcribir");
  function busy(on: boolean) { bar.hidden = !on; cancel.hidden = !on; go.disabled = on; file.disabled = on; recBtn.disabled = on; }
  async function run() {
    if (!pcm) return;
    const len = pcm[0].length / SR;
    const a = Math.max(0, Number(from.value) || 0), b = Math.min(len, Math.max(a + 2, Number(to.value) || len), a + MAX_SECONDS);
    const L = pcm[0].slice(Math.floor(a * SR), Math.floor(b * SR)), R = pcm[1].slice(Math.floor(a * SR), Math.floor(b * SR));
    const useSep = quality !== "rapida" && mode === "mix";
    const opts: TranscribeOpts = { mode, separate: useSep, presets: mode === "solo" ? { all: soloSel.value } : {}, drums: mode === "mix" && drums.checked, sensitivity: Number(sens.value) / 100, markDoubtful: mark.checked, title: title.value.trim() || name || "Transcripción" };
    busy(true);
    status.textContent = "Preparando…";
    // Modo fiel: los modelos se bajan una vez (con avance) y se pasan al proceso de fondo.
    let sep: WorkerIn["sep"];
    if (useSep) {
      // Según el equipo: Demucs (6 fuentes; trozos cortos en teléfonos) o los modelos MDX-Net.
      const fetchAll = async (packs: [string, Pack][], total: number) => {
        const got: Record<string, ArrayBuffer> = {};
        let doneMb = 0;
        for (const [k, p] of packs) {
          const bytes = await downloadPack(p, (pct) => { bar.value = Math.round(((doneMb + (p.mb * pct) / 100) / total) * 100); status.textContent = `Descargando modelos de separación (una sola vez)… ${Math.round(doneMb + (p.mb * pct) / 100)} de ${Math.round(total)} MB`; });
          got[k] = bytes.slice().buffer; // copia: el original queda guardado
          doneMb += p.mb;
        }
        return got;
      };
      try {
        let pl = plan(), got: Record<string, ArrayBuffer> | null = null;
        if (pl.engine === "demucs") {
          try {
            got = await fetchAll(pl.packs, pl.mb);
            if (got.weights.byteLength !== DEMUCS_WEIGHT_BYTES) got = null; // un servidor que responde otra cosa
          } catch { got = null; } // esta copia de la app no trae Demucs: se usan los modelos MDX-Net
          if (!got) pl = sepPlan(pl.fast, true, readHint().vocals !== false);
        }
        if (!got) got = await fetchAll(pl.packs, pl.mb);
        sep = pl.engine === "demucs"
          ? { ort: got.ort, drums: got.drums, demucs: { graph: got.graph, weights: got.weights, seg: pl.seg }, fast: pl.fast }
          : { ort: got.ort, drums: got.drums, vocals: got.vocals, bass: got.bass, fast: pl.fast };
      } catch (e) { busy(false); status.textContent = `${(e as Error).message} Puedes usar la calidad «Rápida» mientras tanto.`; return; }
    }
    // Pulso y compás con Beat This! (opcional): en «Fiel» se baja (41 MB, una vez); en «Rápida», solo si ya
    // está guardado. Si no se puede, se sigue con el detector propio.
    const beat = mode === "mix" ? await beatPacks(useSep, !!useSep) : undefined;
    const wasmUrl = new URL(`${import.meta.env.BASE_URL}models/tfjs-wasm/`, document.baseURI).href;
    const prefer = (c.prefs.mlBackend as string | undefined) || undefined;
    const msg: WorkerIn = { L, R, modelUrl: modelUrl(), wasmUrl, prefer, mode, drums: opts.drums, sensitivity: opts.sensitivity, sep, beat, hint: mode === "mix" ? readHint() : undefined };
    launch(msg, [L.buffer, R.buffer, ...(sep ? [sep.ort, sep.drums, sep.vocals, sep.bass, sep.demucs?.graph, sep.demucs?.weights].filter((b): b is ArrayBuffer => !!b) : []), ...(beat ? [beat.graph, beat.weights, beat.ort].filter((b): b is ArrayBuffer => !!b) : [])], opts, sep?.demucs ? () => {
      // Demucs no avanzó (memoria del teléfono): se recuerda y se repite con MDX-Net.
      c.prefs.noDemucs = true; c.savePrefs(); void drawQ();
      status.textContent = "Este equipo no pudo con la separación en 6 fuentes (memoria). Sigo con la de 3 modelos…";
      void run();
    } : undefined);
  }
  /** Beat This! (pulso y compás, opcional en preferencias): `download` lo baja si falta (41 MB, una vez);
   *  si no, solo se usa si ya está guardado. `withSepOrt`: el motor ONNX ya viaja con la separación. */
  const beatPacks = async (download: boolean, withSepOrt: boolean): Promise<WorkerIn["beat"]> => {
    if (!c.prefs.trBeatAI) return undefined;
    try {
      const ready = download || ((await hasPack(BEAT_PACKS.weights)) && (await hasPack(BEAT_PACKS.graph)) && (withSepOrt || (await hasPack(SEP_PACKS.ort))));
      if (!ready) return undefined;
      const dl = (p: Pack) => downloadPack(p, (pct) => { status.textContent = `Descargando Beat This! (pulso y compás, una sola vez)… ${Math.round(pct)} %`; }).then((b) => b.slice().buffer);
      const graph = await dl(BEAT_PACKS.graph), weights = await dl(BEAT_PACKS.weights);
      return weights.byteLength === BEAT_WEIGHT_BYTES ? { graph, weights, ort: withSepOrt ? undefined : await dl(SEP_PACKS.ort) } : undefined;
    } catch { return undefined; }
  };
  const modelUrl = () => new URL(`${import.meta.env.BASE_URL}models/basic-pitch/${ARTIFACT ? "model.art.json" : "model.json"}`, document.baseURI).href;
  let watch = 0;
  function launch(msg: WorkerIn, transfer: Transferable[], opts: TranscribeOpts, onStall?: () => void) {
    worker?.terminate();
    clearInterval(watch);
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    // Vigía: si la separación deja de avanzar 3 minutos (el teléfono mató el proceso por memoria, sin
    // avisar), se corta y se reintenta con algo más ligero.
    let last = Date.now(), separating = true;
    const stall = () => { clearInterval(watch); worker?.terminate(); worker = null; if (onStall) onStall(); else { busy(false); status.textContent = "La separación dejó de avanzar (probablemente por memoria). Prueba un fragmento más corto o la calidad «Rápida»."; } };
    watch = window.setInterval(() => { if (worker && separating && Date.now() - last > 180_000) stall(); }, 5000);
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      last = Date.now();
      if (m.type !== "progress") clearInterval(watch);
      if (m.type === "progress") { bar.value = m.pct; status.textContent = m.msg; if (m.pct >= 60) separating = false; }
      else if (m.type === "error") { busy(false); worker?.terminate(); worker = null; status.textContent = `No se pudo transcribir: ${m.message}`; }
      else { busy(false); worker?.terminate(); worker = null; const mins = m.ms / 60000; result(sheets, c, m.analysis, opts, `${mins >= 1.5 ? `${Math.round(mins)} min` : `${Math.round(m.ms / 1000)} s`} · ${m.backend.includes("pistas") ? "pistas separadas por ti" : m.backend.includes("webgpu") ? "separado con la tarjeta gráfica" : m.backend.includes("+") ? "separado con WebAssembly" : m.backend === "webgl" ? "aceleración gráfica" : m.backend === "wasm" ? "WebAssembly" : "procesador"}`); }
    };
    worker.onerror = (e) => { clearInterval(watch); if (onStall && separating) { stall(); return; } busy(false); status.textContent = `No se pudo transcribir: ${e.message || "error del proceso"}`; };
    worker.postMessage(msg, transfer);
  }
  // Pistas ya separadas en otra app (Moises, BandLab Splitter, Ultimate Vocal Remover…): no se separa
  // nada, cada archivo se transcribe con su papel.
  type StemKind = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";
  type RowKind = StemKind | "mix";
  const STEM_NAMES: [RowKind, string][] = [["vocals", "Voz"], ["drums", "Batería"], ["bass", "Bajo"], ["guitar", "Guitarra"], ["piano", "Piano o teclado"], ["mix", "Varios instrumentos mezclados"], ["other", "Lo demás"]];
  const guessKind = (n: string): StemKind => {
    const x = n.toLowerCase();
    if (/vocal|voice|voz|vox|sing/.test(x)) return "vocals";
    if (/drum|bater|perc/.test(x)) return "drums";
    if (/bass|bajo/.test(x)) return "bass";
    if (/guit|gtr/.test(x)) return "guitar";
    if (/piano|key|tecla|synth|sinte|organ/.test(x)) return "piano";
    return "other";
  };
  const stemRows: { f: File; sel: HTMLSelectElement; multi: HTMLInputElement; el: HTMLElement }[] = [];
  const stemList = h("div");
  const stemGo = h("button", { class: "primary", disabled: true, onclick: () => void runStems() }, "Transcribir pistas");
  const stemIn = h("input", { type: "file", multiple: true, accept: "audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac", "aria-label": "Pistas separadas", onchange: () => {
    for (const f of [...(stemIn.files ?? [])]) {
      const sel = h("select", { "aria-label": `Qué es ${f.name}` }, STEM_NAMES.map(([k, n]) => h("option", { value: k, selected: k === guessKind(f.name) }, n))) as HTMLSelectElement;
      // ¿Trae más de un instrumento? (dos guitarras, piano y sinte, voz y coros, bajo y teclado…)
      const multi = h("input", { type: "checkbox", "aria-label": `${f.name} trae varios instrumentos` }) as HTMLInputElement;
      const row = { f, sel, multi, el: h("div", { class: "partrow" }, h("span", null, f.name), sel, h("label", { class: "inline" }, multi, "trae varios")) };
      stemRows.push(row); stemList.append(row.el);
    }
    stemIn.value = "";
    stemGo.disabled = !stemRows.length;
  } });
  async function runStems() {
    if (!stemRows.length) return;
    busy(true); stemGo.disabled = true;
    try {
      status.textContent = "Leyendo las pistas…";
      const got: Partial<Record<StemKind, [Float32Array, Float32Array]>> = {};
      const add = (k: StemKind, l: Float32Array, rr: Float32Array) => {
        const cur = got[k];
        if (cur) { const m = Math.min(cur[0].length, l.length); for (let i = 0; i < m; i++) { cur[0][i] += l[i]; cur[1][i] += rr[i]; } }
        else got[k] = [l.slice(), rr.slice()];
      };
      // Pistas con varios instrumentos: el algoritmo lo sabe. Varias guitarras o teclados se reparten en
      // pistas (ritmo/punteo, acordes/melodía); voz con coros o mezclas van a «lo demás», que se reparte
      // por timbre; un bajo con algo más da la línea del bajo y lo demás va aparte.
      const extra: InstrumentHint = {};
      let otherMixed = false, n = 0;
      for (const r of stemRows) {
        const [l, rr] = await decode(await r.f.arrayBuffer());
        const k = r.sel.value as RowKind, multi = r.multi.checked;
        if (k === "mix") { add("other", l, rr); otherMixed = true; }
        else if (multi && (k === "vocals" || k === "other")) { add("other", l, rr); otherMixed = true; }
        else if (multi && k === "bass") { add("bass", l, rr); add("other", l, rr); otherMixed = true; }
        else {
          add(k, l, rr);
          if (multi && k === "guitar") extra.guitars = Math.max(extra.guitars ?? 0, 2);
          if (multi && k === "piano") extra.keys = Math.max(extra.keys ?? 0, 2);
        }
        n = Math.max(n, l.length);
      }
      n = Math.min(n, MAX_SECONDS * SR);
      // Todas del mismo largo; la mezcla es la suma.
      const L = new Float32Array(n), R = new Float32Array(n);
      for (const k of Object.keys(got) as StemKind[]) {
        const [a, b] = got[k]!, A = new Float32Array(n), B = new Float32Array(n);
        A.set(a.subarray(0, n)); B.set(b.subarray(0, n)); got[k] = [A, B];
        for (let i = 0; i < n; i++) { L[i] += A[i]; R[i] += B[i]; }
      }
      const t = title.value.trim() && title.value !== "Transcripción" ? title.value.trim() : stemRows[0].f.name.replace(/[-_ ]*(vocals?|drums?|bass|guitar|piano|other|voz|bajo|bateria|batería)\.[^.]+$|\.[^.]+$/i, "") || "Pistas";
      const opts: TranscribeOpts = { mode: "mix", separate: false, presets: {}, drums: !!got.drums, sensitivity: Number(sens.value) / 100, markDoubtful: mark.checked, title: t };
      const wasmUrl = new URL(`${import.meta.env.BASE_URL}models/tfjs-wasm/`, document.baseURI).href;
      // Pulso y compás con Beat This! también con pistas importadas (si está activado: se baja si falta).
      const beat = await beatPacks(true, false);
      const msg: WorkerIn = { L, R, modelUrl: modelUrl(), wasmUrl, prefer: (c.prefs.mlBackend as string | undefined) || undefined, mode: "mix", drums: !!got.drums, sensitivity: opts.sensitivity, beat, hint: { ...extra, ...Object.fromEntries(Object.entries(readHint()).filter(([, v]) => v !== undefined)), ...(extra.guitars && !(readHint().guitars! >= 2) ? { guitars: extra.guitars } : {}), ...(extra.keys && !(readHint().keys! >= 2) ? { keys: extra.keys } : {}) }, userStems: got, otherMixed };
      launch(msg, [L.buffer, R.buffer, ...Object.values(got).flatMap((x) => [x![0].buffer, x![1].buffer]), ...(beat ? [beat.graph, beat.weights, beat.ort].filter((b): b is ArrayBuffer => !!b) : [])], opts);
    } catch (e) { busy(false); stemGo.disabled = false; status.textContent = `No pude leer las pistas: ${(e as Error).message}`; }
  }
  // MIDI hecho en otro lado (NeuralNote/MuScriptor en tu computadora, un teclado, otra app): MusicFees
  // lo convierte en pistas con tablatura, acordes y análisis.
  const midiIn = h("input", { type: "file", accept: ".mid,.midi,audio/midi", "aria-label": "Archivo MIDI", onchange: async () => {
    const f = midiIn.files?.[0];
    if (!f) return;
    try {
      const song = parseMidi(await f.arrayBuffer());
      if (!song.tracks.length) throw new Error("no tiene notas");
      const presetFor = (program: number, role: Role) => role === "drums" ? "drums" : (PRESETS.find((x) => x.program === program && x.kind !== "drums")?.id ?? undefined);
      const a = midiToAnalysis(song, presetFor, (id, role) => (id ? PRESETS.find((x) => x.id === id)?.name : undefined) ?? ROLE_NAMES[role]);
      const t = f.name.replace(/\.[^.]+$/, "") || "MIDI importado";
      result(sheets, c, a, { mode: "mix", presets: {}, drums: true, sensitivity: 0.5, markDoubtful: false, title: t }, `MIDI importado · ${song.tracks.length} pistas`);
    } catch (e) { c.toast(`No pude leer ese MIDI: ${(e as Error).message}`, true); }
  } });
  sheets.panel("Transcribir audio", "full",
    h("p", { class: "note" }, "Convierte una canción, una pista o una grabación en una canción de MusicFees: una pista por parte, con su instrumento, en tablatura y partitura, con tempo, compás, tonalidad, acordes, secciones y análisis."),
    h("div", { class: "sec" }, h("h3", null, "Audio"), h("div", { class: "inline" }, file, recBtn), status),
    trim,
    h("div", { class: "sec" }, h("h3", null, "Qué tiene la grabación"), modeBtns, soloField, drumsRow),
    h("div", { class: "sec" }, h("h3", null, "Calidad"), qBtns, qNote, h("label", { class: "inline" }, aiBeat, "Pulso y compás con red neuronal (Beat This!, experimental)"), aiNote),
    h("div", { class: "sec" }, h("h3", null, "Ajustes"),
      h("div", { class: "field" }, h("label", null, "Título"), title),
      h("div", { class: "field" }, h("label", null, "Sensibilidad"), sens),
      h("p", { class: "note" }, "Más sensibilidad encuentra notas suaves pero también ruido; menos deja solo las notas claras."),
      h("label", { class: "inline", for: "tr-mark" }, mark, "Marcar con 💬 los compases dudosos para revisarlos")),
    h("div", { class: "inline" }, go, cancel), bar,
    h("p", { class: "note" }, "Cómo funciona: en calidad «Fiel», Demucs v4 (Meta, MIT) separa voz, bajo, guitarra, piano y lo demás, y MDX-Net (KUIELab, MIT) la batería (en trozos de 3,9 s para gastar poca memoria; en equipos con poca memoria, o si la separación se atasca, MDX-Net separa voz, batería y bajo). «Fiel (rápida)» usa la misma separación con menos solapamiento entre trozos y sin el segundo separador de batería. Con varios núcleos y sin internet: tras la primera descarga, todo funciona fuera de línea; un modelo de reconocimiento de notas (Basic Pitch de Spotify, Apache-2.0) escucha cada fuente; los algoritmos propios de MusicFees reparten guitarras y teclados por timbre y tocabilidad, leen la batería pieza por pieza, encuentran pulso, compás, tonalidad, acordes, estructura y contrapunto, y eligen la digitación más cómoda. Es un borrador muy completo: revísalo y corrígelo en el editor."),
    h("div", { class: "sec" }, h("h3", null, "¿Ya tienes las pistas separadas?"),
      h("p", { class: "note" }, "Si separaste la canción en otra app (Moises, BandLab Splitter, Ultimate Vocal Remover…), sube aquí sus pistas: voz, batería, bajo, guitarra, piano, lo demás. MusicFees transcribe cada una con su instrumento, sin volver a separar. Si una pista trae más de un instrumento (dos guitarras, piano y sinte, voz con coros, bajo con teclado…), marca «trae varios» o elige «Varios instrumentos mezclados»: así MusicFees reparte esas notas en varias pistas en vez de escribirlas como un solo instrumento."),
      stemIn, stemList, stemGo),
    h("div", { class: "sec" }, h("h3", null, "¿Ya tienes un MIDI?"),
      h("p", { class: "note" }, "Si transcribiste en tu computadora con NeuralNote (gratis, usa el modelo MuScriptor) u otra herramienta, importa aquí el MIDI: MusicFees lo convierte en pistas con tablatura, acordes, secciones y análisis."),
      midiIn),
    h("p", { class: "note" }, "Transcribe solo música propia o que tengas derecho a usar."));
}

function result(sheets: Sheets, c: AppCtx, a: Analysis, opts: TranscribeOpts, took: string) {
  const parts = a.parts.filter((p) => p.notes.length);
  const rows = parts.map((p) => {
    const on = h("input", { type: "checkbox", checked: p.role !== "drums" || opts.drums });
    const kinds = p.role === "drums" ? ["drums"] : ["tab", "notation"];
    const sel = presetSelect(opts.presets[p.role] ?? suggestPreset(p), kinds);
    return { p, on, sel, el: h("div", { class: "partrow" }, h("label", null, on, h("span", null, p.name ?? ROLE_NAMES[p.role], h("small", null, `${p.notes.length} notas`))), sel) };
  });
  const create = h("button", { class: "primary", onclick: async () => {
    const presets: Partial<Record<Role, string>> = {};
    const keep = rows.filter((r) => r.on.checked);
    if (!keep.length) { c.toast("Elige al menos una parte.", true); return; }
    for (const r of keep) { presets[r.p.role] ??= r.sel.value; r.p.preset = r.sel.value; }
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
