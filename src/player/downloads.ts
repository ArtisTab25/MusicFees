// Paquetes descargables (bancos de sonido, efectos): se bajan una vez con barra de progreso
// y se guardan en el dispositivo. Así la APK y la web arrancan rápido con lo mínimo.
import { Capacitor } from "@capacitor/core";
import { ARTIFACT, PUBLIC_URL } from "../config";

export interface Pack {
  id: string;
  name: string;
  mb: number;
  note: string;
  /** Archivos en el servidor (relativos a la app). Varios = partes que se unen (el artefacto limita el tamaño). */
  files: string[];
  /** Cambia cuando el contenido cambia, para no usar una copia vieja. */
  rev: number;
}

const CACHE = "mf-packs-v1";
const key = (p: Pack) => `https://musicfees.local/pack/${p.id}/${p.rev}`;

/** Dónde se baja: la app Android lo pide al sitio publicado; la web y el artefacto, a su propio servidor. */
function urlOf(file: string) {
  if (Capacitor.isNativePlatform()) return `${PUBLIC_URL}${file}`;
  return `${import.meta.env.BASE_URL}${file}`;
}

// ---------- almacenamiento: Cache Storage, si no IndexedDB, si no solo en memoria ----------
const memory = new Map<string, Uint8Array>();
function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("mf-packs", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function store(k: string, bytes: Uint8Array) {
  memory.set(k, bytes);
  try { const c = await caches.open(CACHE); await c.put(k, new Response(bytes as BlobPart)); return; } catch { /* sin Cache Storage */ }
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => { const tx = db.transaction("files", "readwrite"); tx.objectStore("files").put(bytes, k); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}
async function read(k: string): Promise<Uint8Array | null> {
  if (memory.has(k)) return memory.get(k)!;
  try { const c = await caches.open(CACHE); const r = await c.match(k); if (r) { const b = new Uint8Array(await r.arrayBuffer()); memory.set(k, b); return b; } } catch { /* sigue */ }
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => {
    const tx = db.transaction("files", "readonly");
    const g = tx.objectStore("files").get(k);
    g.onsuccess = () => { const b = g.result as Uint8Array | undefined; if (b) memory.set(k, b); res(b ?? null); };
    g.onerror = () => res(null);
  });
}
async function drop(k: string) {
  memory.delete(k);
  try { const c = await caches.open(CACHE); await c.delete(k); } catch { /* nada */ }
  const db = await idb();
  if (db) db.transaction("files", "readwrite").objectStore("files").delete(k);
}

export const getPack = (p: Pack) => read(key(p));
export const removePack = (p: Pack) => drop(key(p));
export async function hasPack(p: Pack) { return !!(await read(key(p))); }

const inflight = new Map<string, Promise<Uint8Array>>();
/** Descarga (o devuelve la copia guardada). `onProgress` recibe 0–100. */
export function downloadPack(p: Pack, onProgress: (pct: number) => void): Promise<Uint8Array> {
  const k = key(p);
  if (inflight.has(k)) return inflight.get(k)!;
  const job = (async () => {
    const saved = await read(k);
    if (saved) { onProgress(100); return saved; }
    const total = p.mb * 1048576;
    let got = 0;
    const parts: Uint8Array[] = [];
    for (const f of p.files) {
      const r = await fetch(urlOf(f));
      if (!r.ok || !r.body) throw new Error(`No se pudo descargar ${p.name} (${r.status}). Revisa tu conexión.`);
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        onProgress(Math.min(99, Math.round((got / total) * 100)));
      }
    }
    const bytes = new Uint8Array(got);
    let o = 0;
    for (const x of parts) { bytes.set(x, o); o += x.length; }
    await store(k, bytes);
    onProgress(100);
    return bytes;
  })();
  inflight.set(k, job);
  job.finally(() => inflight.delete(k));
  return job;
}

// ---------- catálogo ----------
// En el artefacto el banco va partido en archivos de menos de 15 MB (límite de Claude) con extensión .ogg.
const msFiles = ARTIFACT
  ? ["soundfont/ms/part1.ogg", "soundfont/ms/part2.ogg", "soundfont/ms/part3.ogg"]
  : ["soundfont/MuseScore_General.sf3"];
export const MUSESCORE: Pack = { id: "ms", name: "MuseScore General", mb: 38, rev: 2, files: msFiles, note: "Más realista: piano, cuerdas, vientos y baterías. Se descarga una vez." };
