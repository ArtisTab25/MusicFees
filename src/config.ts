// Configuración pública. La "anon key" de Supabase está pensada para vivir en el cliente:
// la seguridad la ponen las funciones RPC y las políticas de la base (ver supabase/migrations).
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? "https://kxtjvycttkvunltojdht.supabase.co";
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4dGp2eWN0dGt2dW5sdG9qZGh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODk1OTAsImV4cCI6MjEwODU2NTU5MH0.BD8g28miTh6jdo0axU5GwMA79qoEs_rk6ypRMQXSVwQ";

export const APP_NAME = "MusicFees";
/** Dirección pública de la versión web (los enlaces del dúo apuntan aquí también desde la app Android). */
export const PUBLIC_URL = "https://artistab25.github.io/MusicFees/";
/** Versión que corre como artefacto de Claude: sin red externa (sin nube ni dúo). */
export const ARTIFACT = import.meta.env.VITE_TARGET === "artifact";
// Los artefactos solo sirven extensiones conocidas: ahí el banco viaja como .sf3.ogg (es Ogg por dentro).
export const SOUNDFONT_URL = `${import.meta.env.BASE_URL}soundfont/GeneralUser-GS.sf3${ARTIFACT ? ".ogg" : ""}`;
export const NO_CLOUD_MSG = "La nube y el dúo en vivo no funcionan dentro del artefacto de Claude. Usa la versión publicada en GitHub Pages.";
