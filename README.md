# MusicFees

Tablaturas y partituras multipista, al estilo Guitar Pro, pensadas para el teléfono, con sonido real y edición en dúo en vivo.

**Versión 1.3** · web (funciona en el navegador del teléfono y se puede instalar como app).

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

## Versión 1.3.8: modelo de notas afinado con tus partituras y tablaturas desde PDF

- **Reconocedor de notas afinado para guitarra, piano y «lo demás» separados.** Las capas finales de Basic Pitch (decisión de nota y de ataque, 9 003 parámetros) se entrenaron con las pistas separadas de 39 obras de Brayand y sus partituras, ancladas a los pesos originales. Medido en las 9 obras que el modelo no vio (dos ventanas): notas acertadas 33,1 → 34,2 % y 32,3 → 34,2 %, duración correcta 47,7 → 52,8 % y 42,6 → 47,3 %, notas largas partidas 70 → 56 % y 71 → 55 %. Costo: más notas repetidas juntadas (14 → 26 % y 14 → 21 %) y raíz de acordes −1,3 / +0,2. Bajo, batería, voz y «Rápida» siguen con el modelo original (en la mezcla el afinado empeora, así que no se usa ahí). Pesa 0,7 MB más.
- **Importar tablaturas en PDF** (Importar archivo → .pdf): en los PDF exportados por un programa (Guitar Pro, MuseScore, TuxGuitar…) los números de la tablatura son texto, así que se leen exactos con pdf.js, sin reconocimiento de imagen: cuerdas, trastes, compases, acordes, ligaduras y notas muertas. Medido con PDFs generados desde 8 obras: 85–100 % de lo leído es correcto y se encuentra el 79–99 %. El ritmo se estima por el espaciado y queda aproximado. Los escaneos y fotos todavía no.
- **Alineación fina del corpus:** las partituras se ajustan al audio nota por nota (ataques escritos sobre un ataque real 38 → 64 %). Con la regla corregida, la misma app mide bajo 34,9 → 51,1 % y notas 28,3 → 37,0 % en las 39 obras: buena parte del error que se culpaba al transcriptor era desfase de la medición.
- Medido y **no publicado:** segundo entrenamiento de Demucs con Slakh (igual que el original en 39 obras reales); afinar todo Basic Pitch y no solo las capas finales (mejor en la validación por cuadros, peor en la transcripción completa: notas 33 → 29 %).

## Versión 1.3.7: pistas importadas con varios instrumentos y corpus de medición más grande

- **«Trae varios»** en las pistas ya separadas (Moises, BandLab, UVR…) y la opción «Varios instrumentos mezclados»: varias guitarras o teclados se reparten en pistas (ritmo/punteo, acordes/melodía); voz con coros o mezclas se reparten por timbre; de una pista mezclada solo se toma el instrumento que no vino aparte. Medido (piano dentro de «lo demás»): sin la casilla el teclado desaparecía; con ella vuelve como pista propia con la misma calidad de notas que si viniera separado (33,6 % contra 32,9 %).
- **Corpus de Brayand alineado:** 49 pares partitura–audio (de 51 .gp y 61 audios), con un mapa tiempo-partitura → tiempo-audio por DTW (croma y ataques), así las obras con otro tempo (Answer ×0,94, erer ×1,04…), con final distinto o que cubren solo una parte no se descartan. 39 obras nuevas entran al evaluador.
- **Validación de la 1.3.6 en las 39 obras nuevas:** la sensibilidad 0,7× en fuentes separadas no empeora nada y mejora lo sostenido (notas largas partidas 71 → 62 %, duración correcta 46,6 → 50,7 %).
- Medido y **no activado** (no gana todavía): técnicas de guitarra por curva de afinación (bends, vibrato, slides, ligados, palm mute), unión de notas sostenidas por energía, ajustes del reconocedor de acordes (±1 punto contra los acordes escritos).

## Versión 1.3.6: Fiel con menos notas de más y pulso con red neuronal (opcional)

