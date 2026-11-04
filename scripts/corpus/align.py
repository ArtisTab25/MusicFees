# Alinea una partitura (.json de tests/_ref.mjs) con su audio: mapa tiempo-de-partitura → tiempo-de-audio.
# Rasgos: croma (12) y ataques, a 10 cuadros/s; DTW con pasos suaves. Si uno es mucho más corto que el otro,
# se busca como subsecuencia (audio con intro extra o partitura que solo cubre una parte).
#   python3 -I align.py <ref.json> <audio> <salida.json>
import sys, json
import numpy as np, librosa

FPS = 10
ref, audio, out = sys.argv[1], sys.argv[2], sys.argv[3]
R = json.load(open(ref))
y, sr = librosa.load(audio, sr=22050, mono=True)
hop = sr // FPS
A_ch = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop, n_fft=4096)
A_on = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
na = A_ch.shape[1]
dur = R["dur"]; ns = int(np.ceil(dur * FPS)) + 1
S_ch = np.zeros((12, ns)); S_on = np.zeros(ns)
for t in R["tracks"]:
    if t.get("mute"):
        continue
    for n in t["notes"]:
        a = int(n["s"] * FPS)
        if a >= ns:
            continue
        S_on[a] += n["v"] / 127 * (0.6 if t["perc"] else 1.0)
        if t["perc"]:
            continue
        b = max(a + 1, min(ns, int(n["e"] * FPS)))
        w = n["v"] / 127 * np.exp(-np.arange(b - a) / (FPS * 1.5))  # una nota se apaga con el tiempo
        S_ch[n["p"] % 12, a:b] += w
def prep(ch, on):
    ch = ch / (np.linalg.norm(ch, axis=0, keepdims=True) + 1e-6)
    on = np.convolve(on, np.ones(3) / 3, "same"); on = (on - on.mean()) / (on.std() + 1e-6)
    return ch, on
A_ch, A_on = prep(A_ch, A_on[:na]); S_ch, S_on = prep(S_ch, S_on)
def cost(X_ch, X_on, Y_ch, Y_on):
    c = 1 - X_ch.T @ Y_ch
    o = np.abs(X_on[:, None] - Y_on[None, :]) / 4
    return c + 0.35 * np.minimum(o, 1.5)
ratio = ns / na
subseq = ratio < 0.85 or ratio > 1.18
if not subseq or ns <= na:
    C = cost(S_ch, S_on, A_ch, A_on)          # filas: partitura, columnas: audio
    D, wp = librosa.sequence.dtw(C=C, subseq=subseq, step_sizes_sigma=np.array([[1, 1], [1, 2], [2, 1]]), weights_add=np.array([0, 0.05, 0.05]))
    path = wp[::-1]  # (partitura, audio)
else:
    C = cost(A_ch, A_on, S_ch, S_on)          # el audio cubre solo una parte de la partitura
    D, wp = librosa.sequence.dtw(C=C, subseq=True, step_sizes_sigma=np.array([[1, 1], [1, 2], [2, 1]]), weights_add=np.array([0, 0.05, 0.05]))
    path = wp[::-1][:, ::-1]
s_t, a_t = path[:, 0] / FPS, path[:, 1] / FPS
sim = float(np.mean([1 - (1 - S_ch[:, i] @ A_ch[:, j]) for i, j in path]))
rng = np.random.default_rng(0)
base = float(np.mean([S_ch[:, i] @ A_ch[:, rng.integers(na)] for i, _ in path[::5]]))
# Tempo por tramos de 10 s de partitura: pendiente audio/partitura
segs = []
for t0 in np.arange(s_t[0], s_t[-1] - 5, 10):
    m = (s_t >= t0) & (s_t < t0 + 10)
    if m.sum() > 20:
        k = np.polyfit(s_t[m], a_t[m], 1)[0]
        segs.append(round(float(k), 3))
# Mapa compacto: un punto por cada 0,5 s de partitura (mediana del audio)
keys = {}
for s, a in zip(s_t, a_t):
    keys.setdefault(round(s * 2) / 2, []).append(a)
mp = [[k, round(float(np.median(v)), 3)] for k, v in sorted(keys.items())]
res = {"ref": ref, "audio": audio, "score_dur": dur, "audio_dur": na / FPS, "subseq": bool(subseq),
       "covers_score": [round(float(s_t[0]), 1), round(float(s_t[-1]), 1)], "covers_audio": [round(float(a_t[0]), 1), round(float(a_t[-1]), 1)],
       "sim": round(sim, 3), "baseline": round(base, 3), "tempo_ratio_segments": segs, "map": mp}
json.dump(res, open(out, "w"))
med = float(np.median(segs)) if segs else 0
print(f"{audio.split('/')[-1]:32s} sim {sim:.2f} (azar {base:.2f}) · partitura {res['covers_score']} audio {res['covers_audio']} · tempo audio/partitura mediana {med:.3f} rango {min(segs) if segs else 0:.2f}–{max(segs) if segs else 0:.2f}", flush=True)
