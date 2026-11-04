# Medición del lector de tablaturas en PDF

1. `node scripts/omr/render.cjs salida.pdf "t=<pista>&p=Tab"` — genera un PDF vectorial desde un .gp con alphaTab
   (copiar el .gp como `song.gp` junto a `index.html`, que carga alphaTab desde node_modules).
2. `omrtest.ts` (empaquetar con esbuild) — compara compás por compás cuerda y traste contra el .gp.
3. `textest.ts` — PDF → alphaTex → canción importada: ¿mismas alturas por compás?

4 nov 2026, 8 obras de Brayand, solo tablatura / partitura + tablatura: columnas acertadas (precisión) 85–100 %,
encontradas 79–99 %; PDF → alphaTex → canción conserva las alturas del 94 % de los compases (A2). El ritmo se
estima por la posición horizontal (aproximado). Falta probar con PDF exportados por Guitar Pro y MuseScore reales.
