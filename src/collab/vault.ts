// Historial de versiones y papelera, guardados en este dispositivo (IndexedDB: cabe mucho más que en
// localStorage). Las versiones se toman solas cada 10 minutos de edición, o cuando el usuario pide.
// La papelera guarda la canción completa durante 30 días antes de borrarla de verdad.

const DB = "musicfees", STORE_V = "versions", STORE_T = "trash", STORE_D = "docs";
const KEEP_VERSIONS = 20, AUTO_EVERY = 10 * 60_000, TRASH_DAYS = 30;

export interface Version { id: string; song: string; t: number; title: string; label: string; auto: boolean; json: string }
export interface TrashItem { id: string; song: string; t: number; title: string; cloud: boolean; json: string }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(STORE_V)) d.createObjectStore(STORE_V, { keyPath: "id" }).createIndex("song", "song");
      if (!d.objectStoreNames.contains(STORE_T)) d.createObjectStore(STORE_T, { keyPath: "id" });
      if (!d.objectStoreNames.contains(STORE_D)) d.createObjectStore(STORE_D, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? (req.result as T) : undefined);
    t.onerror = () => rej(t.error);
  }));
}

// ---------- versiones ----------
export async function versions(song: string): Promise<Version[]> {
  const all = (await tx<Version[]>(STORE_V, "readonly", (s) => s.index("song").getAll(song))) ?? [];
  return all.sort((a, b) => b.t - a.t);
}
export async function addVersion(song: string, title: string, json: string, label = "", auto = false) {
  const list = await versions(song);
  if (auto && list.length && (Date.now() - list[0].t < AUTO_EVERY || list[0].json === json)) return false;
  const v: Version = { id: crypto.randomUUID(), song, t: Date.now(), title, label, auto, json };
  await tx(STORE_V, "readwrite", (s) => { s.put(v); });
  // Guarda las 20 más recientes (las que tienen nombre no se borran solas).
  const old = [v, ...list].filter((x) => x.auto).slice(KEEP_VERSIONS);
  if (old.length) await tx(STORE_V, "readwrite", (s) => { for (const o of old) s.delete(o.id); });
  return true;
}
export const deleteVersion = (id: string) => tx(STORE_V, "readwrite", (s) => { s.delete(id); });

// ---------- papelera ----------
export async function trash(item: Omit<TrashItem, "id" | "t">) {
  await tx(STORE_T, "readwrite", (s) => { s.put({ ...item, id: crypto.randomUUID(), t: Date.now() }); });
}
export async function trashList(): Promise<TrashItem[]> {
  const all = (await tx<TrashItem[]>(STORE_T, "readonly", (s) => s.getAll())) ?? [];
  const limit = Date.now() - TRASH_DAYS * 86_400_000;
  const expired = all.filter((x) => x.t < limit);
  if (expired.length) await tx(STORE_T, "readwrite", (s) => { for (const x of expired) s.delete(x.id); });
  return all.filter((x) => x.t >= limit).sort((a, b) => b.t - a.t);
}
export const deleteTrash = (id: string) => tx(STORE_T, "readwrite", (s) => { s.delete(id); });

// ---------- cambios que aún no llegan a la nube ----------
const PENDING = "mf:pending";
function pendingMap(): Record<string, number> { try { return JSON.parse(localStorage.getItem(PENDING) || "{}"); } catch { return {}; } }
function writePending(m: Record<string, number>) { try { localStorage.setItem(PENDING, JSON.stringify(m)); } catch { /* lleno */ } }
export function markPending(song: string) { const m = pendingMap(); m[song] = Date.now(); writePending(m); }
export function clearPending(song: string) { const m = pendingMap(); delete m[song]; writePending(m); }
export const pendingSince = (song: string): number | null => pendingMap()[song] ?? null;

// ---------- carpetas y etiquetas de la biblioteca ----------
// Se guardan en el dispositivo para todas las canciones; las de la nube también se guardan en la
// base (cuando ya tiene la migración 004), así se ven igual en el teléfono y en la computadora.
export interface LibMeta { folder?: string | null; tags?: string[] }
const META = "mf:libmeta";
function metaAll(): Record<string, LibMeta> { try { return JSON.parse(localStorage.getItem(META) || "{}"); } catch { return {}; } }
export const libMeta = (id: string): LibMeta => metaAll()[id] ?? {};
export function setLibMeta(id: string, m: LibMeta) {
  const all = metaAll();
  const clean: LibMeta = { folder: m.folder?.trim().slice(0, 80) || null, tags: [...new Set((m.tags ?? []).map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 12) };
  if (!clean.folder && !clean.tags?.length) delete all[id]; else all[id] = clean;
  try { localStorage.setItem(META, JSON.stringify(all)); } catch { /* lleno */ }
  return clean;
}
/** Texto «Carpeta, etiqueta1, etiqueta2» → partes. */
export const parseTags = (s: string) => s.split(/[,#]/).map((x) => x.trim()).filter(Boolean);

// ---------- canciones guardadas en el dispositivo ----------
// Antes iban en localStorage, que solo admite ~5 MB en total: con canciones de 10 pistas se llenaba y
// el guardado fallaba en silencio. Ahora van en IndexedDB (cientos de MB) y comprimidas con gzip
// (una canción de Guitar Pro ocupa ~10 veces menos).
interface DocRow { id: string; t: number; gz: boolean; data: Blob | string }
const canGzip = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}
async function gunzip(b: Blob): Promise<string> {
  return new Response(b.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}
const LS_DOC = (id: string) => `mf:doc:${id}`;
const memo = new Map<string, string>(); // última versión de cada canción (lecturas rápidas)
/** Guarda la canción en el dispositivo. Lanza un error si no se pudo (para avisar de verdad). */
export async function putDoc(id: string, json: string): Promise<void> {
  memo.set(id, json);
  const row: DocRow = { id, t: Date.now(), gz: canGzip, data: canGzip ? await gzip(json) : json };
  await tx(STORE_D, "readwrite", (s) => { s.put(row); });
  try { localStorage.removeItem(LS_DOC(id)); } catch { /* nada */ }
}
export async function getDoc(id: string): Promise<string | null> {
  const m = memo.get(id);
  if (m) return m;
  try {
    const row = await tx<DocRow>(STORE_D, "readonly", (s) => s.get(id));
    if (row) { const json = row.gz ? await gunzip(row.data as Blob) : (row.data as string); memo.set(id, json); return json; }
  } catch { /* sin IndexedDB */ }
  // Canciones guardadas por versiones anteriores: se pasan a IndexedDB al leerlas.
  let old: string | null = null;
  try { old = localStorage.getItem(LS_DOC(id)); } catch { /* nada */ }
  if (old) void putDoc(id, old).catch(() => {});
  return old;
}
export async function delDoc(id: string) {
  memo.delete(id);
  try { localStorage.removeItem(LS_DOC(id)); } catch { /* nada */ }
  await tx(STORE_D, "readwrite", (s) => { s.delete(id); }).catch(() => {});
}
/** Espacio usado y disponible en el dispositivo (MB), si el navegador lo informa. */
export async function storageInfo(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate(); return e ? { used: (e.usage ?? 0) / 1048576, quota: (e.quota ?? 0) / 1048576 } : null; } catch { return null; }
}
