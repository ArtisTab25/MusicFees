// Biblioteca dentro del artefacto de Claude: guarda en la base del artefacto, en la parte privada
// de cada persona (data/users/<id>/…), con su cuenta de Claude. Nadie más ve esas canciones.
// Los documentos admiten 256 KiB: la canción va comprimida (gzip) y partida en trozos.
type Snap = { exists: boolean; id: string; data(): Record<string, unknown> | undefined };
type DocRef = { get(): Promise<Snap>; set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void>; collection(p: string): ColRef };
type ColRef = { doc(id?: string): DocRef; orderBy(f: string, d?: "asc" | "desc"): { get(): Promise<{ docs: Snap[] }> } };
type DB = { doc(p: string): DocRef };
type Claude = { use(n: string): Promise<unknown> };

export interface LibEntry { id: string; title: string; updated: number }
const CHUNK = 180_000;

async function gzip(text: string): Promise<string> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzip(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(s).text();
}

export class ClaudeLibrary {
  private root: DocRef | null = null;
  ready: Promise<boolean>;
  constructor() {
    this.ready = (async () => {
      const claude = (window as unknown as { claude?: Claude }).claude;
      if (!claude?.use) return false;
      const [db, user] = (await Promise.all([claude.use("db"), claude.use("user")])) as [DB | null, { id(): Promise<string | null> } | null];
      const uid = db && user ? await user.id() : null;
      if (!db || !uid) return false;
      this.root = db.doc(`data/users/${uid}/library`);
      return true;
    })().catch(() => false);
  }
  private songs() { if (!this.root) throw new Error("La biblioteca necesita tu cuenta de Claude."); return this.root.collection("songs"); }
  async list(): Promise<LibEntry[]> {
    if (!(await this.ready)) return [];
    const q = await this.songs().orderBy("updated", "desc").get();
    return q.docs.map((d) => { const x = d.data()!; return { id: d.id, title: String(x.title ?? "Sin título"), updated: Number(x.updated ?? 0) }; });
  }
  async load(id: string): Promise<string | null> {
    if (!(await this.ready)) return null;
    const head = await this.songs().doc(id).get();
    if (!head.exists) return null;
    const n = Number(head.data()!.parts ?? 0);
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => this.songs().doc(id).collection("chunks").doc(String(i)).get()));
    return gunzip(parts.map((p) => String(p.data()?.b ?? "")).join(""));
  }
  async save(id: string, title: string, json: string) {
    if (!(await this.ready)) throw new Error("La biblioteca necesita tu cuenta de Claude.");
    const b64 = await gzip(json);
    const ref = this.songs().doc(id);
    const n = Math.max(1, Math.ceil(b64.length / CHUNK));
    const prev = await ref.get();
    const old = prev.exists ? Number(prev.data()!.parts ?? 0) : 0;
    // Primero los trozos, luego el encabezado: una lectura a medias nunca ve partes de más.
    for (let i = 0; i < n; i++) await ref.collection("chunks").doc(String(i)).set({ b: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
    await ref.set({ title: title || "Sin título", updated: Date.now(), parts: n, size: json.length });
    for (let i = n; i < old; i++) await ref.collection("chunks").doc(String(i)).delete();
  }
  async create(title: string, json: string): Promise<string> {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    await this.save(id, title, json);
    return id;
  }
  async remove(id: string) {
    if (!(await this.ready)) return;
    const ref = this.songs().doc(id);
    const head = await ref.get();
    const n = head.exists ? Number(head.data()!.parts ?? 0) : 0;
    await ref.delete();
    for (let i = 0; i < n; i++) await ref.collection("chunks").doc(String(i)).delete();
  }
}