- **Fiel escribe menos notas fantasma.** Sobre las fuentes separadas, el modelo de notas oía también los restos de la separación y escribía notas de más; por eso «Rápida» a veces sonaba más limpia aunque acierta mucho menos (bajo 38 % contra 71 %, notas en la pista correcta 6 % contra 80 %). Ahora la sensibilidad sobre fuentes separadas es 0,7 × la elegida, y lo que se coló de una fuente a otra (misma nota, mismo momento) queda solo donde suena más fuerte. Medido con las partituras de Brayand: notas acertadas 33,6 → 35,5 % y 29,4 → 31,8 % (fragmentos no vistos), reparto 79,9 → 81,0 % y 75,0 → 75,9 %.
- **Pulso y compás con Beat This!** (CPJKU, MIT; casilla «experimental» en Calidad, descarga 41 MB una vez). Marca mejor los pulsos (+2 y +6 puntos), pero en canciones no vistas pone peor el inicio del compás (−10) y en shuffle cuenta 1,5 veces el tempo. Por eso no está activado de fábrica. El espectrograma que necesita lo calcula MusicFees (igual al original con diferencia de 0,00004) y los pesos van en float16 (41 MB en vez de 82, mismo resultado).
- **Kit de entrenamiento** más robusto: solo canciones completas de Slakh y sin caerse por pistas más cortas que la mezcla.

## Versión 1.3.5: separación más rápida, varios núcleos, sin internet y kit para entrenar

- **Ya no se queda en «Preparando la separación en 6 fuentes»**: Demucs separa en trozos de 3,9 s (antes 7,8 s), que gastan la mitad de memoria (≈1,6 GB en vez de 2,9 GB) con la misma calidad medida en las partituras de Brayand. Los teléfonos usan Demucs solo si declaran 6 GB de memoria o más; si la separación deja de avanzar 3 minutos, la app cambia sola a MDX-Net y lo recuerda.
- **Varios núcleos**: un service worker activa el aislamiento del navegador (COOP/COEP), que permite que el separador use hasta 6 núcleos (todos menos uno). Medido en esta computadora de 2 núcleos con 24 s de audio: Fiel 202 s con 1 núcleo → 133 s con 2.
- **Fiel (rápida)**: la misma separación en 6 fuentes con menos solapamiento entre trozos y la batería de Demucs (sin el segundo separador): 76 s para los mismos 24 s, 29 MB menos de descarga. Lee un poco peor el hi-hat y la caja.
- **Sin internet**: tras la primera visita y la primera descarga de modelos, la app abre y transcribe fuera de línea.
- **Kit para entrenar el separador con Slakh2100** (CC BY 4.0) en Kaggle gratis: `scripts/train/` (ver su README). Probado solo con datos de prueba; los pesos actuales siguen siendo los originales de Demucs hasta que unos entrenados demuestren mejora con partituras reales.

## Versión 1.3.4: dile qué instrumentos hay, usa pistas ya separadas y cambia cualquier pista de instrumento

- **Qué instrumentos tiene la grabación** (Transcribir audio, opcional): voz, batería y bajo (sí/no), cuántas guitarras (0–3), teclados (0–2) y vientos, cuerdas o sinte con melodía (0–3). No se inventan partes que no existen y las notas se reparten entre las pistas indicadas: con 2 guitarras sale «Guitarra 1 (ritmo)» y «Guitarra 2 (punteo)»; con 3, el ritmo se divide en grave y agudo. Medido con las partituras de Brayand (indicación tomada de cada .gp): notas en la pista correcta 77 → 80 % y, en fragmentos no vistos, 68 → 75 %.
- **¿Ya tienes las pistas separadas?** Sube las de Moises, BandLab Splitter, Ultimate Vocal Remover u otra app (voz, batería, bajo, guitarra, piano, lo demás; el tipo se adivina por el nombre del archivo y se puede corregir). MusicFees transcribe cada una con su papel, sin volver a separar: 20 s de 4 pistas en 12 s.
- **Cambiar instrumento** (mantén presionada la pista): cualquier pista a cualquier instrumento, aunque sea de otro tipo — una guitarra a piano para oírla y leerla como teclado, o un piano o una voz a guitarra o bajo para verla en tablatura. Las notas se conservan; al pasar a cuerdas se elige la afinación que mejor acomoda la parte, lo que no cabe se mueve de octava y la digitación sale del algoritmo del transcriptor. Opción para conservar el sonido y solo cambiar cómo se escribe. En Sets → Pista, las pistas sin tablatura tienen «Ver en tablatura de guitarra» y «De bajo».
- **Tablatura de texto**: la batería, con el número General MIDI de cada pieza en cada golpe (36 bombo, 38 caja, 42 hi-hat…); piano, voz y demás como tab de teclado (letras por octava). Se puede copiar o bajar como .txt.

