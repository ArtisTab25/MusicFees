// Biblioteca de acordes y escalas (posiciones de guitarra calculadas, no una tabla fija).
export const G6 = [64, 59, 55, 50, 45, 40];
export const NOTE_NAMES = {
  en: ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"],
  es: ["Do", "Do♯", "Re", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "La♭", "La", "Si♭", "Si"],
};
export type NameSys = keyof typeof NOTE_NAMES;
export const pcName = (pc: number, sys: NameSys = "en") => NOTE_NAMES[sys][((pc % 12) + 12) % 12];
export const midiName = (m: number, sys: NameSys = "en") => pcName(m, sys) + (Math.floor(m / 12) - 1);

export interface ChordType { g: string; k: string; n: string; iv: number[]; opt?: number[]; f: string }
export const CHORDS: ChordType[] = [
  { g: "Tríadas", k: "", n: "Mayor", iv: [0, 4, 7], f: "1 3 5" },
  { g: "Tríadas", k: "m", n: "Menor", iv: [0, 3, 7], f: "1 ♭3 5" },
  { g: "Tríadas", k: "5", n: "Quinta (power chord)", iv: [0, 7], f: "1 5" },
  { g: "Tríadas", k: "dim", n: "Disminuido", iv: [0, 3, 6], f: "1 ♭3 ♭5" },
  { g: "Tríadas", k: "aug", n: "Aumentado", iv: [0, 4, 8], f: "1 3 ♯5" },
  { g: "Suspendidos", k: "sus4", n: "Suspendido 4", iv: [0, 5, 7], f: "1 4 5" },
  { g: "Suspendidos", k: "sus2", n: "Suspendido 2", iv: [0, 2, 7], f: "1 2 5" },
  { g: "Suspendidos", k: "7sus4", n: "Séptima sus4", iv: [0, 5, 7, 10], opt: [7], f: "1 4 5 ♭7" },
  { g: "Séptimas", k: "7", n: "Séptima dominante", iv: [0, 4, 7, 10], opt: [7], f: "1 3 5 ♭7" },
  { g: "Séptimas", k: "maj7", n: "Séptima mayor", iv: [0, 4, 7, 11], opt: [7], f: "1 3 5 7" },
  { g: "Séptimas", k: "m7", n: "Menor séptima", iv: [0, 3, 7, 10], opt: [7], f: "1 ♭3 5 ♭7" },
  { g: "Séptimas", k: "m7♭5", n: "Semidisminuido", iv: [0, 3, 6, 10], f: "1 ♭3 ♭5 ♭7" },
  { g: "Séptimas", k: "dim7", n: "Disminuido séptima", iv: [0, 3, 6, 9], f: "1 ♭3 ♭5 𝄫7" },
  { g: "Séptimas", k: "m(maj7)", n: "Menor con séptima mayor", iv: [0, 3, 7, 11], opt: [7], f: "1 ♭3 5 7" },
  { g: "Sextas y add", k: "6", n: "Sexta", iv: [0, 4, 7, 9], opt: [7], f: "1 3 5 6" },
  { g: "Sextas y add", k: "m6", n: "Menor sexta", iv: [0, 3, 7, 9], opt: [7], f: "1 ♭3 5 6" },
  { g: "Sextas y add", k: "6/9", n: "Sexta novena", iv: [0, 4, 7, 9, 2], opt: [7], f: "1 3 5 6 9" },
  { g: "Sextas y add", k: "add9", n: "Novena añadida", iv: [0, 4, 7, 2], opt: [7], f: "1 3 5 9" },
  { g: "Sextas y add", k: "m(add9)", n: "Menor novena añadida", iv: [0, 3, 7, 2], opt: [7], f: "1 ♭3 5 9" },
  { g: "Extendidos", k: "9", n: "Novena dominante", iv: [0, 4, 7, 10, 2], opt: [7], f: "1 3 5 ♭7 9" },
  { g: "Extendidos", k: "maj9", n: "Novena mayor", iv: [0, 4, 7, 11, 2], opt: [7], f: "1 3 5 7 9" },
  { g: "Extendidos", k: "m9", n: "Menor novena", iv: [0, 3, 7, 10, 2], opt: [7], f: "1 ♭3 5 ♭7 9" },
  { g: "Extendidos", k: "11", n: "Oncena", iv: [0, 4, 7, 10, 2, 5], opt: [7, 2, 4], f: "1 (3) 5 ♭7 9 11" },
  { g: "Extendidos", k: "m11", n: "Menor oncena", iv: [0, 3, 7, 10, 2, 5], opt: [7, 2], f: "1 ♭3 5 ♭7 9 11" },
  { g: "Extendidos", k: "13", n: "Trecena", iv: [0, 4, 7, 10, 2, 9], opt: [7, 2], f: "1 3 5 ♭7 9 13" },
  { g: "Extendidos", k: "maj7♯11", n: "Mayor séptima ♯11", iv: [0, 4, 7, 11, 6], opt: [7], f: "1 3 5 7 ♯11" },
  { g: "Alterados", k: "7♭9", n: "Séptima ♭9", iv: [0, 4, 7, 10, 1], opt: [7], f: "1 3 5 ♭7 ♭9" },
  { g: "Alterados", k: "7♯9", n: "Séptima ♯9", iv: [0, 4, 7, 10, 3], opt: [7], f: "1 3 5 ♭7 ♯9" },
  { g: "Alterados", k: "7♯5", n: "Séptima aumentada", iv: [0, 4, 8, 10], f: "1 3 ♯5 ♭7" },
  { g: "Alterados", k: "7♭5", n: "Séptima ♭5", iv: [0, 4, 6, 10], f: "1 3 ♭5 ♭7" },
];

