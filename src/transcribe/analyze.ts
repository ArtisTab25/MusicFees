// El análisis completo: de notas (y rasgos del audio) a tempo, compás, tonalidad, acordes, estructura,
// partes y contrapunto. Puro: corre en el worker del transcriptor y también sobre una partitura.
import type { Analysis, Part, RawNote } from "./types";
import { beatChroma, detectKey, recognizeChords } from "./harmony";
import { findSections } from "./form";
import { meterAndDownbeat, valueAt } from "./rhythm";
import { removeOvertones, splitRoles } from "./parts";
import { cleanLine, splitOther } from "./timbre";
import type { StemNotes } from "./types";
import { analyzeCounterpoint, type VNote } from "./counterpoint";

/** Ajustes del modo de 6 fuentes (calibrados con las partituras de Brayand). */
export const SIX_OPTS = { leftover: false, dedupe: true };

/** Posición en tiempos (negras, con decimales) de un instante, según la lista de tiempos. */
export function beatPos(beats: number[], t: number): number {
  const n = beats.length;
  if (n < 2) return t * 2;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

const cosd = (a: number[], b: number[]) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? 1 - s / Math.sqrt(na * nb) : 0;
};

export interface AudioFeatures {
  /** Función de ataque general, de los graves y su fps. */
  onset: Float32Array; bassOnset: Float32Array; fps: number;
  /** Intensidad por segundo. */
  rms: Float32Array;
}

/**
 * Análisis a partir de notas y tiempos ya conocidos. Si `meter` no viene, se detecta con los acentos
 * (ataques del bajo, cambios de armonía y fuerza del golpe en cada tiempo).
 */
