# Afina la alineación partitura → audio de align.py (DTW a 10 cuadros/s, ±100 ms) hasta el nivel de ataque.
# 1) Suaviza el mapa del DTW con rectas locales robustas (el tempo de una grabación cambia despacio).
# 2) En ventanas deslizantes busca el desfase que mejor pone los ataques escritos sobre los ataques del audio
#    (envolvente de ataques a 5 ms), en dos pasadas (±200 ms y luego ±60 ms), y suaviza ese desfase.
# Salida: el mismo .json de alineación con "map" a 0,1 s y "refine" con estadísticas.
#   python3 -I refine.py <ref.json> <align.json> <salida.json>
import sys, json
import numpy as np, librosa
from scipy.ndimage import gaussian_filter1d, median_filter

ref, al, out = sys.argv[1], sys.argv[2], sys.argv[3]
R, A = json.load(open(ref)), json.load(open(al))
SR, HOP = 22050, 110                      # 5 ms
y, _ = librosa.load(A["audio"], sr=SR, mono=True)
env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, lag=1, max_size=3)
env = np.maximum(env - median_filter(env, 41), 0)          # quita el fondo, deja los picos
env = gaussian_filter1d(env, 2) / (np.percentile(env, 99) + 1e-9)
fps = SR / HOP
def at(t):  # envolvente interpolada en tiempos (s)
    return np.interp(t * fps, np.arange(len(env)), env, left=0, right=0)

mp = np.array(A["map"]); s_, a_ = mp[:, 0], np.maximum.accumulate(mp[:, 1])
# 1) rectas locales robustas sobre ±4 s de partitura
def smooth(s_, a_, half=4.0):
    out = np.empty_like(a_)
    for i, s in enumerate(s_):
        m = np.abs(s_ - s) <= half
        x, z = s_[m], a_[m]
        w = np.ones_like(x)
        for _ in range(3):  # Huber iterado
            k, b = np.polyfit(x, z, 1, w=w)
            r = np.abs(z - (k * x + b)); w = 1 / np.maximum(r / 0.08, 1)
        out[i] = k * s + b
    return np.maximum.accumulate(out)
a0 = smooth(s_, a_)
w0 = lambda t: np.interp(t, s_, a0, left=a0[0] - (s_[0] - t) if np.isscalar(t) else None, right=None)

# Ataques escritos (sin pistas mudas), con peso: batería y bajo marcan mejor el tiempo
ev = []
for t in R["tracks"]:
    if t.get("mute"): continue
    wt = 1.0 if t["perc"] else 0.9 if (t.get("role") == "bass" or min((n["p"] for n in t["notes"]), default=99) < 45) else 0.6
    for n in t["notes"]: ev.append((n["s"], wt * (0.4 + 0.6 * n["v"] / 127)))
ev.sort()
es = np.array([e[0] for e in ev]); ew = np.array([e[1] for e in ev])
# un ataque por instante (acordes y golpes simultáneos cuentan una vez, con el mayor peso)
keep = np.r_[True, np.diff(es) > 0.015]
grp = np.cumsum(keep) - 1
es = es[keep]; ew = np.array([ew[grp == g].max() for g in range(keep.sum())])

def lag_pass(warp, half, rng, step=0.005):
    lags = np.arange(-rng, rng + 1e-9, step)
    centers = np.arange(s_[0], s_[-1], 1.0)
    best, conf = [], []
    for c in centers:
        m = np.abs(es - c) <= half
        if m.sum() < 4: best.append(np.nan); conf.append(0); continue
        ta, w = warp(es[m]), ew[m]
        sc = np.array([(w * at(ta + l)).sum() for l in lags]) / w.sum()
        j = int(sc.argmax())
        best.append(lags[j]); conf.append(sc[j] / (np.median(sc) + 1e-6) - 1)
    best, conf = np.array(best), np.array(conf)
    ok = np.isfinite(best) & (conf > 0.15)
    if ok.sum() < 3: return warp, 0.0, 0.0
    lag = np.interp(centers, centers[ok], median_filter(best[ok], 5))
    lag = gaussian_filter1d(lag, 2)
    nw = lambda t, warp=warp: warp(t) + np.interp(t, centers, lag)
    return nw, float(np.median(np.abs(lag))), float(ok.mean())

w1, l1, c1 = lag_pass(lambda t: np.interp(t, s_, a0), 3.0, 0.20)
w2, l2, c2 = lag_pass(w1, 1.5, 0.06)
# Mapa fino, monótono
fs = np.round(np.arange(s_[0], s_[-1] + 1e-9, 0.1), 2)
fa = np.maximum.accumulate(w2(fs))
# Cuánto mejora: fracción de ataques escritos que caen sobre un pico del audio (±25 ms)
def hit(warp):
    ta = warp(es); pk = np.array([env[max(0, int((t - .025) * fps)):int((t + .025) * fps) + 1].max(initial=0) for t in ta])
    return float((ew * (pk > 0.15)).sum() / ew.sum())
h0, h2 = hit(lambda t: np.interp(t, s_, a_)), hit(lambda t: np.interp(t, fs, fa))
A["map_coarse"] = A["map"]; A["map"] = [[float(s), round(float(a), 4)] for s, a in zip(fs, fa)]
A["refine"] = {"lag1_med": round(l1, 3), "conf1": round(c1, 2), "lag2_med": round(l2, 3), "conf2": round(c2, 2), "hit_before": round(h0, 3), "hit_after": round(h2, 3)}
json.dump(A, open(out, "w"))
print(f"{A['audio'].split('/')[-1]:32s} desfase {l1*1000:.0f}+{l2*1000:.0f} ms · ataques sobre pico {h0:.2f} → {h2:.2f}", flush=True)
