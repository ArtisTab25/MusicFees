// Guardado en Supabase + sesión en vivo para el dúo (Realtime broadcast y presencia).
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { ARTIFACT, NO_CLOUD_MSG, PUBLIC_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import type { Op } from "../score/model";
import { delDoc, getDoc, putDoc } from "./vault";

export interface SongRow { id: string; title: string; data: string; version: number; updated_at: string }
export interface Peer { key: string; name: string; color: string; cursor?: { t: number; b: number; i: number; row: number } }

const LOCAL_LIST = "mf:songs";
export const clientId = (() => {
  try {
    let id = localStorage.getItem("mf:client");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("mf:client", id); }
    return id;
  } catch { return crypto.randomUUID(); }
})();

export interface LocalEntry { id: string; title: string; updated: number; cloud: boolean }
export function localList(): LocalEntry[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_LIST) || "[]"); } catch { return []; }
}
function saveLocalList(list: LocalEntry[]) {
  try { localStorage.setItem(LOCAL_LIST, JSON.stringify(list.slice(0, 200))); } catch { /* lleno */ }
}
export function rememberSong(e: LocalEntry) {
  const list = localList().filter((x) => x.id !== e.id);
  list.unshift(e);
  saveLocalList(list);
}
export function forgetSong(id: string) {
  saveLocalList(localList().filter((x) => x.id !== id));
  void delDoc(id);
}
/** Guarda en el dispositivo (IndexedDB). Lanza error si no se pudo. */
export const saveLocalDoc = (id: string, json: string) => putDoc(id, json);
export const loadLocalDoc = (id: string) => getDoc(id);

export interface Session { userId: string; email: string; username: string; isAdmin: boolean; provider: string }
export interface UserRow { id: string; email: string; name: string; is_admin: boolean; created_at: string; last_sign_in_at: string | null; provider: string }