export function analyzeNotes(input: {
  notes: RawNote[]; drums?: RawNote[]; beats: number[]; duration: number; tempo: number;
  mode: "mix" | "solo"; meter?: 3 | 4; downbeat?: number; audio?: AudioFeatures;
  /** Si la mezcla se separó: notas de cada fuente (entonces `notes` se ignora). */
  stems?: StemNotes;
}): Analysis {
  const { beats, duration, tempo, mode, audio, stems } = input;
  // Con fuentes separadas: la voz y el bajo son líneas de una sola nota; lo demás, polifónico.
  const sp = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  const vocals = stems ? cleanLine(removeOvertones(stems.vocals), "high", 0.1) : [];
  // El bajo ya viene cortado por golpes (YIN): no se unen notas repetidas.
  const bassLine = stems ? cleanLine(stems.bass.filter((n) => n.p <= 67), "low", 0.07, false) : [];
  const other = stems ? removeOvertones(stems.other) : [];
  const gtr6 = stems?.guitar ? removeOvertones(stems.guitar) : null, keys6 = stems?.keys ? removeOvertones(stems.keys) : null;
  const notes = stems ? [...other, ...(gtr6 ?? []), ...(keys6 ?? []), ...bassLine] : input.notes;
  // Del audio: fuera los armónicos fantasma antes de todo lo demás.
  const pitched = (audio && !stems ? removeOvertones(notes) : notes).filter((n) => n.e > n.s);
  const { chroma, bass, energy } = beatChroma(pitched, beats);
  // Compás y primer tiempo fuerte
  let meter = input.meter, downbeat = input.downbeat ?? 0;
  if (!meter) {
    const accent = beats.map((t, k) => {
      const ch = k > 0 ? cosd(chroma[k], chroma[k - 1]) : 0;
      const bOn = audio ? valueAt(audio.bassOnset, audio.fps, t) : bassAttack(pitched, t);
      const on = audio ? valueAt(audio.onset, audio.fps, t) : 0;
      return ch * 1.2 + bOn * 1 + on * 0.4;
    });
    // Con batería o bajo separados: el compás se ve en lo que se repite (el patrón de bombo y caja, el
    // bajo, la armonía) cada 3 o cada 4 tiempos. Si eso no decide, quedan los acentos.
    const pm = stems || input.drums?.length ? patternMeter(beats, input.drums ?? [], bassLine, chroma) : null;
    const md = meterAndDownbeat(accent, pm?.meter);
    meter = md.meter; downbeat = md.downbeat;
  }
  // Tonalidad: histograma de clases de altura ponderado por duración y fuerza.
  const hist = new Array(12).fill(0);
  for (const n of pitched) hist[((n.p % 12) + 12) % 12] += (n.e - n.s) * (0.3 + n.a) * (n.p < 48 ? 0.6 : 1);
  for (const n of vocals) hist[((n.p % 12) + 12) % 12] += (n.e - n.s) * 0.5; // la melodía cantada también define la tonalidad
  const key = detectKey(hist);
  // Acordes: la probabilidad de cambio depende de dónde cae el tiempo en el compás.
  const strength = beats.map((_, k) => {
    const inBar = (((k - downbeat) % meter!) + meter!) % meter!;
    return inBar === 0 ? 1 : meter === 4 && inBar === 2 ? 0.6 : 0.25;
  });
  const chords = recognizeChords(chroma, bass, energy, key, strength);
  // Estructura: rasgos por compás (armonía media y bajo) + intensidad.
  const off = downbeat > 0 ? downbeat - meter : 0; // compás de anacrusa
  const nBars = Math.max(1, Math.ceil((beats.length - off) / meter));
  const feats: number[][] = [], en: number[] = [];
  for (let b = 0; b < nBars; b++) {
    const f = new Array(24).fill(0);
    let e = 0;
    for (let k = off + b * meter; k < off + (b + 1) * meter; k++) {
      if (k < 0 || k >= beats.length) continue;
      const cs = chroma[k].reduce((x, y) => x + y, 0) || 1, bs = bass[k].reduce((x, y) => x + y, 0) || 1;
      for (let p = 0; p < 12; p++) { f[p] += chroma[k][p] / cs; f[12 + p] += (0.6 * bass[k][p]) / bs; }
      e += audio ? rmsAt(audio.rms, beats[k]) : energy[k];
    }
    feats.push(f); en.push(e);
  }
  const sections = findSections(feats, en);
  // Partes
  const parts: Part[] = [];
  let counterpoint = null;
  const q = (t: number) => beatPos(beats, t) - off;
  if (stems) {
    if (vocals.length >= 4) parts.push({ role: "vocals", notes: vocals, hint: "voice" });
    const L = splitOther(other, stems.otherTimbre && stems.otherTimbre.length === stems.other.length ? alignTimbre(stems.other, other, stems.otherTimbre) : null, sp);
    let lead = L.lead, leadHint = L.hints.lead, G: RawNote[], K: RawNote[], gHint = L.hints.guitar;
    if (gtr6 || keys6) {
      // 6 fuentes: guitarra y piano salen de su propia pista; de «lo demás» queda la línea principal
      // (vientos, cuerdas, sinte).
      // «Lo demás» con varios instrumentos (pista importada así marcada): lo que suena a teclado se suma a
      // los teclados; lo que suena a guitarra solo si no vino una pista de guitarra aparte.
      const mixed = !!stems.otherMixed;
      G = [...(gtr6 ?? []), ...(SIX_OPTS.leftover || (mixed && !gtr6?.length) ? L.guitar : [])];
      K = [...(keys6 ?? []), ...(SIX_OPTS.leftover || (mixed && !keys6?.length) ? L.keys : [])];
      const gt = stems.guitarTimbre && stems.guitar && stems.guitarTimbre.length === stems.guitar.length ? alignTimbre(stems.guitar, gtr6 ?? [], stems.guitarTimbre) : [];
      const bright = gt.length ? gt.reduce((x, t) => x + t.bright, 0) / gt.length : 0.4;
      gHint = bright > 0.9 ? "gtr_dist" : bright > 0.55 ? "gtr_od" : "gtr_clean";
      // Con la guitarra ya aparte, la línea principal de «lo demás» suele ser viento, cuerda o sinte (medido).
      if (leadHint === "gtr_clean") leadHint = "lead_saw";
    } else { G = L.guitar; K = L.keys; }
    if (SIX_OPTS.dedupe && (gtr6 || keys6)) {
      // Lo que se coló de una fuente en otra (la guitarra en «lo demás» o en el piano) sale dos veces:
      // misma nota, mismo momento. Se queda en la fuente donde suena más fuerte.
      const dup = (a: RawNote[], b: RawNote[], tie = true) => {
        const bs = [...b].sort((x, y) => x.s - y.s);
        return a.filter((n) => {
          let lo = 0, hi = bs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (bs[m].s < n.s - 0.06) lo = m + 1; else hi = m; }
          for (let i = lo; i < bs.length && bs[i].s <= n.s + 0.06; i++) if (bs[i].p === n.p && (tie ? bs[i].a >= n.a : bs[i].a > n.a)) return false;
          return true;
        });
      };
      lead = dup(dup(lead, G), K);
      const K2 = dup(K, G), G2 = dup(G, K, false); G = G2; K = K2; // en empate se queda en la guitarra
    }
    // Lo que indicó el usuario manda sobre lo que se adivinó.
    const H = stems.hint ?? {};
    if (H.guitars === 0 && H.keys !== 0) { K = [...K, ...G]; G = []; }
    if (H.keys === 0 && H.guitars !== 0) { G = [...G, ...K]; K = []; }
    if (H.leads === 0 && lead.length) { if (H.guitars !== 0) G = [...G, ...lead]; else K = [...K, ...lead]; lead = []; }
    if (lead.length) parts.push({ role: "melody", notes: lead, hint: leadHint, name: H.leads ? "Melodía (vientos/cuerdas/sinte)" : undefined });
    const nG = H.guitars ?? 1, nK = H.keys ?? 1;
    for (const [i, x] of splitLayer(cleanHarmony(G, chords, beats, !!bassLine.length), nG, sp).entries()) {
      const solo = nG > 1 && i === 1;
      parts.push({ role: "guitar", notes: x, hint: solo && gHint === "gtr_clean" ? "gtr_od" : gHint, name: nG > 1 ? `Guitarra ${i + 1}${solo ? " (punteo)" : i === 0 ? " (ritmo)" : ""}` : undefined });
    }
    for (const [i, x] of splitLayer(cleanHarmony(K, chords, beats, !!bassLine.length), nK, sp).entries())
      parts.push({ role: "keys", notes: x, hint: L.hints.keys, name: nK > 1 ? `Teclado ${i + 1}${i === 1 ? " (melodía)" : i === 0 ? " (acordes)" : ""}` : undefined });
    if (bassLine.length) parts.push({ role: "bass", notes: bassLine });
    const toV = (ns: RawNote[]): VNote[] => ns.map((n) => ({ q0: Math.round(q(n.s) * 4) / 4, q1: Math.round(q(n.e) * 4) / 4, p: n.p })).filter((n) => n.q1 > n.q0);
    const top = vocals.length >= 4 ? vocals : lead;
    if (top.length && bassLine.length) counterpoint = analyzeCounterpoint(toV(top), toV(bassLine), meter, [vocals.length >= 4 ? "Voz" : "Melodía", "Bajo"]);
  } else if (mode === "mix") {
    const r = splitRoles(pitched);
    if (r.melody.length) parts.push({ role: "melody", notes: r.melody });
    if (r.harmony.length) parts.push({ role: "harmony", notes: cleanHarmony(r.harmony, chords, beats, !!r.bass.length) });
    if (r.bass.length) parts.push({ role: "bass", notes: r.bass });
    const toV = (ns: RawNote[]): VNote[] => ns.map((n) => ({ q0: Math.round(q(n.s) * 4) / 4, q1: Math.round(q(n.e) * 4) / 4, p: n.p })).filter((n) => n.q1 > n.q0);
    if (r.melody.length && r.bass.length) counterpoint = analyzeCounterpoint(toV(r.melody), toV(r.bass), meter);
  } else parts.push({ role: "all", notes: pitched });
  if (input.drums?.length) parts.push({ role: "drums", notes: input.drums });
  // Compases dudosos: notas débiles o muy cortas.
  const perBar = new Map<number, { n: number; weak: number }>();
  for (const n of pitched) {
    const b = Math.floor(q(n.s) / meter);
    const x = perBar.get(b) ?? { n: 0, weak: 0 };
    x.n++; if (n.a < 0.33 || n.e - n.s < 0.06) x.weak++;
    perBar.set(b, x);
  }
  const doubtful = [...perBar].filter(([, x]) => x.n >= 3 && x.weak / x.n > 0.45).map(([b]) => b).sort((a, b) => a - b);
  const notesForUser: string[] = [];
  if (key.conf < 0.25) notesForUser.push("La tonalidad no es clara (modulaciones o poca armonía): revisa la armadura.");
  if (doubtful.length > nBars * 0.3) notesForUser.push("Muchos compases tienen notas débiles: la grabación puede tener ruido o mucha mezcla. Prueba con una pista más limpia o con «Un instrumento».");
  return { duration, tempo, beats, meter, downbeat, key, chords, sections, parts, counterpoint, doubtful, notes: pitched.length, notesForUser };
}

