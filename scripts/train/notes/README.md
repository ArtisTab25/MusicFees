# Afinar el reconocedor de notas (Basic Pitch) con partituras propias

Todo corre en CPU (2 núcleos, ~10 min por época). Solo paquetes oficiales (torch, numpy, soundfile, librosa, demucs).

1. `sep_full.py <corpus_fine.json> <htdemucs_6s oficial> stems/` — separa las obras completas con el Demucs de la app.
2. `build_ds.py <corpus_fine.json> stems/ ds/ <obras…>` — ventanas de 43 844 muestras (las de la app) con el rasgo
   congelado (salida del batchnorm, float16) y las notas de la partitura alineada (scripts/corpus/refine.py).
3. `train.py ds runs/r1 --batch 8 --anchor 1e-2 --val "A|B" --exclude "obras de prueba"` — solo las cabezas
   de nota y ataque (conv2d_2..5), ancladas a los pesos originales.
4. `bpgraph.py` — intérprete exacto en PyTorch del grafo tfjs (diferencia < 1e-4 con tfjs); `export_bin` escribe
   el .bin con el mismo formato, así que la app usa el mismo model.json con otro archivo de pesos.

Resultado (4 nov 2026), 39 obras de entrenamiento, 9 de prueba, transcripción completa en la app:
| | original | ancla 1e-2, 4 épocas (publicado) | ancla 3e-3 | todo el modelo, ancla 1e-3 |
|---|---|---|---|---|
| notas acertadas | 33,1 / 32,3 | 34,2 / 34,2 | 31,0 / 29,8 | 28,9 / 27,4 |
| duración correcta | 47,7 / 42,6 | 52,8 / 47,3 | 42,1 / 38,5 | 38,1 / 37,8 |
La validación por cuadros no predice la transcripción completa (el «todo el modelo» era el mejor ahí): decide siempre
el evaluador completo. En la mezcla (Rápida) el afinado empeora (28,8 → 24,9): se usa solo en pistas separadas.
