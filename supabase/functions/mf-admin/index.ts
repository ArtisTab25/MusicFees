// MusicFees: administración de cuentas. Solo la puede usar un administrador (mf_profiles.is_admin).
// Usa la llave de servicio, que vive en el servidor de Supabase y nunca llega al navegador.
// Acciones: list, create, password, delete. Y «delete-me», que cualquier cuenta usa para borrarse a sí misma.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json({ error: "Entra con tu cuenta primero." }, 401);
    const { data: me } = await admin.from("mf_profiles").select("is_admin").eq("id", who.user.id).maybeSingle();
    const body = await req.json().catch(() => ({}));

    // Borrar mi cuenta (lo pide Google Play): se borran sus canciones, versiones y la cuenta.
    if (body.action === "delete-me") {
      if (me?.is_admin) {
        const { count } = await admin.from("mf_profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
        if ((count ?? 0) <= 1) return json({ error: "Eres el único administrador: nombra a otro antes de borrar tu cuenta." }, 400);
      }
      await admin.from("mf_songs").delete().eq("owner_id", who.user.id);
      const { error } = await admin.auth.admin.deleteUser(who.user.id);
      if (error) throw error;
      return json({ ok: true });
    }
    if (!me?.is_admin) return json({ error: "Solo un administrador puede administrar cuentas." }, 403);

    switch (body.action) {
      case "list": {
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
        if (error) throw error;
        const { data: profiles } = await admin.from("mf_profiles").select("id, display_name, is_admin");
        const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
        return json(data.users.map((u) => ({
          id: u.id, email: u.email ?? "", name: byId.get(u.id)?.display_name ?? "", is_admin: !!byId.get(u.id)?.is_admin,
          created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null, provider: u.app_metadata?.provider ?? "email",
        })).sort((a, b) => a.created_at.localeCompare(b.created_at)));
      }
      case "create": {
        const email = String(body.email ?? "").trim().toLowerCase(), password = String(body.password ?? ""), name = String(body.name ?? "").trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Escribe un correo válido." }, 400);
        if (password.length < 6) return json({ error: "La contraseña necesita al menos 6 caracteres." }, 400);
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { full_name: name } : {} });
        if (error) return json({ error: /already/i.test(error.message) ? "Ya existe una cuenta con ese correo." : error.message }, 400);
        if (body.admin) await admin.from("mf_profiles").update({ is_admin: true }).eq("id", data.user.id);
        return json({ id: data.user.id });
      }
      case "password": {
        const password = String(body.password ?? "");
        if (password.length < 6) return json({ error: "La contraseña necesita al menos 6 caracteres." }, 400);
        const { error } = await admin.auth.admin.updateUserById(String(body.id), { password });
        if (error) throw error;
        return json({ ok: true });
      }
      case "delete": {
        if (body.id === who.user.id) return json({ error: "No puedes borrar tu propia cuenta desde aquí." }, 400);
        const { error } = await admin.auth.admin.deleteUser(String(body.id));
        if (error) throw error;
        return json({ ok: true });
      }
      default: return json({ error: "Acción desconocida." }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? "Error del servidor" }, 500);
  }
});
