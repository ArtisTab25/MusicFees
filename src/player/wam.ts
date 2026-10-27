// Plugins de terceros con el estándar Web Audio Modules 2.0 (WAM). Cada plugin es un módulo
// JavaScript que se importa en tiempo de ejecución y crea un nodo de audio dentro de nuestro
// contexto, con su propia interfaz. Los WAM necesitan un contexto de audio nativo.
import { initializeWamHost } from "@webaudiomodules/sdk";
import type { PluginRef } from "../score/model";
import { Capacitor } from "@capacitor/core";
import { ARTIFACT, PUBLIC_URL } from "../config";

export type PluginCat = "Distorsión y amplis" | "Dinámica" | "Modulación" | "Filtros y EQ" | "Delay" | "Reverb" | "Afinación";
export interface CatalogPlugin { src: string; name: string; cat: PluginCat; note: string; by: string; license: string; mb?: number }

const C = "wam/community/wimmics/";
/** Biblioteca de plugins probados con MusicFees (carga, sonido en vivo, ventana y exportación).
 *  Los tres primeros viven en el repositorio; los de «wam/community» se copian al compilar desde
 *  el paquete wam-community (scripts/wam.mjs). Licencias: public/wam/NOTICE.txt. */
const ALL_PLUGINS: CatalogPlugin[] = [
  { src: "wam/distortion/index.js", name: "Simple Distortion", cat: "Distorsión y amplis", note: "Distorsión por curva, con nivel y sabor", by: "Burns Audio", license: "MIT" },
  { src: "wam/simpleEQ/index.js", name: "Simple EQ", cat: "Filtros y EQ", note: "Ecualizador de 3 bandas con frecuencias ajustables", by: "Burns Audio", license: "MIT" },
  { src: "wam/delay/index.js", name: "Delay", cat: "Delay", note: "Delay estéreo con filtros y ping-pong", by: "Burns Audio", license: "MIT" },
  { src: `${C}BigMuff/index.js`, name: "Big Muff", cat: "Distorsión y amplis", note: "Fuzz clásico de pedal", by: "Guitarix / M. Buffa", license: "GPL (Guitarix)" },
  { src: `${C}TS9_Overdrive/index.js`, name: "TS9 Overdrive", cat: "Distorsión y amplis", note: "Overdrive tipo Tube Screamer", by: "Guitarix / M. Buffa", license: "LGPL" },
  { src: `${C}OverdriveRix/index.js`, name: "Overdriverix", cat: "Distorsión y amplis", note: "Overdrive con mezcla seco/efecto", by: "Guitarix / M. Buffa", license: "GPL (Guitarix)" },
  { src: `${C}OscTube/index.js`, name: "OSCTube", cat: "Distorsión y amplis", note: "Fuzz de bulbo con vibrato y resonancia", by: "Guitarix / M. Buffa", license: "GPL (Guitarix)" },
  { src: `${C}Kpp_fuzz/index.js`, name: "KppFuzz", cat: "Distorsión y amplis", note: "Fuzz vintage", by: "Oleg Kapitonov / M. Buffa", license: "GPL-3.0" },
  { src: `${C}kppdistorder/index.js`, name: "KppDistorder", cat: "Distorsión y amplis", note: "Distorsión con ecualizador (sale bajito: sube su volumen)", by: "Oleg Kapitonov / M. Buffa", license: "GPL-3.0" },
  { src: `${C}quadrafuzz/dist/index.js`, name: "QuadraFuzz", cat: "Distorsión y amplis", note: "Fuzz en 4 bandas", by: "M. Buffa", license: "ver origen" },
  { src: `${C}temper/index.js`, name: "Temper", cat: "Distorsión y amplis", note: "Distorsión digital moderna con filtro resonante", by: "Creative Intent / M. Buffa", license: "ver origen" },
  { src: `${C}GuitarAmpSim60s/index.js`, name: "Vox Amp 30", cat: "Distorsión y amplis", note: "Simulador de ampli de bulbos tipo AC30", by: "Guitarix / M. Buffa", license: "GPL (Guitarix)" },
  { src: `${C}disto_machine/src/index.js`, name: "DistoMachine", cat: "Distorsión y amplis", note: "Ampli de bulbos tipo JCM 800 con gabinete y reverb", by: "M. Buffa, J. Lebrun", license: "ver origen", mb: 10 },
  { src: `${C}deathgate/index.js`, name: "DeathGate", cat: "Dinámica", note: "Puerta de ruido multibanda para guitarras distorsionadas", by: "Oleg Kapitonov / M. Buffa", license: "GPL-3.0" },
  { src: `${C}stonephaser/index.js`, name: "StonePhaser", cat: "Modulación", note: "Phaser analógico tipo Small Stone", by: "J. P. Cimalando", license: "CC0 / BSL-1.0" },
  { src: `${C}WeirdPhaser/index.js`, name: "WeirdPhaser", cat: "Modulación", note: "Phaser estéreo", by: "Oli Larkin", license: "ver origen" },
  { src: `${C}ThruZeroFlanger/index.js`, name: "ThruZeroFlanger", cat: "Modulación", note: "Flanger de cruce por cero", by: "Oli Larkin", license: "ver origen" },
  { src: `${C}StereoEnhancer/index.js`, name: "Stereo Enhancer", cat: "Modulación", note: "Ensancha la imagen estéreo", by: "M. Buffa", license: "ver origen" },
  { src: `${C}sweetWah/index.js`, name: "SweetWah", cat: "Filtros y EQ", note: "Auto-wah con modulación", by: "M. Buffa", license: "ver origen" },
  { src: `${C}graphicEqualizer/index.js`, name: "GraphicEqualizer", cat: "Filtros y EQ", note: "Ecualizador gráfico: arrastra los puntos", by: "M. Buffa", license: "ver origen" },
  { src: `${C}blipper/index.js`, name: "Blipper", cat: "Filtros y EQ", note: "Seguidor de envolvente que mueve el tono", by: "Oli Larkin", license: "ver origen" },
  { src: `${C}pingpongdelay/dist/index.js`, name: "PingPongDelay", cat: "Delay", note: "Delay ping-pong clásico", by: "M. Buffa", license: "ver origen" },
  { src: `${C}SmoothDelay/index.js`, name: "SmoothDelay", cat: "Delay", note: "Delay que no hace clics al cambiar el tiempo", by: "Yann Orlarey", license: "STK-4.3" },
  { src: `${C}greyhole/index.js`, name: "Grey Hole", cat: "Reverb", note: "Reverb enorme tipo Blackhole", by: "Julian Parker", license: "GPL-2.0+" },
  { src: `${C}kbverb/index.js`, name: "KBVerb", cat: "Reverb", note: "Reverb inspirada en Keith Barr", by: "Corey Kereliuk", license: "MIT" },
  { src: `${C}OwlDirty/index.js`, name: "OwlDirty", cat: "Reverb", note: "Reverb ambiental con distorsión en la cola", by: "Xavier Godart", license: "ver origen" },
  { src: `${C}OwlShimmer/index.js`, name: "OWLShimmer", cat: "Reverb", note: "Reverb ambiental con shimmer", by: "Xavier Godart", license: "ver origen" },
  { src: "wam/community/burns-audio/reverb/index.js", name: "Microverb", cat: "Reverb", note: "Reverb de convolución con respuestas de equipos clásicos", by: "Burns Audio", license: "MIT", mb: 18 },
  { src: `${C}DualPitchShifter/index.js`, name: "DualPitchShifter", cat: "Afinación", note: "Dos transpositores de tono", by: "Oli Larkin", license: "ver origen" },
  { src: `${C}StereoFreqShifter/index.js`, name: "StereoFreqShifter", cat: "Afinación", note: "Desplazador de frecuencia estéreo", by: "Oli Larkin", license: "ver origen" },
];
/** En el artefacto de Claude no van los dos más pesados (límite de archivos; ver scripts/build-artifact.mjs). */
export const WAM_CATALOG = ARTIFACT ? ALL_PLUGINS.filter((p) => !p.mb) : ALL_PLUGINS;
export const PLUGIN_CATS: PluginCat[] = ["Distorsión y amplis", "Dinámica", "Modulación", "Filtros y EQ", "Delay", "Reverb", "Afinación"];