/** Nube: Supabase Auth (correo y contraseña, o Google) y biblioteca por usuario (003_supabase_auth.sql). */
/** Enlace con el que Google regresa a la app de Android (debe estar en Supabase → Redirect URLs). */
export const APP_REDIRECT = "io.github.artistab25.musicfees://auth";
export class Cloud {
  session: Session | null = null;
  sb: SupabaseClient;
  ok = true;
  /** Se resuelve cuando se sabe si hay sesión guardada (o al volver de entrar con Google). */
  ready: Promise<void>;
  onSession: (s: Session | null) => void = () => {};
  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: !ARTIFACT, autoRefreshToken: !ARTIFACT, detectSessionInUrl: !ARTIFACT, flowType: "pkce" } });
    this.ready = ARTIFACT ? Promise.resolve() : this.sb.auth.getSession().then(({ data }) => this.adopt(data.session?.user ?? null)).catch(() => {});
    if (!ARTIFACT) this.sb.auth.onAuthStateChange((_e, sess) => { void this.adopt(sess?.user ?? null).then(() => this.onSession(this.session)); });
  }
  private async adopt(user: { id: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null) {
    if (!user) { this.session = null; return; }
    let isAdmin = false, name = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? (user.email ?? "").split("@")[0]);
    try {
      const { data } = await this.sb.from("mf_profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle();
      if (data) { isAdmin = !!data.is_admin; name = data.display_name || name; }
    } catch { /* sin perfiles todavía */ }
    this.session = { userId: user.id, email: user.email ?? "", username: name, isAdmin, provider: String(user.app_metadata?.provider ?? "email") };
  }
  private explain(e: { message?: string; code?: string } | null): Error {
    const m = e?.message ?? "";
    if (/mf_profiles|owner_id|mf_claim_song|schema cache|does not exist/i.test(m))
      return new Error("La base de datos todavía no tiene las cuentas nuevas. Aplica supabase/migrations/003_supabase_auth.sql en Supabase.");
    if (/Invalid login credentials/i.test(m)) return new Error("Correo o contraseña incorrectos.");
    if (/Email not confirmed/i.test(m)) return new Error("Falta confirmar el correo de esa cuenta.");
    if (/provider is not enabled|Unsupported provider/i.test(m)) return new Error("La entrada con Google todavía no está activada en Supabase (Authentication → Providers → Google).");
    if (/fetch|network|Failed/i.test(m)) return new Error("Sin conexión con la nube. Lo que escribas sigue guardándose en este teléfono.");
    return new Error(m || "Error de la nube");
  }
  async create(title: string, data: string): Promise<string> {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data: id, error } = await this.sb.rpc("mf_create_song", { p_title: title, p_data: data });
    if (error) throw this.explain(error);
    return id as string;
  }
  async get(id: string): Promise<SongRow | null> {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data, error } = await this.sb.rpc("mf_get_song", { p_id: id });
    if (error) throw this.explain(error);
    return (data as SongRow[])[0] ?? null;
  }
  async save(id: string, title: string, data: string): Promise<number> {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data: v, error } = await this.sb.rpc("mf_save_song", { p_id: id, p_title: title, p_data: data });
    if (error) throw this.explain(error);
    return Number(v);
  }
  // ---------- cuentas ----------
  async login(email: string, pass: string) {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password: pass });
    if (error) throw this.explain(error);
    await this.adopt(data.user);
    return this.session!;
  }
  /** Entrar o crear cuenta con Google: sale a Google y vuelve a la app con la sesión. */
  async loginGoogle() {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    if (Capacitor.isNativePlatform()) {
      // En la app de Android: Google se abre en el navegador del sistema y regresa a la app por su
      // enlace propio (APP_SCHEME://auth). Ahí se cambia el código por la sesión.
      const { data, error } = await this.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: APP_REDIRECT, skipBrowserRedirect: true } });
      if (error || !data?.url) throw this.explain(error);
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url, windowName: "_self" });
      return;
    }
    const redirectTo = location.origin + location.pathname;
    const { error } = await this.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) throw this.explain(error);
  }
  /** La app de Android recibió el regreso de Google (o de «olvidé mi contraseña»). */
  async handleAppUrl(url: string): Promise<boolean> {
    if (!url.startsWith(APP_REDIRECT)) return false;
    const u = new URL(url.replace(/#/, "?"));
    const code = u.searchParams.get("code"), err = u.searchParams.get("error_description");
    try { const { Browser } = await import("@capacitor/browser"); await Browser.close(); } catch { /* ya cerrado */ }
    if (err) throw new Error(err);
    if (code) { const { error } = await this.sb.auth.exchangeCodeForSession(code); if (error) throw this.explain(error); }
    return true;
  }
  async resetPassword(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: Capacitor.isNativePlatform() ? PUBLIC_URL : location.origin + location.pathname });
    if (error) throw this.explain(error);
  }
  async logout() { this.session = null; await this.sb.auth.signOut().catch(() => {}); }
  /** Administración (función de servidor mf-admin, solo administradores). */
  private async admin<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.functions.invoke("mf-admin", { body });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      let msg = error.message;
      try { const j = await ctx?.json(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
      if (/not found|404|Failed to send/i.test(msg)) msg = "Falta publicar la función mf-admin en Supabase (supabase/functions/mf-admin).";
      throw new Error(msg);
    }
    return data as T;
  }
  users() { return this.admin<UserRow[]>({ action: "list" }); }
  createUser(email: string, pass: string, name: string, admin = false) { return this.admin<{ id: string }>({ action: "create", email, password: pass, name, admin }); }
  setPassword(id: string, pass: string) { return this.admin<void>({ action: "password", id, password: pass }); }
  deleteUser(id: string) { return this.admin<void>({ action: "delete", id }); }
  /** Borra la cuenta propia con sus canciones de la nube (no se puede deshacer). */
  async deleteMe() { await this.admin<void>({ action: "delete-me" }); await this.logout(); }
  // ---------- mi biblioteca ----------
  /** true cuando la base ya tiene carpetas, etiquetas y versiones (migración 004). */
  has004: boolean | null = null;
  async mySongs(): Promise<{ id: string; title: string; updated_at: string; folder?: string | null; tags?: string[] }[]> {
    const q = (cols: string) => this.sb.from("mf_songs").select(cols).eq("owner_id", this.session?.userId ?? "").order("updated_at", { ascending: false });
    if (this.has004 !== false) {
      const { data, error } = await q("id, title, updated_at, folder, tags");
      if (!error) { this.has004 = true; return data as unknown as { id: string; title: string; updated_at: string; folder: string | null; tags: string[] }[]; }
      if (!/folder|tags|column/i.test(error.message)) throw this.explain(error);
      this.has004 = false;
    }
    const { data, error } = await q("id, title, updated_at");
    if (error) throw this.explain(error);
    return data as unknown as { id: string; title: string; updated_at: string }[];
  }
  /** Carpeta y etiquetas de una canción propia en la nube (si la base ya las tiene). */
  async organize(id: string, folder: string | null, tags: string[]): Promise<boolean> {
    if (!this.session || this.has004 === false) return false;
    const { error } = await this.sb.from("mf_songs").update({ folder, tags }).eq("id", id);
    if (error) { if (/folder|tags|column/i.test(error.message)) this.has004 = false; return false; }
    return true;
  }
  // ---------- versiones en la nube ----------
  async cloudVersions(song: string): Promise<{ id: string; label: string; auto: boolean; created_at: string; title: string; size: number }[]> {
    if (!this.session || this.has004 === false) return [];
    const { data, error } = await this.sb.from("mf_versions").select("id, label, auto, created_at, title, data").eq("song_id", song).order("created_at", { ascending: false }).limit(40);
    if (error) { if (/mf_versions|schema cache|does not exist/i.test(error.message)) this.has004 = false; return []; }
    return (data as { id: string; label: string; auto: boolean; created_at: string; title: string; data: string }[]).map((x) => ({ id: x.id, label: x.label, auto: x.auto, created_at: x.created_at, title: x.title, size: x.data.length }));
  }
  async cloudVersionData(id: string): Promise<string | null> {
    const { data, error } = await this.sb.from("mf_versions").select("data").eq("id", id).maybeSingle();
    return error || !data ? null : (data as { data: string }).data;
  }
  async pushVersion(song: string, title: string, data: string, label: string, auto: boolean): Promise<boolean> {
    if (!this.session || this.has004 === false) return false;
    const { error } = await this.sb.from("mf_versions").insert({ song_id: song, title: title.slice(0, 120), label: label.slice(0, 80), auto, data });
    if (error) { if (/mf_versions|schema cache|does not exist/i.test(error.message)) this.has004 = false; return false; }
    return true;
  }
  async deleteCloudVersion(id: string) { await this.sb.from("mf_versions").delete().eq("id", id); }
  async createMine(title: string, data: string) {
    const { data: row, error } = await this.sb.from("mf_songs").insert({ title: title.slice(0, 120) || "Sin título", data, owner_id: this.session?.userId }).select("id").single();
    if (error) throw this.explain(error);
    return (row as { id: string }).id;
  }
  async claim(id: string) { const { error } = await this.sb.rpc("mf_claim_song", { p_id: id }); if (error) throw this.explain(error); }
  async deleteMine(id: string) { const { error } = await this.sb.from("mf_songs").delete().eq("id", id); if (error) throw this.explain(error); }

  async list(ids: string[]) {
    if (ARTIFACT) throw new Error(NO_CLOUD_MSG);
    if (!ids.length) return [];
    const { data, error } = await this.sb.rpc("mf_list_songs", { p_ids: ids });
    if (error) throw this.explain(error);
    return data as { id: string; title: string; updated_at: string }[];
  }
}

