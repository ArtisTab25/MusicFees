# Datos para afinar Basic Pitch: ventanas de 43 844 muestras (las mismas de la app) de las pistas separadas
# de cada obra, con el rasgo congelado (salida del batchnorm, 172×309, float16) y las notas de la partitura
# llevadas al tiempo del audio con la alineación fina. Por pista:
#   guitar ← notas de guitarra · piano ← teclados · other ← melodía + teclados · bass ← bajo
# Las notas de otras familias se marcan «no importa» (la separación deja restos: no se castiga detectarlas).
#   python3 -I build_ds.py <corpus_fine.json> <stems> <salida> nombre1 nombre2 ...
import sys, os, json, re
import numpy as np, soundfile as sf, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bpgraph import BPGraph, OPS

corpus, stems, out = sys.argv[1], sys.argv[2], sys.argv[3]
names = set(sys.argv[4:])
os.makedirs(out, exist_ok=True)
g = BPGraph("/home/claude/musicfees/node_modules/@spotify/basic-pitch/model")
BN = "StatefulPartitionedCall/model_1/batch_normalization/FusedBatchNormV3"
WIN, HOPW, FPS = 43844, 36164, 22050 / 256

def feats(xb):
    memo = {"input_2": torch.from_numpy(xb).reshape(len(xb), WIN, 1)}
    def ev(name):
        name = name.split(":")[0]
        if name in memo: return memo[name]
        nd = g.nodes[name]
        r = g.const(name) if nd["op"] == "Const" else OPS[nd["op"]]([ev(i) for i in nd.get("input", []) if not i.startswith("^")], nd.get("attr", {}))
        memo[name] = r; return r
    with torch.no_grad(): return ev(BN)[..., 0].numpy().astype(np.float16)

def family(t):
    n, p = (t.get("name") or "").lower(), t["program"]
    if t["perc"]: return "drums"
    ps = sorted(x["p"] for x in t["notes"]); med = ps[len(ps) // 2] if ps else 60
    if re.search(r"bass|bajo|contrabajo|contrabass", n) or 32 <= p <= 39 or med < 43: return "bass"
    if re.search(r"guit|gtr", n): return "guitar"
    if re.search(r"piano|key|synth|sint|vibra|organ|órgano|pad|teclad|rhodes", n): return "keys"
    if re.search(r"viol|cello|trump|tromp|trombon|sax|flaut|flute|flugel|horn|clar|oboe|sin$", n): return "lead"
    if 24 <= p <= 31: return "guitar"
    if p <= 23 or 80 <= p <= 103: return "keys"
    return "lead"

POS = {"guitar": {"guitar"}, "piano": {"keys"}, "other": {"lead", "keys"}, "bass": {"bass"}}
IGN = {"guitar": {"keys", "lead"}, "piano": {"guitar", "lead"}, "other": {"guitar"}, "bass": set()}

for c in json.load(open(corpus)):
    if c["name"] not in names: continue
    A = json.load(open(c["align"])); R = json.load(open(c["ref"]))
    mp = np.array(A["map"]); st_, at_ = mp[:, 0], np.maximum.accumulate(mp[:, 1])
    off = json.load(open(f"{stems}/{c['name']}.json"))["offset"]
    warp = lambda t: np.interp(t, st_, at_) - off
    lo, hi = st_[0], st_[-1]
    notes = {f: [] for f in ("guitar", "keys", "lead", "bass")}
    for t in R["tracks"]:
        if t.get("mute"): continue
        f = family(t)
        if f == "drums": continue
        for n in t["notes"]:
            if n["s"] < lo or n["s"] > hi or not 21 <= n["p"] <= 108: continue
            s, e = float(warp(n["s"])), float(warp(min(n["e"], hi)))
            notes[f].append((s, max(e, s + 0.03), n["p"] - 21))
    slug = re.sub(r"[^a-z0-9]+", "_", c["name"].lower()).strip("_")
    for stem in ("guitar", "piano", "other", "bass"):
        pos = [x for f in POS[stem] for x in notes[f]]
        if len(pos) < 20: continue
        ign = [x for f in IGN[stem] for x in notes[f]]
        x, sr = sf.read(f"{stems}/{c['name']}.{stem}.wav", dtype="float32")
        starts = list(range(0, max(1, len(x) - WIN), HOPW))
        X = np.stack([np.pad(x[s:s + WIN], (0, max(0, WIN - len(x[s:s + WIN])))) for s in starts]).astype(np.float32)
        F = np.concatenate([feats(X[i:i + 8]) for i in range(0, len(X), 8)])
        lab = []
        for s0 in starts:
            t0 = s0 / 22050
            def frames(lst):
                r = []
                for s, e, p in lst:
                    a, b = round((s - t0) * FPS - 0.5), round((e - t0) * FPS - 0.5)
                    if b < 0 or a > 171: continue
                    r.append((a, min(b, 171), p))
                return r
            lab.append({"pos": frames(pos), "ign": frames(ign)})
        rms = np.sqrt((X ** 2).mean(1))
        np.save(f"{out}/{slug}.{stem}.npy", F)
        json.dump({"song": c["name"], "stem": stem, "lab": lab, "rms": rms.round(5).tolist()}, open(f"{out}/{slug}.{stem}.json", "w"))
        print(c["name"], stem, len(starts), "ventanas", len(pos), "notas", flush=True)
