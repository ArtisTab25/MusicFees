# Prepara el corpus nuevo para el evaluador: por cada par partitura+audio, un fragmento de 60 s del audio
# (desde el 35 % de la canción, dentro de lo que cubre la alineación) y la partitura llevada al tiempo del
# audio con el mapa de alineación (así una obra con otro tempo o con final distinto no se descarta).
#   python3 -I prep_clips.py <corpus.json> <carpeta ev> <carpeta clip> [nombres a saltar...]
import json, sys, os, re, subprocess
import numpy as np
corpus, EV, CD = sys.argv[1], sys.argv[2], sys.argv[3]
skip = set(sys.argv[4:])
os.makedirs(f"{EV}/{CD}", exist_ok=True)
starts = []
slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
for c in json.load(open(corpus)):
    if c["name"] in skip or not c["ok"] and c["sim"] - c["base"] < 0.15:
        continue
    name = "n_" + slug(c["name"])
    A = json.load(open(c["align"]))
    mp = np.array(A["map"])  # [tiempo partitura, tiempo audio]
    st_, at_ = mp[:, 0], mp[:, 1]
    # monotonía (la alineación puede repetir valores): acumulado máximo
    at_ = np.maximum.accumulate(at_)
    warp = lambda t: float(np.interp(t, st_, at_, left=at_[0] - (st_[0] - t), right=at_[-1] + (t - st_[-1])))
    R = json.load(open(c["ref"]))
    for t in R["tracks"]:
        for n in t["notes"]:
            s, e = warp(n["s"]), warp(n["e"])
            n["s"], n["e"] = round(s, 4), round(max(e, s + 0.01), 4)
    for x in R.get("techs", []):
        x["t"] = round(warp(x["t"]), 4)
    if R.get("chords"):
        for ch in R["chords"]:
            if "t" in ch: ch["t"] = round(warp(ch["t"]), 4)
    # tempo en el tiempo del audio
    ratio = c["ratio"] or 1
    R["tempo"] = R["tempo"] / ratio
    R["tempos"] = [[round(warp(t), 3), b / ratio] for t, b in R["tempos"]]
    R["dur"] = A["audio_dur"]
    json.dump(R, open(f"{EV}/gp/{name}.json", "w"))
    if os.environ.get("ONLYREF"):
        continue
    lo, hi = A["covers_audio"]
    L = 60
    s0 = max(lo, min(hi - L, lo + 0.35 * (hi - lo)))
    if hi - lo < L: s0, L = lo, int(hi - lo)
    s0 = int(s0)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(s0), "-t", str(L), "-i", c["audio"], "-ar", "44100", "-ac", "2", f"{EV}/{CD}/{name}.wav"], check=True)
    starts.append(f"{name} {s0}")
    print(name, s0, L, flush=True)
if not os.environ.get("ONLYREF"): open(f"{EV}/{CD}/starts.txt", "w").write("\n".join(starts) + "\n")
