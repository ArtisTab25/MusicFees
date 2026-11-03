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
    # Si la parte de validación viene muy atrás en el archivo, no se espera a llegar a ella: se bajan canciones
    # de entrenamiento de más y las últimas se apartan como validación (siguen sin usarse para entrenar).
    want = {"train": a.train + a.validation, "validation": a.validation}
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
                    if len(seen["train"]) >= want["train"]:
                        break  # ya hay suficiente: se corta la descarga
                    continue
                seen[split].add(track)
                print(f"{split}: {len(seen[split])}/{want[split]} {track}", flush=True)
            if m.isfile() and (rest in ("mix.flac", "metadata.yaml", "all_src.mid") or rest.startswith("stems/") or rest.startswith("MIDI/")):
                dst = os.path.join(a.out, split, track, rest)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with tar.extractfile(m) as src, open(dst, "wb") as f:
                    f.write(src.read())
    val_dir = os.path.join(a.out, "validation")
    have_val = len(seen["validation"])
    if have_val < a.validation:  # apartar las últimas de entrenamiento como validación
        import shutil
        for tr in sorted(seen["train"])[-(a.validation - have_val):]:
            os.makedirs(val_dir, exist_ok=True)
            shutil.move(os.path.join(a.out, "train", tr), os.path.join(val_dir, tr))
            seen["train"].discard(tr); seen["validation"].add(tr)
    print("listo:", {k: len(v) for k, v in seen.items()})


if __name__ == "__main__":
    sys.exit(main())