/**
 * Limpieza guiada por la armonía (propio de MusicFees): en la parte de acordes se quitan las notas
 * débiles y cortas que no pertenecen al acorde reconocido en ese tiempo, y las del registro del bajo
 * cuando ya hay pista de bajo. Deja acordes más tocables sin perder notas de paso fuertes.
 */
function cleanHarmony(notes: RawNote[], chords: import("./types").ChordSeg[], beats: number[], hasBass: boolean): RawNote[] {
  const CT: Record<string, number[]> = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], "5": [0, 7] };
  const chordAt = (t: number) => {
    const k = Math.max(0, Math.floor(beatPos(beats, t + 0.02)));
    return chords.find((c) => k >= c.b0 && k <= c.b1);
  };
  const spb = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  return notes.filter((n) => {
    if (hasBass && n.p < 45) return false;
    const c = chordAt(n.s);
    if (!c || c.root < 0) return true;
    const inChord = (CT[c.type] ?? [0, 4, 7]).some((iv) => (c.root + iv) % 12 === ((n.p % 12) + 12) % 12);
    return inChord || n.a >= 0.55 || n.e - n.s >= spb;
  });
}

/**
 * Reparte una capa (guitarras o teclados) entre `n` pistas, como suelen escribirse: la 1 los acordes o
 * el ritmo, la 2 la línea de una nota que sobresale arriba (punteo, melodía) y, si hay más, el ritmo se
 * divide por registro (grave / agudo). Con n = 1 o pocas notas, todo queda en una.
 */
