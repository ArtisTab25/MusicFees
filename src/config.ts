// Configuración pública. La "anon key" de Supabase está pensada para vivir en el cliente:
// la seguridad la ponen las funciones RPC y las políticas de la base (ver supabase/migrations).
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? "https://kxtjvycttkvunltojdht.supabase.co";
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4dGp2eWN0dGt2dW5sdG9qZGh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODk1OTAsImV4cCI6MjEwODU2NTU5MH0.BD8g28miTh6jdo0axU5GwMA79qoEs_rk6ypRMQXSVwQ";

export const SOUNDFONT_URL = `${import.meta.env.BASE_URL}soundfont/GeneralUser-GS.sf3`;
export const APP_NAME = "MusicFees";
