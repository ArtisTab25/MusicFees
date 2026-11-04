# Afina las cabezas de nota y de ataque de Basic Pitch con las ventanas de build_ds.py.
# El frente (CQT, armónicos, contorno) queda congelado; se aprenden conv2d_2/3 (nota) y conv2d_4/5 (ataque),
# con un ancla L2 hacia los pesos originales para no olvidar lo que ya sabe. Para con la validación.
#   python3 -I train.py <ds> <salida> --val obra1,obra2 [--epochs 8] [--lr 3e-4] [--anchor 1e-2] [--all]
import sys, os, json, glob, argparse, time, shutil
import numpy as np, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bpgraph import BPGraph, OPS

ap = argparse.ArgumentParser()
ap.add_argument("ds"); ap.add_argument("out")
ap.add_argument("--val", default=""); ap.add_argument("--epochs", type=int, default=8)
ap.add_argument("--lr", type=float, default=3e-4); ap.add_argument("--anchor", type=float, default=1e-2)
ap.add_argument("--batch", type=int, default=16); ap.add_argument("--all", action="store_true")
ap.add_argument("--stems", default="guitar,piano,other,bass"); ap.add_argument("--onw", type=float, default=0.95)
ap.add_argument("--exclude", default="")
a = ap.parse_args()
torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(2)
MD = "/home/claude/musicfees/node_modules/@spotify/basic-pitch/model"
g = BPGraph(MD)
BN = "StatefulPartitionedCall/model_1/batch_normalization/FusedBatchNormV3"
learn = ("conv2d_2", "conv2d_3", "conv2d_4", "conv2d_5") + (("conv2d_1", "contours-reduced") if a.all else ())
for k, p in g.trainable.items(): p.requires_grad = any(k.startswith(l) for l in learn)
init = {k: p.detach().clone() for k, p in g.trainable.items()}
params = [p for p in g.trainable.values() if p.requires_grad]
print("aprende", sum(p.numel() for p in params), "parámetros", flush=True)

def heads(F):
    memo = {BN: F.unsqueeze(-1)}
    def ev(name):
        name = name.split(":")[0]
        if name in memo: return memo[name]
        nd = g.nodes[name]
        r = g.const(name) if nd["op"] == "Const" else OPS[nd["op"]]([ev(i) for i in nd.get("input", []) if not i.startswith("^")], nd.get("attr", {}))
        memo[name] = r; return r
    r = ev(g.map["note"]), ev(g.map["onset"])
    memo.clear()  # ev se refiere a sí misma (ciclo): sin esto la memoria solo se libera cuando pasa el recolector
    return r

val = set(v for v in a.val.split("|") if v); exc = set(v for v in a.exclude.split("|") if v)
stems = set(a.stems.split(","))
items = {"train": [], "val": []}
for j in sorted(glob.glob(f"{a.ds}/*.json")):
    D = json.load(open(j))
    if D["stem"] not in stems or D["song"] in exc: continue
    F = np.load(j[:-5] + ".npy")
    for i, (lab, r) in enumerate(zip(D["lab"], D["rms"])):
        if not lab["pos"] and r < 2e-3: continue
        items["val" if D["song"] in val else "train"].append((F, i, lab))
print({k: len(v) for k, v in items.items()}, flush=True)

def batch(lst):
    F = torch.from_numpy(np.stack([np.asarray(f[i], np.float32) for f, i, _ in lst]))
    B = len(lst); note = torch.zeros(B, 172, 88); on = torch.zeros(B, 172, 88); mask = torch.ones(B, 172, 88)
    for b, (_, _, lab) in enumerate(lst):
        for s, e, p in lab["ign"]: mask[b, max(0, s - 2):e + 3, p] = 0
        for s, e, p in lab["pos"]:
            note[b, max(0, s):e + 1, p] = 1; mask[b, max(0, s):e + 1, p] = 1
            if 0 <= s <= 171:
                on[b, s, p] = 1
                for d in (-1, 1):
                    if 0 <= s + d <= 171: on[b, s + d, p] = max(on[b, s + d, p].item(), 0.5)
    return F, note, on, mask

def loss_fn(F, note, on, mask):
    pn, po = heads(F)
    pn, po = pn.clamp(1e-6, 1 - 1e-6), po.clamp(1e-6, 1 - 1e-6)
    ln = -(note * pn.log() + (1 - note) * (1 - pn).log())
    lo = -(a.onw * on * po.log() + (1 - a.onw) * (1 - on) * (1 - po).log())
    m = mask.sum() + 1
    return (ln * mask).sum() / m, (lo * mask).sum() / m, pn, po

def frame_f(p, t, m, th):
    pr = (p > th) & (m > 0); tr = (t >= 0.99) & (m > 0)
    tp = (pr & tr).sum().item(); return tp, pr.sum().item(), tr.sum().item()

def evaluate():
    tot = [0, 0]; acc = {"n": [0, 0, 0], "o": [0, 0, 0]}
    with torch.no_grad():
        for i in range(0, len(items["val"]), 8):
            F, note, on, mask = batch(items["val"][i:i + 8])
            ln, lo, pn, po = loss_fn(F, note, on, mask)
            tot[0] += ln.item() * len(F); tot[1] += lo.item() * len(F)
            for k, (p, t, th) in {"n": (pn, note, 0.3), "o": (po, on, 0.5)}.items():
                r = frame_f(p, t, mask, th); acc[k] = [x + y for x, y in zip(acc[k], r)]
    n = max(1, len(items["val"]))
    f = {k: round(2 * v[0] / max(1, v[1] + v[2]), 4) for k, v in acc.items()}
    return tot[0] / n, tot[1] / n, f

opt = torch.optim.Adam(params, lr=a.lr)
os.makedirs(a.out, exist_ok=True)
def save(tag):
    d = f"{a.out}/{tag}"; os.makedirs(d, exist_ok=True)
    shutil.copy(f"{MD}/model.json", d); g.export_bin(f"{d}/group1-shard1of1.bin")
v0 = evaluate(); print("época 0 (original) val nota %.4f ataque %.4f F %s" % v0, flush=True)
best = v0[0] + v0[1]; hist = [{"epoch": 0, "val": v0}]
for ep in range(1, a.epochs + 1):
    t = time.time(); idx = np.random.permutation(len(items["train"])); run = []
    for k in range(0, len(idx), a.batch):
        F, note, on, mask = batch([items["train"][i] for i in idx[k:k + a.batch]])
        ln, lo, _, _ = loss_fn(F, note, on, mask)
        reg = sum(((p - init[n]) ** 2).sum() for n, p in g.trainable.items() if p.requires_grad)
        L = ln + lo + a.anchor * reg
        opt.zero_grad(); L.backward(); opt.step(); run.append((ln.item(), lo.item()))
    v = evaluate(); tr = np.mean(run, 0)
    print(f"época {ep} entren nota {tr[0]:.4f} ataque {tr[1]:.4f} · val nota {v[0]:.4f} ataque {v[1]:.4f} F {v[2]} · {time.time() - t:.0f} s", flush=True)
    hist.append({"epoch": ep, "val": v})
    save(f"ep{ep}")
    if v[0] + v[1] < best: best = v[0] + v[1]; save("best")
json.dump(hist, open(f"{a.out}/hist.json", "w"))
print("listo", flush=True)