export interface WamInstance {
  audioNode: AudioNode & { getState(): Promise<unknown>; setState(s: unknown): Promise<void>; destroy?(): void };
  createGui(): Promise<HTMLElement>;
  destroyGui?(gui: HTMLElement): void;
}

const hosts = new WeakMap<BaseAudioContext, Promise<string>>();
function host(ctx: BaseAudioContext) {
  let h = hosts.get(ctx);
  if (!h) { h = initializeWamHost(ctx).then(([groupId]) => groupId); hosts.set(ctx, h); }
  return h;
}
/** Dirección absoluta del módulo. Los del catálogo se sirven junto a la app; la APK no trae los
 *  de la comunidad y los toma del sitio publicado (GitHub Pages permite cargarlos desde otra app). */
export function pluginUrl(src: string) {
  if (/^https?:\/\//.test(src)) return src;
  if (src.startsWith("wam/community/") && Capacitor.isNativePlatform()) return PUBLIC_URL + src;
  return new URL(`${import.meta.env.BASE_URL}${src}`, location.href).href;
}
/** Dirección pública para copiar y usar en cualquier anfitrión WAM 2.0. */
export const publicPluginUrl = (src: string) => (/^https?:\/\//.test(src) ? src : PUBLIC_URL + src);

export async function createPlugin(ctx: BaseAudioContext, ref: PluginRef): Promise<WamInstance> {
  const groupId = await host(ctx);
  const mod = await import(/* @vite-ignore */ pluginUrl(ref.src));
  const WAM = mod.default;
  if (!WAM?.createInstance) throw new Error(`«${ref.name}» no es un plugin WAM 2.0.`);
  const inst = (await WAM.createInstance(groupId, ctx)) as WamInstance;
  if (ref.state) await inst.audioNode.setState(ref.state);
  return inst;
}
/** Lee el nombre del plugin de su descriptor (para plugins agregados por dirección). */
export async function pluginName(src: string): Promise<string> {
  try {
    const r = await fetch(pluginUrl(src).replace(/index\.js$/, "descriptor.json"));
    if (r.ok) { const d = await r.json(); if (d?.name) return String(d.name); }
  } catch { /* sin descriptor */ }
  return src.split("/").slice(-2, -1)[0] || "Plugin";
}
