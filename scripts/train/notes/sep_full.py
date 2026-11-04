# Separa las obras completas del corpus con el Demucs de la app (6 fuentes, trozos de 3,9 s) y guarda, a
# 22 050 Hz mono int16, las pistas que alimentan al reconocedor de notas: guitar, piano, bass, other.
# Solo el tramo del audio que cubre la alineación. Solo paquetes oficiales + carga weights_only con huella.
#   python3 -I sep_full.py <corpus.json> <checkpoint oficial> <salida> [nombres...]
import sys, os, json, time, fractions, hashlib
import numpy as np, soundfile as sf, torch, librosa
import demucs.htdemucs as H
from demucs.apply import apply_model

torch.set_num_threads(2)
corpus, ckpt, out = sys.argv[1], sys.argv[2], sys.argv[3]
only = set(sys.argv[4:])
assert hashlib.sha256(open(ckpt, "rb").read()).hexdigest().startswith("34c22ccb")
torch.serialization.add_safe_globals([fractions.Fraction, H.HTDemucs])
pkg = torch.load(ckpt, map_location="cpu", weights_only=True)
m = H.HTDemucs(*pkg["args"], **pkg["kwargs"]); m.load_state_dict({k: v.float() for k, v in pkg["state"].items()}); m.eval()
m.segment = fractions.Fraction(39, 10)
SRC = ["drums", "bass", "other", "vocals", "guitar", "piano"]
KEEP = ["bass", "other", "guitar", "piano"]
os.makedirs(out, exist_ok=True)
for c in json.load(open(corpus)):
    if only and c["name"] not in only: continue
    A = json.load(open(c["align"]))
    lo, hi = A["covers_audio"]
    tag = f"{out}/{c['name']}"
    if os.path.exists(tag + ".piano.wav"): continue
    t = time.time()
    x, sr = librosa.load(c["audio"], sr=44100, mono=False, offset=max(0, lo - 1), duration=hi - lo + 2)
    if x.ndim == 1: x = np.stack([x, x])
    wav = torch.from_numpy(x.astype(np.float32))[None]
    ref = wav.mean(1).mean(); sd = wav.mean(1).std()
    with torch.no_grad():
        y = apply_model(m, (wav - ref) / sd, split=True, overlap=0.25, segment=3.9, progress=False)[0] * sd + ref
    for i, s in enumerate(SRC):
        if s not in KEEP: continue
        mono = librosa.resample(y[i].mean(0).numpy(), orig_sr=44100, target_sr=22050)
        sf.write(f"{tag}.{s}.wav", mono, 22050, subtype="PCM_16")
    json.dump({"offset": max(0, lo - 1)}, open(tag + ".json", "w"))
    print(c["name"], round(hi - lo), "s audio en", round(time.time() - t), "s", flush=True)
print("listo")