export interface Voicing { frets: number[]; cost: number; pos: number }
const vcache = new Map<string, Voicing[]>();
/** Posiciones tocables (máx. 4 trastes de apertura, 4 dedos, bajo en la tónica). frets[0] = cuerda aguda. */
export function voicings(root: number, c: ChordType): Voicing[] {
  const key = root + "|" + c.k;
  const hit = vcache.get(key);
  if (hit) return hit;
  const pcs = new Set(c.iv.map((i) => (root + i) % 12));
  const req = new Set(c.iv.filter((i) => !(c.opt || []).includes(i)).map((i) => (root + i) % 12));
  const minPlayed = c.iv.length === 2 ? 2 : Math.min(4, Math.max(3, c.iv.length));
  const found = new Map<string, Voicing>();
  for (let base = 0; base <= 12; base++) {
    const opts: number[][] = [];
    for (let s = 0; s < 6; s++) {
      const o = [-1];
      for (const f of [0, ...Array.from({ length: 4 }, (_, i) => Math.max(1, base) + i)])
        if (!o.includes(f) && pcs.has((G6[s] + f) % 12)) o.push(f);
      opts.push(o);
    }
    const fr = new Array<number>(6);
    const rec = (s: number, state: number) => {
      if (s < 0) {
        const pl = fr.map((f, i) => ({ f, i })).filter((z) => z.f >= 0);
        if (pl.length < minPlayed) return;
        const bass = pl.reduce((a, z) => (G6[z.i] + z.f < G6[a.i] + a.f ? z : a));
        if ((G6[bass.i] + bass.f) % 12 !== root) return;
        const have = new Set(pl.map((z) => (G6[z.i] + z.f) % 12));
        for (const p of req) if (!have.has(p)) return;
        const ft = pl.filter((z) => z.f > 0).map((z) => z.f);
        const mn = ft.length ? Math.min(...ft) : 0, mx = ft.length ? Math.max(...ft) : 0;
        if (mx - mn > 3) return;
        const atMin = ft.filter((f) => f === mn).length;
        const fingers = atMin >= 2 ? 1 + ft.length - atMin : ft.length;
        if (fingers > 4 || (c.iv.length === 2 && pl.length > 3)) return;
        const k = fr.join(",");
        if (found.has(k)) return;
        const cost = mn * 1.1 + (mx - mn) * 0.5 + (6 - pl.length) * 0.7 + fingers * 0.35 +
          (c.iv.length === 2 && bass.i < 4 ? 3 : 0) + (ft.length && pl.some((z) => z.f === 0) && mn >= 3 ? (mn > 4 ? 3 : 1.5) : 0);
        found.set(k, { frets: fr.slice(), cost, pos: mn });
        return;
      }
      for (const f of opts[s]) {
        if (f >= 0 && state === 2) continue;
        fr[s] = f;
        rec(s - 1, f >= 0 ? 1 : state === 1 ? 2 : state);
      }
    };
    rec(5, 0);
  }
  const all = [...found.values()].sort((a, b) => a.cost - b.cost), pick: Voicing[] = [];
  for (const v of all) {
    if (pick.length >= 6) break;
    if (pick.some((p) => Math.abs(p.pos - v.pos) < 2)) continue;
    pick.push(v);
  }
  pick.sort((a, b) => a.pos - b.pos);
  vcache.set(key, pick);
  return pick;
}

