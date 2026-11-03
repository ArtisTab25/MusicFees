# Afinar Demucs v4 de 6 fuentes (htdemucs_6s, MIT) con Slakh2100 (CC BY 4.0) para que separe mejor
# guitarra y piano, que es lo más flojo del modelo original. Pensado para correr gratis en Kaggle o
# Colab con una tarjeta gráfica (T4/P100); en CPU sirve solo para probar que todo funciona.
#
#   python scripts/train/finetune_demucs6.py --data <carpeta slakh2100_flac_redux> --ckpt <5c90dfd2-34c22ccb.th> \
#       --out demucs6_slakh.th [--steps 20000] [--batch 4] [--lr 3e-5] [--segment 3.9]
#
# Después:  python scripts/export-demucs.py demucs6_slakh.th <carpeta>   (misma red, pesos nuevos)
#
# Slakh trae, por canción, la mezcla y cada instrumento por separado (mono) con su clase en metadata.yaml.
# Se agrupan como las fuentes de Demucs: batería, bajo, guitarra, piano y «lo demás». Slakh no tiene voz:
# la salida de voz no se entrena (su pérdida se ignora) para no enseñarle que nunca hay voz.
import argparse, fractions, glob, hashlib, math, os, random, sys, time
import numpy as np, soundfile as sf, torch, yaml
import demucs.htdemucs as H

SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"]
TRAIN = [0, 1, 2, 4, 5]  # todas menos la voz


def group_of(meta: dict) -> str:
    if meta.get("is_drum"):
        return "drums"
    c = (meta.get("inst_class") or "").lower()
    if c == "bass":
        return "bass"
    if c == "guitar":
        return "guitar"
    if c == "piano":
        return "piano"
    return "other"


class Slakh(torch.utils.data.IterableDataset):
    """Trozos aleatorios de canciones de Slakh: (mezcla [2, L], fuentes [6, 2, L]). Aumentos: ganancia por
    fuente, mezclas nuevas (se puede intercambiar una fuente entre canciones) y paneo estéreo."""

    def __init__(self, root: str, split: str, seg: int, sr: int = 44100, remix: float = 0.5):
        self.tracks = sorted(glob.glob(os.path.join(root, split, "Track*")))
        if not self.tracks:
            sys.exit(f"No encontré canciones en {os.path.join(root, split)}")
        self.seg, self.sr, self.remix = seg, sr, remix

    def _load(self, tr: str, start: int):
        meta = yaml.safe_load(open(os.path.join(tr, "metadata.yaml")))["stems"]
        out = np.zeros((6, self.seg), np.float32)
        for sid, m in meta.items():
            if not m.get("audio_rendered", True):
                continue
            f = os.path.join(tr, "stems", f"{sid}.flac")
            if not os.path.exists(f):
                continue
            x, sr = sf.read(f, start=start, frames=self.seg, dtype="float32", always_2d=False)
            if sr != self.sr:
                continue
            if x.ndim > 1:
                x = x.mean(1)
            out[SOURCES.index(group_of(m)), : len(x)] += x
        return out

    def __iter__(self):
        rng = random.Random(os.getpid() + int(time.time()))
        while True:
            tr = rng.choice(self.tracks)
            mix = os.path.join(tr, "mix.flac")
            n = sf.info(mix).frames
            if n <= self.seg:
                continue
            src = self._load(tr, rng.randrange(0, n - self.seg))
            if rng.random() < self.remix:  # otra canción presta una fuente (más combinaciones)
                k = rng.choice(TRAIN)
                tr2 = rng.choice(self.tracks)
                n2 = sf.info(os.path.join(tr2, "mix.flac")).frames
                if n2 > self.seg:
                    src[k] = self._load(tr2, rng.randrange(0, n2 - self.seg))[k]
            if not src[[4, 5]].any():  # sin guitarra ni piano en el trozo: poco útil
                continue
            gains = np.array([10 ** (rng.uniform(-6, 3) / 20) for _ in range(6)], np.float32)[:, None]
            src = src * gains
            pans = np.array([rng.uniform(0.2, 0.8) for _ in range(6)], np.float32)
            st = np.stack([src * np.sqrt(1 - pans)[:, None], src * np.sqrt(pans)[:, None]], 1)  # [6, 2, L]
            mixw = st.sum(0)
            peak = np.abs(mixw).max() + 1e-6
            if peak > 0.99:
                st, mixw = st / peak * 0.99, mixw / peak * 0.99
            yield torch.from_numpy(mixw), torch.from_numpy(st)


def load_model(path: str):
    torch.serialization.add_safe_globals([fractions.Fraction, H.HTDemucs])
    if os.path.basename(path).startswith("5c90dfd2") and not hashlib.sha256(open(path, "rb").read()).hexdigest().startswith("34c22ccb"):
        sys.exit("El checkpoint no es el oficial (sha256 distinto).")
    pkg = torch.load(path, map_location="cpu", weights_only=True)
    m = H.HTDemucs(*pkg["args"], **pkg["kwargs"])
    m.load_state_dict({k: v.float() for k, v in pkg["state"].items()})
    return m, pkg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=20000)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--eval-every", type=int, default=1000)
    ap.add_argument("--segment", type=float, default=3.9, help="segundos por trozo (la app usa 3,9 s)")
    a = ap.parse_args()
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model, pkg = load_model(a.ckpt)
    model.to(dev).train()
    # La app separa en trozos de 3,9 s: se afina igual (y cabe en menos memoria).
    model.segment = fractions.Fraction(a.segment).limit_denominator(100)
    seg = int(model.segment * model.samplerate)
    dl = torch.utils.data.DataLoader(Slakh(a.data, "train", seg), batch_size=a.batch, num_workers=a.workers if dev == "cuda" else 0)
    val = Slakh(a.data, "validation", seg, remix=0.0)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.0)
    scaler = torch.amp.GradScaler(enabled=dev == "cuda")
    t0, run = time.time(), 0.0
    for step, (mix, src) in enumerate(dl, 1):
        mix, src = mix.to(dev), src.to(dev)
        with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=dev == "cuda"):
            est = model(mix)
            loss = (est[:, TRAIN] - src[:, TRAIN]).abs().mean()  # L1 en la forma de onda, como Demucs
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        scaler.step(opt); scaler.update()
        lv = loss.item()
        run = 0.98 * run + 0.02 * lv if step > 1 else lv
        if step % 50 == 0 or step == 1:
            print(f"paso {step} · pérdida {run:.4f} · {time.time() - t0:.0f} s", flush=True)
        if step % a.eval_every == 0 or step == a.steps:
            model.eval()
            sdr = np.zeros(6); it = iter(val)
            with torch.no_grad():
                for _ in range(8):
                    m, s = next(it)
                    e = model(m[None].to(dev))[0].cpu()
                    for k in TRAIN:
                        num = (s[k] ** 2).sum(); den = ((s[k] - e[k]) ** 2).sum()
                        sdr[k] += float(10 * torch.log10((num + 1e-8) / (den + 1e-8))) / 8
            print("SDR validación:", {SOURCES[k]: round(sdr[k], 2) for k in TRAIN}, flush=True)
            model.train()
            state = {k: v.detach().half().cpu() for k, v in model.state_dict().items()}
            torch.save({**pkg, "state": state}, a.out)
            print(f"guardado {a.out}", flush=True)
        if step >= a.steps:
            break


if __name__ == "__main__":
    main()
