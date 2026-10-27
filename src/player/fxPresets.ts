// Presets de efectos por pista, pensados para los géneros que más se escriben en MusicFees.
import type { MasterFx, PedalType, TrackFx } from "../score/model";

const base: TrackFx = { preset: "custom", drive: 0, low: 5, mid: 5, high: 5, comp: 0, chorus: 0, delay: 0, reverb: 0 };
export const FX_PRESETS: { id: string; name: string; fx: TrackFx }[] = [
  { id: "clean", name: "Limpio con brillo", fx: { ...base, preset: "clean", comp: 3, high: 6, reverb: 2 } },
  { id: "crunch", name: "Crunch (classic rock)", fx: { ...base, preset: "crunch", drive: 4, low: 5, mid: 6, high: 5, reverb: 2 } },
  { id: "dist", name: "Distorsión (grunge, hard rock)", fx: { ...base, preset: "dist", drive: 7, low: 6, mid: 4, high: 6, comp: 2, reverb: 2 } },
  { id: "highgain", name: "High gain (metal)", fx: { ...base, preset: "highgain", drive: 9, low: 7, mid: 3, high: 6, comp: 4, reverb: 1 } },
  { id: "fuzz", name: "Fuzz y muro (shoegaze)", fx: { ...base, preset: "fuzz", drive: 10, low: 6, mid: 5, high: 4, chorus: 4, delay: 4, reverb: 8 } },
  { id: "jangle", name: "Jangle (indie, post punk)", fx: { ...base, preset: "jangle", comp: 4, high: 7, chorus: 5, reverb: 3 } },
  { id: "ambient", name: "Ambiente (delay y reverb)", fx: { ...base, preset: "ambient", delay: 6, reverb: 8, high: 6 } },
  { id: "bass", name: "Bajo compacto", fx: { ...base, preset: "bass", drive: 1, low: 6, mid: 5, high: 4, comp: 6 } },
  { id: "drums", name: "Batería con pegada", fx: { ...base, preset: "drums", low: 6, high: 6, comp: 5, reverb: 2 } },
  { id: "keys", name: "Teclados y voces", fx: { ...base, preset: "keys", chorus: 3, reverb: 4 } },
];
export const presetFx = (id: string) => FX_PRESETS.find((p) => p.id === id)?.fx ?? null;
export const FX_SLIDERS: [keyof TrackFx, string][] = [
  ["drive", "Ganancia"], ["low", "Graves"], ["mid", "Medios"], ["high", "Agudos"],
  ["comp", "Compresión"], ["chorus", "Chorus"], ["delay", "Delay"], ["reverb", "Reverb"],
];

// ---------- pedales (Tone.js) ----------
export const PEDALS: { type: PedalType; name: string; a: string; b: string }[] = [
  { type: "phaser", name: "Phaser", a: "Velocidad", b: "Profundidad" },
  { type: "tremolo", name: "Trémolo", a: "Velocidad", b: "Profundidad" },
  { type: "wah", name: "Auto-wah", a: "Tono", b: "Sensibilidad" },
  { type: "autofilter", name: "Filtro barrido", a: "Velocidad", b: "Profundidad" },
  { type: "vibrato", name: "Vibrato", a: "Velocidad", b: "Profundidad" },
  { type: "pingpong", name: "Delay ping-pong", a: "Tiempo", b: "Repeticiones" },
  { type: "octave", name: "Octavador / pitch", a: "Semitonos", b: "Suavidad" },
  { type: "widener", name: "Ensanchador estéreo", a: "Ancho", b: "—" },
  { type: "autopan", name: "Auto-pan", a: "Velocidad", b: "Profundidad" },
  { type: "harmonic", name: "Saturación armónica", a: "Armónicos", b: "—" },
  { type: "spring", name: "Reverb de resorte", a: "Tamaño", b: "—" },
];
export const pedalInfo = (t: PedalType) => PEDALS.find((p) => p.type === t)!;
/** Semitonos del octavador: la perilla A va de −12 a +12 en pasos (5 = sin cambio). */
export const octaveSemis = (a: number) => [-12, -12, -7, -5, -3, 0, 3, 5, 7, 12, 12][Math.round(Math.max(0, Math.min(10, a)))];


// ---------- masterizado ----------
export const MASTER_PRESETS: { id: string; name: string; fx: MasterFx }[] = [
  { id: "natural", name: "Natural (poco proceso)", fx: { preset: "natural", low: 5, mid: 5, high: 5, glue: 2, width: 5, loud: 3 } },
  { id: "rock", name: "Rock / fuerte", fx: { preset: "rock", low: 6, mid: 5, high: 6, glue: 5, width: 6, loud: 6 } },
  { id: "warm", name: "Cálido (boleros, jazz)", fx: { preset: "warm", low: 6, mid: 5, high: 4, glue: 3, width: 5, loud: 4 } },
  { id: "bright", name: "Brillante (pop, indie)", fx: { preset: "bright", low: 5, mid: 4, high: 7, glue: 4, width: 6, loud: 5 } },
  { id: "acoustic", name: "Acústico / suave", fx: { preset: "acoustic", low: 5, mid: 5, high: 6, glue: 2, width: 6, loud: 2 } },
  { id: "loud", name: "Radio (máximo volumen)", fx: { preset: "loud", low: 6, mid: 5, high: 6, glue: 7, width: 6, loud: 9 } },
];
export const MASTER_SLIDERS: [keyof MasterFx, string][] = [
  ["low", "Graves"], ["mid", "Medios"], ["high", "Agudos"], ["glue", "Compresión"], ["width", "Ancho estéreo"], ["loud", "Volumen final"],
];