## Versión 1.3.3: separación en 6 fuentes (guitarra y piano aparte)

- **Modo «Fiel» con Demucs v4** (`htdemucs_6s`, Meta, MIT): voz, bajo, guitarra, piano y lo demás salen de Demucs; la batería, del modelo MDX-Net (lee mejor bombo, caja y hi-hat). Las notas de guitarra salen de la pista de guitarra y las de teclado de la de piano, en vez de adivinarse por timbre; de «lo demás» queda la línea principal (vientos, cuerdas, sinte).
- Medido con las partituras de Brayand (promedio de 9 canciones; en paréntesis, fragmentos que no se usaron para ajustar): notas en la pista del instrumento correcto 66 → 77 % (64 → 68 %), bajo 69 → 71 % (62 → 65 %); batería igual; notas de guitarras y teclados encimados igual (~30–35 %).
- La red se exporta a ONNX sin la STFT (`scripts/export-demucs.py`, desde el paquete oficial de PyPI y el checkpoint oficial comprobado por su huella); la STFT, la ISTFT y los trozos con solape están en `src/transcribe/demucs.ts` (igual a PyTorch: 60 dB). Los pesos se bajan en float16 (55 MB, los mismos del checkpoint) y se pasan a float32 en el dispositivo. GitHub Actions lo exporta antes de compilar.
- Descarga: ~109 MB una vez (antes ~106). Necesita ~2,8 GB de memoria en el pico (el doble que MDX-Net): se usa en computadoras y en teléfonos que informan 6 GB o más; en los demás sigue la separación con los tres modelos MDX-Net. Es ~20 % más lenta.

## Versión 1.3.2: importar MIDI (mitad en la computadora, mitad en la app)

