# Corpus de medición (partituras + audios de Brayand)

Herramientas para emparejar cada .gp con su audio y llevar la partitura al tiempo del audio, aunque el audio
tenga otro tempo, otro final o cubra solo una parte (no se descarta ninguna obra). Los datos no van en el repositorio.

1. `node tests/_ref.mjs <obra.gp> ref/<obra>.json` — notas, acordes escritos y técnicas de la partitura.
2. `python3 -I align.py ref/<obra>.json <audio> align/<obra>.json` — mapa partitura → audio (DTW con croma y ataques,
   10 cuadros/s; subsecuencia si uno es mucho más corto). Da el parecido contra el azar y el tempo por tramos.
3. `python3 -I run_align.py` — todas las obras contra sus audios candidatos (por nombre o por duración).
3b. `python3 -I refine.py ref/<obra>.json align/<obra>.json align/fine/<obra>.json` — afina el mapa hasta el ataque
   (rectas locales robustas + desfase por ventanas sobre la envolvente de ataques a 5 ms). 4 nov 2026: ataques escritos
   que caen sobre un ataque del audio 38 % → 64 %; con eso el evaluador da bajo 34,9 → 51,1 y notas 28,3 → 37,0 en las
   39 obras (misma app: era error de la regla, no del transcriptor).
4. `python3 -I prep_clips.py corpus.json <ev> clip3` — fragmentos de 60 s y partituras ya en el tiempo del audio.
5. `chords_eval.ts` — mide el reconocedor de acordes contra los acordes escritos (sin audio).

4 nov 2026: 49 pares de 51 .gp y 61 audios (35 iguales, 6 con otro tempo, 5 con final distinto, 3 parciales).
