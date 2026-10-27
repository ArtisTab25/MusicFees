// Copia los plugins WAM 2.0 de la comunidad (paquete npm wam-community) a public/wam/community
// antes de compilar. No viven en el repositorio (pesan ~45 MB): se instalan con `npm ci`.
//
// Corrige un detalle del paquete 0.4.9: sdk-parammgr importa ./sdk/src/…, que no viene en el
// paquete; se copia utils/sdk ahí. Sin esto los plugins de Wimmics no cargan.
//
// Con MF_APK=1 no copia nada: la APK carga estos plugins desde el sitio publicado.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMUNITY_DIRS } from "./wam-list.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "node_modules", "wam-community", "dist", "plugins");
const OUT = join(ROOT, "public", "wam", "community");
const log = (m) => console.log(`[plugins] ${m}`);

if (process.env.MF_APK) log("Compilación para Android: los plugins de la comunidad se cargan desde el sitio publicado.");
else if (!existsSync(SRC)) log("Falta wam-community (corre npm install). Se compila sin los plugins de la comunidad.");
else {
  rmSync(OUT, { recursive: true, force: true });
  for (const d of ["wimmics/utils", ...COMMUNITY_DIRS]) cpSync(join(SRC, d), join(OUT, d), { recursive: true });
  cpSync(join(SRC, "wimmics/utils/sdk"), join(OUT, "wimmics/utils/sdk-parammgr/src/sdk"), { recursive: true });
  log(`${COMMUNITY_DIRS.length} plugins copiados a public/wam/community.`);
}