/** Notas de un acorde para teclados, de la voz aguda a la grave. */
export function keysVoicing(root: number, c: ChordType, maxNotes: number, octave = 3): number[] {
  let iv = c.iv.slice();
  const opt = (c.opt || []).slice();
  while (iv.length > maxNotes && opt.length) { const o = opt.shift(); iv = iv.filter((i) => i !== o); }
  iv = iv.slice(0, maxNotes);
  let prev = -1;
  const out: number[] = [];
  for (const i of iv) { let v = i; while (v <= prev) v += 12; out.push(v); prev = v; }
  const base = (octave + 1) * 12 + (((root % 12) + 12) % 12);
  return out.map((v) => base + v).sort((a, b) => b - a);
}

export function diagramSvg(frets: number[], root: number, sys: NameSys = "en"): string {
  const pl = frets.filter((f) => f > 0), mn = pl.length ? Math.min(...pl) : 1, mx = pl.length ? Math.max(...pl) : 1;
  const start = mx <= 5 ? 1 : mn, X = (i: number) => 18 + i * 14, Y = (j: number) => 26 + j * 18;
  let o = `<svg viewBox="0 0 108 124" role="img" aria-label="Diagrama">`;
  for (let i = 0; i < 6; i++) o += `<line class="dl" x1="${X(i)}" x2="${X(i)}" y1="${Y(0)}" y2="${Y(5)}"/>`;
  for (let j = 0; j <= 5; j++) o += `<line class="${j === 0 && start === 1 ? "dn" : "dl"}" x1="${X(0)}" x2="${X(5)}" y1="${Y(j)}" y2="${Y(j)}"/>`;
  if (start > 1) o += `<text class="df" x="${X(5) + 5}" y="${Y(0) + 12}">${start}</text>`;
  for (let s = 0; s < 6; s++) {
    const i = 5 - s, f = frets[s];
    if (f < 0) o += `<text class="dt" x="${X(i)}" y="${Y(0) - 7}">×</text>`;
    else if (f === 0) o += `<circle cx="${X(i)}" cy="${Y(0) - 10}" r="3.6" class="dl" fill="none"/>`;
    else o += `<circle class="${(G6[s] + f) % 12 === root ? "dr" : "dd"}" cx="${X(i)}" cy="${Y(f - start + 0.5)}" r="5.6"/>`;
  }
  for (let s = 0; s < 6; s++) {
    const f = frets[s];
    if (f >= 0) o += `<text class="dt" x="${X(5 - s)}" y="${Y(5) + 13}" font-size="8.5">${pcName(G6[s] + f, sys)}</text>`;
  }
  return o + `</svg>`;
}
