# MusicFees

Tablaturas y partituras multipista, al estilo Guitar Pro, pensadas para el teléfono, con sonido real y edición en dúo en vivo.

**Versión 1.1** · web (funciona en el navegador del teléfono y se puede instalar como app).

## Qué hace

- **Partitura y tablatura profesional** con [alphaTab](https://alphatab.net): duraciones de redonda a semifusa, puntillos, tresillos, ligaduras, repeticiones, casillas, secciones, cambios de compás, tempo y armadura.
- **Multipista**: 74 instrumentos y kits (guitarras, bajos, requinto, bajo sexto, vihuela, guitarrón, teclados, cuerdas, vientos, sintes, batería estándar, de jazz, electrónica, TR-808 y percusión latina), con afinaciones y capo.
- **22 plantillas por estilo**: classic rock, hard rock, post punk, grunge, shoegaze, indie, math rock, jazz, bossa nova, funk, disco, pop de los 80, pop actual, house, techno, hip hop, bolero, corrido clásico, corrido tumbado, mariachi, oldies y barroco.
- **Sonido**: dos bancos a elegir en menú → Sonido → Banco de sonidos: **MuseScore General** (38 MB, el predeterminado, mucho más realista) y **GeneralUser GS** (8 MB, ligero). Mezclador por pista (volumen, paneo, silencio y solo), metrónomo, cuenta inicial, bucle y velocidad.
- **Teclado propio en pantalla** (predeterminado en el celular): trastes 0–9, avanzar, retroceder, siguiente compás, borrar, silencio, deshacer y duraciones. También se puede escribir con el teclado del teléfono o con uno físico; ver la tabla de atajos abajo.
- **Paletas tipo Guitar Pro** sobre el teclado: compás, nota y dinámica, efectos y texto.
- **Selección, copiar, cortar, pegar y transponer**: tiempos sueltos o compases completos, también de guitarra a piano o entre canciones (las notas conservan su altura real y se reacomodan en las cuerdas del destino). Transponer ±½ tono u octava en la selección o en toda la pista.
- **Biblioteca de acordes** con posiciones calculadas para guitarra y voicings para teclados.
- **Letra** bajo las notas, por sílabas.
- **Exportar**: Guitar Pro (.gp), MIDI, PDF, MP3 y WAV (mezcla completa o un archivo por pista).
- **Importar**: Guitar Pro 3 a 8 (.gp3, .gp4, .gp5, .gpx, .gp) y MusicXML.
- **Dúo en vivo**: comparte un enlace y edita la misma hoja al mismo tiempo. Se ve el cursor de la otra persona y sus cambios aparecen al instante.

## Cuentas y biblioteca (0.4)

1. En Supabase → SQL Editor, ejecuta una vez `supabase/migrations/002_cuentas.sql` (después de 001).
2. Abre la app: la primera vez pide **crear la cuenta de administrador**.
3. Menú → Archivo → Biblioteca → **Usuarios**: crea las cuentas (por ejemplo `USUARIO 1` / `12345`). Desde ahí también se cambian contraseñas y se borran cuentas.
4. Cada cuenta ve sus canciones en cualquier dispositivo. «Usar sin cuenta» guarda solo en el dispositivo. Los enlaces del dúo siguen funcionando sin cuenta.

Las cuentas son propias de MusicFees (usuario y contraseña, sin correo); las contraseñas se guardan con bcrypt y las tablas solo se tocan a través de funciones.

En el artefacto de Claude la biblioteca usa la cuenta de Claude de cada persona (no hay contraseñas).

## Tempo

El botón **♩ = …** de la barra de reproducción (siempre visible) abre el editor de tempo: «Desde aquí» (desde el tiempo del cursor), «Solo este compás» (después vuelve el anterior), «Tempo inicial», cambio gradual (accelerando o ritardando repartido tiempo por tiempo hasta el compás que digas), tap tempo y la lista de cambios de la canción. También está en la paleta de compás y en menú → Sonido → Tempo.

## Motor de estudio: efectos, pedales y masterizado

Menú → Sonido → Activar efectos (o Masterizado). Usa spessasynth (Apache-2.0) para sonar con salida separada por canal y **Tone.js** (MIT) para las cadenas:

- **Por pista** (Sets → Pista → Efectos): amplificador con distorsión y gabinete, EQ de 3 bandas, compresor, chorus, delay y reverb, con presets por género, más hasta **4 pedales** en serie: phaser, trémolo, auto-wah, filtro barrido, vibrato, delay ping-pong, octavador/pitch, ensanchador estéreo, auto-pan, saturación armónica y reverb de resorte.
- **Masterizado** (menú → Sonido → Masterizado): EQ, compresión «pegamento», ancho estéreo, volumen final, limitador y recorte suave con techo de −0.8 dB, con medidor de nivel y presets (natural, rock, cálido, brillante, acústico, radio).
- **Exportar MP3/WAV con efectos y masterizado**: cada pista se procesa por su cadena fuera de tiempo real y la mezcla pasa por el master. Tarda más que la exportación en seco.

- **Plugins de terceros (WAM 2.0)**: hasta 3 por pista (Sets → Pista → Efectos → Plugins). **Biblioteca de plugins** (Biblioteca → Plugins de efectos, o el botón junto a los plugins de la pista): 30 plugins probados en MusicFees, por categoría (distorsión y amplis, dinámica, modulación, filtros y EQ, delay, reverb, afinación), cada uno con su dirección pública para copiarla y usarla aquí o en cualquier anfitrión WAM 2.0, y un botón para agregarlo a la pista actual. Tres viven en el repositorio (burns-audio, MIT); los otros 27 se copian al compilar desde el paquete npm `wam-community` 0.4.9 (`scripts/wam.mjs`, que además corrige una carpeta que le falta al paquete). La APK no los trae: los carga del sitio publicado la primera vez (necesita internet). En el artefacto de Claude van 25 (sin DistoMachine ni Microverb, por el límite de archivos). Autores y licencias en `public/wam/NOTICE.txt`: varios son GPL (Guitarix, Kapitonov), revísalo si algún día la app se distribuye con licencia cerrada. También se puede cargar cualquier otro WAM 2.0 por URL (su servidor debe permitir CORS).
- **Metrónomo y cuenta inicial** funcionan con el motor de estudio, siguiendo los cambios de tempo y compás y las repeticiones. Al exportar, el metrónomo se suma limpio después del masterizado (no pasa por los efectos).

Todo se guarda con la canción.

## Versión 1.1

- **Guardar**: botón visible (✓ Guardado / 💾 Guardar / ⚠) y Ctrl + S. Las canciones del dispositivo ahora van en IndexedDB comprimidas; antes, en localStorage (~5 MB en total), las canciones grandes fallaban al guardarse sin avisar.
- **Inicio**: menú principal fuera de la hoja (continuar, mis canciones, nueva, importar, preferencias, ayuda, avisos, cuenta). Cerrar sesión saca de la canción y regresa al ingreso.
- **Voces 1–4**: cada voz es una «hoja» encimada en la misma pista. La que editas se ve normal y las demás en gris; los botones marcan con un punto las que tienen notas, y en una voz vacía el cursor aparece al inicio del compás.
- **Cualquier sonido en cualquier pista**: una tablatura de bajo puede sonar a piano (los 128 sonidos del banco); lo escrito no cambia.
- **Cambios dentro de la pista**: desde cualquier compás, otro sonido u otra cadena de efectos (Sets → «Cambios desde el compás»). Se ven como etiquetas en la partitura, suenan en el motor de estudio y se respetan al exportar.
- **Congelar pistas** (Tracks → Fluidez): cada pista se procesa una vez con sus efectos y se toca como audio. Medido con 10 pistas de RelaF con cadenas completas: hilo de audio de 42 % a 3 % de un núcleo. Congelar tarda (unos 30 s por pista pesada en computadora; varios minutos en un teléfono). Editar una pista congelada la regresa a sonar en vivo.
- **Avisos legales completos** (`src/legal.json` → app, `legal.html` y `privacidad.html`) y aceptación la primera vez.

## Versión 1.0 (fases 3, 7, 8 y 9)

- **Zoom con pellizco** en la partitura (Ctrl + rueda en computadora): lo que está bajo los dedos se queda en su lugar. Botón **▶** para desplegar todas las herramientas en el teléfono.
- **Pistas**: fusionar dos pistas (cada una en su voz), separar voces en pistas, dividir por altura (graves en clave de Fa) y exportar solo una pista.
- **Exportar una parte**: toda la canción, una pista o unos compases/una sección (Secciones → Exportar).
- **Biblioteca**: búsqueda, carpetas y etiquetas (🏷 en cada canción).
- **Comentarios por compás** (💬) que siguen a su compás y se ven como globitos sobre la partitura.
- **Modo propuesta** (Menú → Dúo → Propuestas): editar sin guardar ni mandar al dúo, enviar la propuesta, y aplicarla o rechazarla.
- **Versiones en la nube**: las de nombre siempre y una automática por hora (requiere la migración 004).
- **Accesibilidad**: botones grandes, alto contraste, menos movimiento, foco visible, lo activo marcado también con forma, ventanas con Esc/Tab y atajos de teclado completos (F1).
- **Lanzamiento**: pantalla de licencias, privacidad y términos (también en `privacidad.html`), «Borrar mi cuenta», entrar con Google dentro del APK y paquete `.aab` para Google Play.

### Pendiente de configurar (una vez)

1. Supabase → SQL Editor: ejecuta `supabase/migrations/004_biblioteca_y_versiones.sql` (carpetas, etiquetas y versiones en la nube; sin ella todo eso funciona solo en el dispositivo).
2. Supabase → Authentication → URL Configuration → Redirect URLs: agrega `io.github.artistab25.musicfees://auth` (regreso de Google al APK).
3. Google Play: crea tu llave de subida privada (`keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`) y guárdala en GitHub → Settings → Secrets → Actions como `MF_UPLOAD_KEYSTORE_B64` (el archivo en base64), `MF_UPLOAD_PASSWORD` y `MF_UPLOAD_ALIAS`. Sin ellos, el `.aab` sale firmado con la llave pública del repositorio y sirve solo para probar.
4. Ficha de Play: política de privacidad `https://artistab25.github.io/MusicFees/privacidad.html`.

## Novedades 0.10 (fases 4 a 6)

- **Escritura activa**: Repetir el tiempo anterior, Completar el compás, diapasón táctil (también para zurdos), patrones de rasgueo (pop, balada, cumbia, corrido, vals, reggae, funk…) e instrumento MIDI por USB/Bluetooth.
- **Secciones** (Menú → Sección → Secciones de la canción): ir a cada parte, tocarla en bucle, seleccionarla, duplicarla, moverla antes o después, renombrarla o borrarla, siempre en todas las pistas y con deshacer.
- **Obra completa** desde la barra de selección: doble tiempo, mitad de tiempo, cambio de métrica en un rango (reacomoda las notas: parte y liga lo que cruza la barra, agrega o quita compases) y técnica aplicada a toda la selección (palm mute, staccato, acentos, ligados…).
- **Bucle** de la selección o de una sección, en el sonido básico y en el motor de estudio.
- **Modo ahorro** (Vista → Preferencias): audio ligero, sin animar el cursor ni resaltar notas mientras suena, desplazamiento por página.
- Correcciones: los compases nuevos traen las mismas voces que sus vecinos (las canciones de Guitar Pro tienen hasta 4 y alphaTab fallaba al dibujar); se descarta el mapa de posiciones viejo si se edita mientras se dibuja; «compases» bien escrito.

## Novedades 0.9

- **Baterías**: el kit elegido (cuarto, power, jazz, escobillas, electrónica, 808) ahora suena; alphaTab forzaba siempre el estándar. Teclado de batería agrupado por pieza.
- **Audio fluido con efectos**: filtros nativos, chorus y delay compartidos, pedales de modulación a ritmo de control, efectos internos del sintetizador apagados y calidad ligera automática en teléfonos (Vista → Preferencias). Hilo de audio con todos los efectos en 4 pistas: 41 % → ~22 % de un núcleo de computadora.
- **Cuentas** con Supabase Auth: correo y contraseña, Google (web) y administración de cuentas para administradores (función `mf-admin`). Requiere aplicar `supabase/migrations/003_supabase_auth.sql` y activar Google en Supabase (ver abajo).
- **Guardado**: indicador (● Sin guardar / ✓ Guardado), guardado al salir de la app, recuperación de cambios que no subieron a la nube, versiones automáticas cada 10 min (Archivo → Versiones) y papelera de 30 días.
- **Menú de pista** (mantén presionada una pista o toca ⋯): duplicar con o sin notas, transponer, cambiar afinación conservando el sonido, capo, color, bloquear, mover y copiar a otra canción.

### Activar cuentas y Google

1. Supabase → SQL Editor: ejecuta `supabase/migrations/003_supabase_auth.sql` (te hace administrador a axel@musicfees.app).
2. Supabase → Authentication → URL Configuration: Site URL `https://artistab25.github.io/MusicFees/` y agrégala también en Redirect URLs.
3. Google Cloud Console → APIs y servicios → Pantalla de consentimiento (Externa) → Credenciales → ID de cliente OAuth (Aplicación web) con URI de redirección `https://kxtjvycttkvunltojdht.supabase.co/auth/v1/callback`.
4. Supabase → Authentication → Sign In / Providers → Google: activa y pega el ID y el secreto.

## Rendimiento (0.8)

Medido con Chromium en computadora (un teléfono es de 3 a 5 veces más lento):

| Situación | 0.7 | 0.8 |
| --- | --- | --- |
| Motor de estudio en pausa | 38 % de un núcleo | 3 % |
| Motor de estudio tocando | 55 % | 28 % |
| Tecla a partitura dibujada (CPU frenada 4×) | ~820 ms | ~350 ms |

- En pausa el audio del motor de estudio se suspende a los 3 s (antes seguía calculando todos los efectos en silencio).
- Se cierra el contexto de audio que Tone.js crea al importarse y que quedaba corriendo.
- Cada pista solo procesa las etapas de efectos que usa; sin masterizar no se procesan EQ, compresor ni ancho.
- La canción se pasa a JSON una vez por estado, en un momento libre (antes, 2 o 3 veces por tecla). Al escribir seguido, esos cambios se deshacen juntos.
- Se redibuja desde el renglón del compás editado.
- Los plugins de una pista se cargan en fila (antes podían duplicarse).
- Arreglos: lo escrito no sonaba hasta reabrir la canción (alphaTab solo regenera el MIDI si cambia la canción; ahora se regenera al darle play). Los efectos guardados no llegaban al motor tras editar o deshacer. Los plugins tienen controles propios con deslizadores grandes para el dedo.

## Bancos de sonido y APK

- GeneralUser GS viene incluido y carga en segundos.
- MuseScore General (38 MB) se descarga desde menú → Sonido → Banco de sonidos y queda guardado en el dispositivo.
- La APK no lo incluye: se compila con `MF_APK=1` y la app lo descarga del sitio publicado.
- **La Action que descomprime el zip no puede tocar `.github/`.** Para compilar la APK en GitHub, crea a mano `.github/workflows/android.yml` (Add file → Create new file) con el contenido de ese archivo en este proyecto. Cada compilación queda en Releases → «apk».

## Artefacto de Claude

`npm run build:artifact` arma `dist-artifact/` (MuseScore en tres partes de menos de 15 MB, archivos binarios con extensión .ogg) y `dist-artifact/files.json` con el mapa para publicar.

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
| Mayús + ← → / Mayús + clic | Seleccionar tiempos (en el celular: mantener el dedo sobre un tiempo, o ⬚ en el teclado) |
| Ctrl + C / X / V | Copiar, cortar (deja silencios) y pegar; funciona entre pistas y entre canciones |
| Ctrl + A | Seleccionar toda la pista |
| Esc | Quitar la selección |

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

alphaTab (MPL-2.0) · Bravura (SIL OFL 1.1) · GeneralUser GS v1.471 de S. Christian Collins (uso libre, incluso comercial; ver `public/soundfont/GeneralUser-GS-LICENSE.txt`) · supabase-js (MIT) · jsPDF (MIT) · lamejs (LGPL-3.0) · Tone.js (MIT) · spessasynth_lib (Apache-2.0) · @webaudiomodules/sdk (MIT) · plugins WAM de burns-audio (MIT).