export function splitLayer(notes: RawNote[], n: number, beat: number): RawNote[][] {
  if (!notes.length) return [];
  if (n <= 1 || notes.length < 24) return [notes];
  const L = splitOther(notes, null, beat);
  // La línea puede corregir octavas (objetos nuevos): se compara por inicio y fin.
  const k = (x: RawNote) => `${x.s.toFixed(4)}|${x.e.toFixed(4)}`;
  const leadSet = new Set(L.lead.map(k));
  const rest = notes.filter((x) => !leadSet.has(k(x)));
  const out: RawNote[][] = [];
  if (n >= 3 && rest.length >= 24) {
    const ps = rest.map((x) => x.p).sort((a, b) => a - b), mid = ps[ps.length >> 1];
    out.push(rest.filter((x) => x.p < mid), L.lead, rest.filter((x) => x.p >= mid));
  } else out.push(rest, L.lead);
  return out.filter((x) => x.length);
}

/** `removeOvertones` puede quitar notas: se conserva el timbre de las que quedan. */
function alignTimbre<T>(orig: RawNote[], kept: RawNote[], tim: T[]): T[] {
  const key = (n: RawNote) => `${n.s.toFixed(4)}|${n.p}`;
  const m = new Map(orig.map((n, i) => [key(n), tim[i]]));
  return kept.map((n) => m.get(key(n))!);
}

/**
 * Compás por repetición (propio de MusicFees): para cada tiempo, un vector con lo que pasa en él
 * (bombo, caja, platillos y bajo en cada cuarto del tiempo, y la armonía). En 3/4 el tiempo k se parece
 * más al k+3 y al k+6; en 4/4, al k+4 y al k+8. Devuelve el compás solo si la diferencia es clara.
 */
export function patternMeter(beats: number[], drums: RawNote[], bass: RawNote[], chroma: number[][]): { meter: 3 | 4; margin: number } | null {
  const n = beats.length;
  if (n < 16) return null;
  const sub = 4, D = 4 * sub + 12;
  const v = beats.map(() => new Float64Array(D));
  const put = (t: number, ch: number, w: number) => {
    const q = beatPos(beats, t);
    const k = Math.floor(q + 0.5 / sub), f = Math.round((q - k) * sub);
    if (k < 0 || k >= n || f < 0 || f >= sub) return;
    v[k][ch * sub + f] += w;
  };
  for (const d of drums) put(d.s, d.p === 36 ? 0 : d.p === 38 ? 1 : d.p >= 41 && d.p <= 48 && d.p !== 42 && d.p !== 44 && d.p !== 46 ? 3 : 2, d.p === 36 || d.p === 38 ? 1 : 0.5);
  for (const b of bass) put(b.s, 3, 0.7);
  for (let k = 0; k < n; k++) { const c = chroma[k], s = c.reduce((a, b) => a + b, 0) || 1; for (let p = 0; p < 12; p++) v[k][4 * sub + p] = (0.6 * c[p]) / s; }
  const sim = (a: Float64Array, b: Float64Array) => { let x = 0, na = 0, nb = 0; for (let i = 0; i < D; i++) { x += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? x / Math.sqrt(na * nb) : 0; };
  const lagSim = (L: number) => { let s = 0, c = 0; for (let k = 0; k + L < n; k++) { s += sim(v[k], v[k + L]); c++; } return c ? s / c : 0; };
  const s3 = lagSim(3) + lagSim(6), s4 = lagSim(4) + lagSim(8);
  const dbg = (globalThis as { MF_DEBUG?: (k: string, v: unknown) => void }).MF_DEBUG;
  if (typeof dbg === "function") dbg("meterLags", [2, 3, 4, 5, 6, 7, 8, 9, 12].map((L) => `${L}:${lagSim(L).toFixed(2)}`).join(" "));
  const margin = s3 - s4;
  if (Math.abs(margin) < 0.06) return null;
  return { meter: margin > 0 ? 3 : 4, margin };
}

function rmsAt(rms: Float32Array, t: number) { return rms[Math.min(rms.length - 1, Math.max(0, Math.floor(t)))] ?? 0; }
/** Sin audio (partitura): ¿empieza una nota grave en este tiempo? */
function bassAttack(notes: RawNote[], t: number) {
  let v = 0;
  for (const n of notes) if (n.p < 52 && Math.abs(n.s - t) < 0.05) v = Math.max(v, 0.5 + n.a / 2);
  return v;
}
