# Entrenar el separador de MusicFees (gratis)

Afina Demucs v4 de 6 fuentes (MIT) con **Slakh2100** (CC BY 4.0: 2 100 canciones, 145 h, con guitarra,
piano, bajo y batería por separado) para que separe mejor guitarra y piano. El resultado reemplaza los
pesos que baja la app; la red y su tamaño (55 MB) no cambian.

Probado en este repositorio solo con datos de prueba en CPU (2 pasos, 8 s cada uno): el entrenamiento
de verdad necesita una tarjeta gráfica.

## En Kaggle (30 h de tarjeta gráfica por semana, gratis)

1. Nuevo notebook → *Settings*: Accelerator **GPU T4 x2** o **P100**, Internet **On**.
2. Celdas:

```bash
!git clone --depth 1 https://github.com/ArtisTab25/MusicFees
%cd MusicFees
!pip install -q demucs soundfile pyyaml onnx einops
# Checkpoint oficial de Demucs 6 fuentes (el script comprueba su huella sha256)
!curl -sSL -o 5c90dfd2-34c22ccb.th https://github.com/nomadkaraoke/python-audio-separator/releases/download/model-configs/5c90dfd2-34c22ccb.th
# Parte de Slakh2100 sin bajar los 104 GB: ~300 canciones de entrenamiento (~15 GB)
!python scripts/train/slakh_subset.py --out /kaggle/working/slakh --train 300 --validation 20
# Entrenar (~6–10 h en una T4; guarda cada 1000 pasos y muestra el SDR de validación)
!python scripts/train/finetune_demucs6.py --data /kaggle/working/slakh --ckpt 5c90dfd2-34c22ccb.th \
    --out /kaggle/working/demucs6_slakh.th --steps 20000 --batch 4
# Exportar al formato de la app
!python scripts/export-demucs.py /kaggle/working/demucs6_slakh.th /kaggle/working/export
```

3. Descarga `export/htdemucs_6s.f16` y `export/htdemucs_6s.graph39.onnx`.

## Medir antes de usar

Con las partituras de Brayand: separa los fragmentos con los pesos nuevos y corre el mismo evaluador que
se usó para la 1.3.1–1.3.4 (bajo, reparto por instrumento, batería, acordes). Solo si mejora en los
fragmentos que no se usaron para ajustar, los pesos nuevos reemplazan a `.cache/demucs/htdemucs_6s.f16`
(sube `rev` del paquete `demucs6-weights` en `src/transcribe/packs.ts` para que los teléfonos los bajen).

## Qué se espera y qué no

- Slakh es audio sintético (instrumentos MIDI): mejora sobre todo en audio parecido, como las exportaciones
  de Guitar Pro. En grabaciones reales la mejora puede ser menor; hay que medirlo.
- Slakh no trae voz: la salida de voz no se entrena (no empeora ni mejora).
- Cuando haya pistas propias (cada pista exportada sola desde Guitar Pro, con distintos sonidos), se agregan
  igual que Slakh: carpeta por canción con `mix.flac`, `stems/*.flac` y `metadata.yaml`.

## Licencias

- Slakh2100: CC BY 4.0 — Manilow, Wichern, Seetharaman, Le Roux, «Cutting Music Source Separation Some Slakh»,
  WASPAA 2019. El crédito va en los avisos legales de la app si se publican pesos entrenados con él.
- Demucs: MIT (Meta). Los pesos afinados siguen siendo MIT + el crédito de Slakh.
