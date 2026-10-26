# MusicFees

Tablaturas y partituras multipista, al estilo Guitar Pro, pensadas para el teléfono, con sonido real y edición en dúo en vivo.

**Versión 0.2** · web (funciona en el navegador del teléfono y se puede instalar como app).

## Qué hace

- **Partitura y tablatura profesional** con [alphaTab](https://alphatab.net): duraciones de redonda a semifusa, puntillos, tresillos, ligaduras, repeticiones, casillas, secciones, cambios de compás, tempo y armadura.
- **Multipista**: 74 instrumentos y kits (guitarras, bajos, requinto, bajo sexto, vihuela, guitarrón, teclados, cuerdas, vientos, sintes, batería estándar, de jazz, electrónica, TR-808 y percusión latina), con afinaciones y capo.
- **22 plantillas por estilo**: classic rock, hard rock, post punk, grunge, shoegaze, indie, math rock, jazz, bossa nova, funk, disco, pop de los 80, pop actual, house, techno, hip hop, bolero, corrido clásico, corrido tumbado, mariachi, oldies y barroco.
- **Sonido**: dos bancos a elegir en menú → Sonido → Banco de sonidos: **MuseScore General** (38 MB, el predeterminado, mucho más realista) y **GeneralUser GS** (8 MB, ligero). Mezclador por pista (volumen, paneo, silencio y solo), metrónomo, cuenta inicial, bucle y velocidad.
- **Teclado propio en pantalla** (predeterminado en el celular): trastes 0–9, avanzar, retroceder, siguiente compás, borrar, silencio, deshacer y duraciones. También se puede escribir con el teclado del teléfono o con uno físico; ver la tabla de atajos abajo.
- **Paletas tipo Guitar Pro** sobre el teclado: compás, nota y dinámica, efectos y texto.
- **Biblioteca de acordes** con posiciones calculadas para guitarra y voicings para teclados.
- **Letra** bajo las notas, por sílabas.
- **Exportar**: Guitar Pro (.gp), MIDI, PDF, MP3 y WAV (mezcla completa o un archivo por pista).
- **Importar**: Guitar Pro 3 a 8 (.gp3, .gp4, .gp5, .gpx, .gp) y MusicXML.
- **Dúo en vivo**: comparte un enlace y edita la misma hoja al mismo tiempo. Se ve el cursor de la otra persona y sus cambios aparecen al instante.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| 0 – 9 | Traste en la cuerda elegida (dos dígitos seguidos = 10 a 24) |
| Espacio | Siguiente tiempo (lo crea si el compás tiene lugar) |
| Borrar ⌫ | Quita la nota; si el tiempo está vacío, lo elimina |
| Enter | Siguiente compás |
| Z | Silencio |
| K / J | Cuerda más aguda / más grave |
| R B N C S F | Redonda, blanca, negra, corchea, semicorchea, fusa |
| `.` / `,` | Puntillo / tresillo |
| `+` / `-` | Dinámica más fuerte / más suave desde ese punto |
| `<` / `>` | Crescendo / decrescendo |
| A / ! | Acento / acento fuerte |
| H D E V | Ligado, deslizar, bend, vibrato |
| P L X G | Palm mute, dejar sonar, nota muerta, nota fantasma |
| T M I U | Tapping, armónico, staccato, ligadura con la nota anterior |

En las pistas de teclado se toca la franja de piano y los números 1 2 4 8 6 3 cambian la duración. En las de batería se tocan las piezas del kit.

## Poner en marcha

```bash
npm install
npm run dev      # servidor local
npm test         # pruebas del modelo (plantillas, edición, exportación)
npm run build    # versión de producción en dist/ (antes descarga y adapta MuseScore_General)
```

### Bancos de sonido

`npm run build` corre primero `scripts/soundfonts.mjs`. MuseScore_General pesa ~40 MB y GitHub no deja subir archivos de más de 25 MB desde el navegador, así que no vive en el repositorio: el script lo descarga del servidor oficial de MuseScore (`ftp.osuosl.org`), lo adapta a alphaTab y escribe `public/soundfont/banks.json`. Si la descarga falla, la app se publica igual, solo con GeneralUser GS.

La adaptación corrige cuatro cosas que en alphaTab dejaban el piano mudo o casi mudo: pares estéreo (alphaTab solo toca mono), la atenuación al estilo FluidSynth (40 %), los moduladores de velocidad que abren el filtro del piano y la atenuación de zonas globales, que alphaTab suma. Para probar con un archivo propio: `node scripts/soundfonts.mjs ruta/MuseScore_General.sf3`.

### Base de datos (una sola vez)

1. Abre tu proyecto en [Supabase](https://supabase.com/dashboard) → **SQL Editor** → **New query**.
2. Pega el contenido de `supabase/migrations/001_musicfees.sql` y pulsa **Run**.

Sin este paso la app funciona igual, pero guarda solo en el teléfono y no hay dúo en vivo.

La URL y la *anon key* van en `src/config.ts`; también se pueden pasar como `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La anon key es pública por diseño. La tabla no se puede leer directamente: todo pasa por funciones que piden el id exacto de la canción.

### Publicar

Al hacer push a `main`, el workflow `.github/workflows/pages.yml` prueba, compila y publica en GitHub Pages. Actívalo una vez en **Settings → Pages → Source: GitHub Actions**.

## Arquitectura

- `src/score/model.ts`: el modelo es el `Score` de alphaTab. Cada cambio es una operación serializable (`Op`), que se aplica igual en el teléfono propio y en el del dúo.
- `src/editor/`: el cursor, el historial (deshacer y rehacer) y la entrada de teclado. En Android se lee lo que inserta el teclado en un campo oculto con un texto centinela, porque `keydown` llega como "Unidentified".
- `src/collab/cloud.ts`: Supabase RPC para guardar, y Realtime (broadcast y presencia) para las operaciones y los cursores. Mientras los dos están conectados, guarda en la base el "anfitrión".
- `src/export/exporters.ts`: GP7 (`Gp7Exporter`), MIDI, PDF (render en canvas paginado entre sistemas) y audio (`exportAudio` de alphaTab + LAME).

## Licencias de terceros

alphaTab (MPL-2.0) · Bravura (SIL OFL 1.1) · GeneralUser GS v1.471 de S. Christian Collins (uso libre, incluso comercial; ver `public/soundfont/GeneralUser-GS-LICENSE.txt`) · supabase-js (MIT) · jsPDF (MIT) · lamejs (LGPL-3.0).