- **Transcribir audio → «¿Ya tienes un MIDI?»**: importa un .mid hecho en otro lado — por ejemplo con [NeuralNote](https://github.com/DamRsn/NeuralNote) v2 en tu computadora, que es gratis y usa MuScriptor, el modelo abierto de transcripción más preciso hoy (pesos CC BY-NC 4.0: uso no comercial, en tu equipo). MusicFees pone cada pista del MIDI con su instrumento (por su programa General MIDI y su nombre), en tablatura con la digitación más cómoda, con tonalidad, acordes, secciones y análisis. Si el MIDI no trae un tempo que coincida con las notas (lo normal al transcribir sin cuantizar), el pulso se calcula con los ataques; si lo trae, se respeta también su compás (3/4, 6/8).
- Cada parte guarda su propio nombre e instrumento (antes, dos partes del mismo papel compartían instrumento).
- Probado: separador de 6 fuentes Demucs v4 `htdemucs_6s` (MIT, 55 MB; guitarra y piano aparte) contra las partituras de Brayand. En fragmentos no vistos: bajo 62 → 67 %, notas en la pista correcta 64 → 67 % (77 % en los fragmentos de calibración), pero hi-hat 59 → 51 % y caja 63 → 57 %, y las notas polifónicas igual (~30 %). El código para usarlo ya está en el transcriptor (`stems.guitar`/`stems.keys`); falta llevar el modelo al navegador (ONNX, como hace demucs.onnx) para activarlo.

## Versión 1.3.1: calibrada con partituras reales

Medido nota por nota contra 10 canciones de Brayand (cada .gp con su mp3 exportado), en fragmentos de 90 s y, para comprobar que no se ajustó de más, en otros fragmentos de 60 s que no se usaron para calibrar (tolerancia de 50 ms y la altura exacta):

| Medida (promedio de 9 canciones) | 1.3 | 1.3.1 | 1.3.1 en fragmentos no vistos |
|---|---|---|---|
| Bajo (F) | 23 % | 69 % | 62 % (1.3: 22 %) |
| Notas en la pista del instrumento correcto | 44 % | 66 % | 64 % (1.3: 40 %) |
| Tempo correcto | 89 % | 100 % | 89 % |
| Bombo / caja / hi-hat (F) | 88 / 76 / 66 % | 89 / 74 / 66 % | 78 / 63 / 59 % |
| Raíz del acorde | 72 % | 72 % | 65 % |

- **Bajo:** nuevo seguidor en dos capas. Los ataques se buscan con ventanas cortas y en la banda aguda (el clic de la púa), y también donde la vibración se vuelve periódica otra vez al pulsar de nuevo la cuerda: así ya no se funden las notas repetidas y las notas empiezan donde suenan (antes llegaban ~80 ms tarde). La altura sale de YIN con un umbral estricto y la mediana de cada nota.
- **Guitarra contra teclado:** se suma el brillo (los teclados medidos suenan más redondos: armónicos agudos 0,12 contra 0,43 en guitarras) y el teclado necesita evidencia clara; antes la mitad de las guitarras caían en «Teclado».
- **Tempo al doble:** si la caja cae siempre en el mismo tiempo de cada cuatro, el pulso real es la mitad (salvo ritmos a medio tiempo muy lentos).
- **Compás:** con batería y bajo separados también se mira qué se repite cada 3 o cada 4 tiempos.
- Límites que siguen: el ride casi siempre sale como hi-hat; las notas de guitarras y teclados encimados aciertan ~35 %; vientos y cuerdas (sax, trompeta, violín) caen en la pista de guitarra; el 3/4 de «Monet» sale en 4/4.

## Versión 1.3: transcripción «Fiel» con separación de fuentes

- **Calidad «Fiel»** (predeterminada en Transcribir audio): antes de transcribir, la mezcla se separa en **voz, batería, bajo y lo demás** con los modelos MDX-Net de KUIELab (Music Demixing Challenge 2021, MIT; versión ONNX de Ultimate Vocal Remover), ejecutados en el dispositivo con **ONNX Runtime Web** (WebGPU si el navegador lo tiene; si no, WebAssembly). Los modelos (~106 MB con el motor) se bajan una vez y quedan guardados. «Rápida» sigue disponible.
  - Cada fuente se transcribe por separado: la **voz** como línea de una sola nota (solo donde realmente se canta), el **bajo** igual, y **lo demás** se reparte entre **línea principal** (solo, riff, melodía de sinte), **guitarra** y **teclado** según el timbre (cómo se apaga la nota, brillo, ataque) y si el acorde se puede tocar en una guitarra. Cada parte sugiere su instrumento (eléctrica limpia, overdrive o distorsión; piano, Rhodes, órgano o pad).
  - **Batería pieza por pieza** sobre la batería separada: bombo, caja, **toms** (de piso, medio y agudo, agrupados por su altura), hi-hat cerrado y abierto, **crash** y **ride**.
  - **Acordes** con la guitarra/teclado y el bajo ya separados (mucho más limpios), escritos **en todas las pistas**, con diagrama en las guitarras de afinación estándar.
  - **Rejilla rítmica por pista**: corcheas, semicorcheas o tresillos según lo que toca cada instrumento (los acordes ya no se llenan de semicorcheas por imprecisiones de milisegundos).
  - **Digitación**: se queda en una posición de la mano y evita trastes altos sueltos.
- Pruebas con las pistas propias de Brayand (separadas y analizadas) y 26 pruebas automáticas.
- Tiempo: la separación es lo más pesado. En una computadora, unos 18 s por cada 12 s de audio y por modelo con WebAssembly; en el teléfono, más. Para canciones completas en el celular conviene un fragmento (30–60 s) o la calidad «Rápida».

## Versión 1.2: transcripción, análisis y menú por módulos

- **Transcribir audio** (Inicio o menú → Análisis y transcripción): una canción, una pista o una grabación del micrófono se convierte en una canción de MusicFees con una pista por parte (melodía, acordes, bajo y batería), cada una con su instrumento, en tablatura y partitura. Incluye tempo, compás, tonalidad (armadura), acordes con diagrama, secciones con nombre (Intro, Verso, Coro, Puente…) y un análisis guardado con la canción. Los compases dudosos quedan marcados con 💬. Todo se procesa en el dispositivo; el audio no se sube.
  - Notas: modelo **Basic Pitch** de Spotify (Apache-2.0) con TensorFlow.js en un worker, acelerado con **WebAssembly SIMD** (~10× más rápido que JavaScript puro; medido 3 s contra 33 s para 20 s de audio en computadora). WebGL y CPU quedan de respaldo.
  - **Algoritmos propios** (`src/transcribe/`): tempo por autocorrelación con preferencia por tempos comunes y tiempos por programación dinámica; compás (3 o 4) y primer tiempo fuerte por acentos (bajo, cambios de armonía y golpe); batería por separación armónico/percusiva (filtros de mediana) y clasificación de cada golpe por bandas; quita armónicos fantasma y saltos de octava; reparte bajo, melodía y acordes; tonalidad con perfiles de Krumhansl-Kessler; acordes con plantillas + bajo + tonalidad suavizados con Viterbi (cambian sobre todo al inicio del compás) e inversiones; limpieza de la pista de acordes guiada por la armonía; estructura por autosimilitud y novedad ajustada a frases de 4 compases; cuantización por tiempo (semicorcheas o tresillos, lo que mejor encaje); **digitación óptima por Viterbi** (apertura de mano, saltos, cuerdas al aire) y elección de afinación (Drop D, Re, Drop C) cuando hay notas graves.
  - Para el teléfono: recorte por segundos (un fragmento tarda mucho menos) y sensibilidad ajustable.
- **Analizar esta canción**: tonalidad, acordes con su grado (I, vi, IV, V…), forma y **contrapunto** entre dos pistas (movimiento contrario/oblicuo/directo/paralelo, quintas y octavas paralelas, disonancias en tiempo fuerte y su resolución). Puede escribir los acordes (con diagrama en guitarra), marcar las secciones, poner la armadura y guardar el análisis con la canción. Sirve también con tus archivos de Guitar Pro.
- **Menú por módulos**: Archivo, Componer, Estructura, Pistas, Sonido y estudio, Análisis y transcripción, Colaborar, Vista y ayuda. Están todas las funciones de antes, agrupadas.
- **Renovación visual**: superficies con profundidad, radios y espacios consistentes, tarjetas de módulo, reportes legibles. Alto contraste y botones grandes siguen funcionando.
- **Fluidez**: el transcriptor y TensorFlow.js se cargan solo al usarlos (el arranque no creció); la franja de cuerdas/teclas ya no se reconstruye en cada tecla si no cambió.
- **Android**: permiso de micrófono para grabar. **Avisos legales 1.2**: audio procesado en el dispositivo, transcripciones y derechos de autor, licencia del modelo (se vuelven a aceptar una vez).

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
- `src/transcribe/`: transcriptor y análisis musical. Todo es puro (sin DOM) salvo `build.ts` y `ui.ts`; el trabajo pesado corre en `worker.ts`. Pruebas en `tests/transcribe.test.ts`.
- `src/export/exporters.ts`: GP7 (`Gp7Exporter`), MIDI, PDF (render en canvas paginado entre sistemas) y audio (`exportAudio` de alphaTab + LAME).

## Licencias de terceros

Basic Pitch de Spotify (Apache-2.0, `public/models/basic-pitch`) · TensorFlow.js (Apache-2.0) · MDX-Net de KUIELab (MIT; se descargan al compilar con `scripts/models.mjs`) · ONNX Runtime Web (MIT) · alphaTab (MPL-2.0) · Bravura (SIL OFL 1.1) · GeneralUser GS v1.471 de S. Christian Collins (uso libre, incluso comercial; ver `public/soundfont/GeneralUser-GS-LICENSE.txt`) · supabase-js (MIT) · jsPDF (MIT) · lamejs (LGPL-3.0) · Tone.js (MIT) · spessasynth_lib (Apache-2.0) · @webaudiomodules/sdk (MIT) · plugins WAM de burns-audio (MIT).
