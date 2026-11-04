// Mide el reconocedor de acordes de MusicFees contra los acordes ESCRITOS en las partituras de Brayand
// (diagramas/nombres del .gp). Entrada: las notas de la partitura (sin audio), para medir solo la armonía.
//   node chords_eval.mjs <ref.json>...
import { readFileSync } from "node:fs";
import { beatChroma, recognizeChords, detectKey, HARM_OPTS, setExtended } from "../musicfees/src/transcribe/harmony";
if (process.env.HO) Object.assign(HARM_OPTS, JSON.parse(process.env.HO));
if (process.env.EXT) setExtended(true);
const QUIET = !!process.env.QUIET;
import type { RawNote } from "../musicfees/src/transcribe/types";

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parse(name: string): { root: number; q: "M" | "m" | "o" } | null {
  const m = /^([A-G])([#b♯♭]?)(.*)$/.exec(name.trim());
  if (!m) return null;
  const root = (PC[m[1]] + (m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0) + 12) % 12;
  const rest = m[3].split("/")[0];
  // menor: «m» que no sea «maj»; «dim», «ø», «m7b5» → disminuido; «5», «sus» y el resto → mayor/neutro
  const q = /^(dim|°|ø|m7b5)/.test(rest) ? "o" : /^m(?!aj)/.test(rest) || /^min/.test(rest) ? "m" : "M";
  return { root, q };
}
const qOf = (t: string) => (/^m(?!aj)/.test(t) ? "m" : /dim|m7b5/.test(t) ? "o" : "M");

const tot = { n: 0, root: 0, rq: 0 };
const ERR: Record<string, number> = {};
for (const f of process.argv.slice(2)) {
  const R = JSON.parse(readFileSync(f, "utf8"));
  const written = (R.chords as { t: number; name: string; track: number }[]).filter((c) => parse(c.name)).sort((a, b) => a.t - b.t);
  // un solo flujo: si hay varias pistas con acordes, la que más tenga
  const byTrack = new Map<number, typeof written>();
  for (const c of written) (byTrack.get(c.track) ?? byTrack.set(c.track, []).get(c.track)!).push(c);
  const W = [...byTrack.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  // quitar repeticiones seguidas del mismo nombre (rasgueos con diagrama en cada golpe)
  const segsW = W.filter((c, i) => i === 0 || c.name !== W[i - 1].name);
  if (segsW.length < 6) continue;
  const notes: RawNote[] = [];
  // MEL=1: sin las pistas de melodía (líneas de una nota: vientos, violín solista, sinte solista, voz)
  const mono = (t: { notes: { s: number; e: number }[] }) => { let poly = 0; const ns = t.notes; for (let i = 1; i < ns.length; i++) if (ns[i].s < ns[i - 1].e - 0.02 && ns[i].s - ns[i - 1].s < 0.03) poly++; return poly < 0.05 * ns.length; };
  const isBass = (t: { tuning: number[]; notes: { p: number }[] }) => (t.tuning[0] ?? 64) < 50;
  for (const t of R.tracks) if (!t.perc && !t.mute && !(process.env.MEL && !isBass(t) && mono(t))) for (const n of t.notes) notes.push({ s: n.s, e: n.e, p: n.p, a: n.v / 127 });
  notes.sort((a, b) => a.s - b.s);
  // pulsos desde el mapa de tempo
  const beats: number[] = [];
  const tempos: [number, number][] = R.tempos.length ? R.tempos : [[0, R.tempo]];
  let t = 0, ti = 0;
  while (t < R.dur) { beats.push(t); while (ti + 1 < tempos.length && tempos[ti + 1][0] <= t + 1e-6) ti++; t += 60 / tempos[ti][1]; }
  const hist = new Array(12).fill(0); for (const n of notes) hist[n.p % 12] += n.e - n.s;
  const key = detectKey(hist);
  const bc = beatChroma(notes, beats);
  const meter = R.ts[0] % 3 === 0 && R.ts[0] !== 12 ? 3 : R.ts[0] === 12 ? 4 : R.ts[0];
  const strength = beats.map((_, k) => (k % meter === 0 ? 1 : 0.3));
  const est = recognizeChords(bc.chroma, bc.bass, bc.energy, key, strength);
  const at = (time: number) => { let k = 0; while (k + 1 < beats.length && beats[k + 1] <= time) k++; return est.find((s) => k >= s.b0 && k <= s.b1); };
  let n = 0, r = 0, rq = 0;
  for (let i = 0; i < segsW.length; i++) {
    const t0 = segsW[i].t, t1 = Math.min(segsW[i + 1]?.t ?? t0 + 4, t0 + 8);
    const ref = parse(segsW[i].name)!;
    if (process.env.SHOW && i < 40) { const e = at(t0 + 0.3); console.log(`   ${t0.toFixed(1).padStart(6)} escrito ${segsW[i].name.padEnd(10)} estimado ${e?.name ?? "-"}`); }
    for (let x = t0 + 0.05; x < t1; x += 0.25) {
      const e = at(x + Number(process.env.SHIFT ?? 0)); n++;
      if (e && e.root === ref.root) { r++; if (qOf(e.type) === ref.q) rq++; }
      else if (e) { const k = `${(e.root - ref.root + 12) % 12}${e.bass >= 0 ? "/b" : ""}`; ERR[k] = (ERR[k] ?? 0) + 1; } else ERR.none = (ERR.none ?? 0) + 1;
    }
  }
  tot.n += n; tot.root += r; tot.rq += rq;
  if (!QUIET) console.log(`${f.split("/").pop()!.padEnd(28)} acordes escritos ${String(segsW.length).padStart(3)} · raíz ${(100 * r / n).toFixed(0).padStart(3)} % · raíz+mayor/menor ${(100 * rq / n).toFixed(0).padStart(3)} %`);
}
console.log("errores (intervalo estimado−escrito):", Object.entries(ERR).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(" "));
console.log(`TOTAL raíz ${(100 * tot.root / tot.n).toFixed(1)} % · raíz+mayor/menor ${(100 * tot.rq / tot.n).toFixed(1)} %`);