/** Canal en vivo de una canción: operaciones, cursores y presencia del dúo. */
export class LiveSession {
  channel: RealtimeChannel;
  peers: Peer[] = [];
  connected = false;
  onOps: (ops: Op[], from: string) => void = () => {};
  onPeers: (peers: Peer[]) => void = () => {};
  onCursor: (key: string, c: Peer["cursor"]) => void = () => {};
  onSnapshotRequest: (from: string) => void = () => {};
  onSnapshot: (json: string) => void = () => {};
  onReloadHint: () => void = () => {};
  private me: Peer;

  constructor(cloud: Cloud, public songId: string, name: string, color: string) {
    this.me = { key: clientId, name, color };
    this.channel = cloud.sb.channel(`mf-song-${songId}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: clientId } },
    });
    this.channel
      .on("broadcast", { event: "ops" }, ({ payload }) => this.onOps(payload.ops as Op[], payload.from))
      .on("broadcast", { event: "cursor" }, ({ payload }) => this.onCursor(payload.from, payload.c))
      .on("broadcast", { event: "hello" }, ({ payload }) => this.onSnapshotRequest(payload.from))
      .on("broadcast", { event: "snapshot" }, ({ payload }) => { if (payload.to === clientId) this.onSnapshot(payload.json); })
      .on("broadcast", { event: "reload" }, ({ payload }) => { if (!payload.to || payload.to === clientId) this.onReloadHint(); })
      .on("presence", { event: "sync" }, () => {
        const st = this.channel.presenceState<Peer>();
        this.peers = Object.values(st).map((arr) => arr[0]).filter(Boolean);
        this.onPeers(this.peers);
      })
      .subscribe(async (status) => {
        this.connected = status === "SUBSCRIBED";
        if (this.connected) {
          await this.channel.track(this.me);
          this.channel.send({ type: "broadcast", event: "hello", payload: { from: clientId } });
        }
      });
  }
  /** El anfitrión es quien guarda en la base mientras ambos están conectados. */
  get isHost() {
    const keys = this.peers.map((p) => p.key).sort();
    return !keys.length || keys[0] === clientId;
  }
  get others() { return this.peers.filter((p) => p.key !== clientId); }
  sendOps(ops: Op[]) {
    if (!this.connected) return;
    const payload = { ops, from: clientId };
    // Los mensajes grandes (deshacer de canciones largas) van como aviso de recarga.
    if (JSON.stringify(payload).length > 180_000) {
      this.channel.send({ type: "broadcast", event: "reload", payload: {} });
      return;
    }
    this.channel.send({ type: "broadcast", event: "ops", payload });
  }
  sendCursor(c: Peer["cursor"]) {
    if (this.connected) this.channel.send({ type: "broadcast", event: "cursor", payload: { from: clientId, c } });
  }
  sendSnapshot(to: string, json: string) {
    if (!this.connected) return;
    if (json.length > 180_000) this.channel.send({ type: "broadcast", event: "reload", payload: { to } });
    else this.channel.send({ type: "broadcast", event: "snapshot", payload: { to, json } });
  }
  async close() { await this.channel.unsubscribe(); }
}
