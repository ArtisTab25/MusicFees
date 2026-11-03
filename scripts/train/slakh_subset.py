# Baja una parte de Slakh2100-redux (CC BY 4.0, Manilow et al. 2019) sin guardar el archivo completo de
# 104 GB: lee el .tar.gz en streaming desde Zenodo y extrae solo las primeras N canciones de cada parte.
# En Kaggle o Colab (con internet). Ejemplo: 300 de entrenamiento y 20 de validación ≈ 15 GB.
#
#   python scripts/train/slakh_subset.py --out slakh --train 300 --validation 20
#
# Crédito (CC BY 4.0): Ethan Manilow, Gordon Wichern, Prem Seetharaman, Jonathan Le Roux, «Cutting Music
# Source Separation Some Slakh: A Dataset to Study the Impact of Training Data Quality and Quantity», WASPAA 2019.
import argparse, os, re, sys, tarfile, urllib.request

URL = "https://zenodo.org/records/4599666/files/slakh2100_flac_redux.tar.gz?download=1"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--train", type=int, default=300)
    ap.add_argument("--validation", type=int, default=20)
    a = ap.parse_args()
    want = {"train": a.train, "validation": a.validation}
    seen: dict = {"train": set(), "validation": set()}
    os.makedirs(a.out, exist_ok=True)
    with urllib.request.urlopen(URL) as r, tarfile.open(fileobj=r, mode="r|gz") as tar:
        for m in tar:
            g = re.match(r"(?:\./)?slakh2100_flac_redux/(train|validation|test|omitted)/(Track\d+)/(.*)", m.name)
            if not g:
                continue
            split, track, rest = g.groups()
            if split not in want:
                continue
            if track not in seen[split]:
                if len(seen[split]) >= want[split]:
                    if all(len(seen[k]) >= want[k] for k in want):
                        break  # ya hay suficiente: se corta la descarga
                    continue
                seen[split].add(track)
                print(f"{split}: {len(seen[split])}/{want[split]} {track}", flush=True)
            if rest == "all_src.mid" or rest.startswith("MIDI/") and False:
                continue
            if m.isfile() and (rest in ("mix.flac", "metadata.yaml", "all_src.mid") or rest.startswith("stems/") or rest.startswith("MIDI/")):
                dst = os.path.join(a.out, split, track, rest)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with tar.extractfile(m) as src, open(dst, "wb") as f:
                    f.write(src.read())
    print("listo:", {k: len(v) for k, v in seen.items()})


if __name__ == "__main__":
    sys.exit(main())
