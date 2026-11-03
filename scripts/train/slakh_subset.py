# Baja una parte de Slakh2100-redux (CC BY 4.0, Manilow et al. 2019) sin guardar el archivo completo de
# 104 GB: lee el .tar.gz en streaming desde Zenodo y extrae solo algunas canciones de entrenamiento y validación.
# En Kaggle o Colab (con internet). Ejemplo: 200 de entrenamiento y 20 de validación ≈ 10–15 GB.
#
#   python scripts/train/slakh_subset.py --out /tmp/slakh --train 200 --validation 20
#
# El archivo no viene ordenado por canción: los archivos de una canción pueden aparecer separados. Por eso
# se cuenta una canción solo cuando está COMPLETA (metadata.yaml, mix.flac y cada pista que el metadata
# dice que se renderizó); las incompletas se borran al final.
#
# Crédito (CC BY 4.0): Ethan Manilow, Gordon Wichern, Prem Seetharaman, Jonathan Le Roux, «Cutting Music
# Source Separation Some Slakh: A Dataset to Study the Impact of Training Data Quality and Quantity», WASPAA 2019.
import argparse, os, re, shutil, sys, tarfile, urllib.request
import yaml

URL = "https://zenodo.org/records/4599666/files/slakh2100_flac_redux.tar.gz?download=1"
PAT = re.compile(r"(?:\./)?slakh2100_flac_redux/(train|validation|test|omitted)/(Track\d+)/(.*)")


def needed(meta_path: str):
    """Archivos que debe tener la canción según su metadata.yaml (None si el metadata está mal)."""
    try:
        stems = yaml.safe_load(open(meta_path))["stems"]
    except Exception:
        return None
    return {"mix.flac"} | {f"stems/{sid}.flac" for sid, m in stems.items() if m.get("audio_rendered", True)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--train", type=int, default=200)
    ap.add_argument("--validation", type=int, default=20)
    ap.add_argument("--url", default=URL, help=argparse.SUPPRESS)  # para probar con un archivo local
    ap.add_argument("--max-open", type=int, default=0, help="canciones a medias permitidas a la vez (0 = 3×lo pedido)")
    a = ap.parse_args()
    want = {"train": a.train, "validation": a.validation}
    max_open = a.max_open or 3 * (a.train + a.validation)
    have: dict = {}            # (split, track) -> archivos ya guardados
    need: dict = {}            # (split, track) -> archivos que hacen falta (cuando llega metadata.yaml)
    done = {"train": set(), "validation": set()}
    os.makedirs(a.out, exist_ok=True)

    def complete(key):
        n = need.get(key)
        return n is not None and n <= have[key]

    with urllib.request.urlopen(a.url) as r, tarfile.open(fileobj=r, mode="r|gz") as tar:
        for m in tar:
            g = PAT.match(m.name)
            if not g or not m.isfile():
                continue
            split, track, rest = g.groups()
            if split not in want or len(done[split]) >= want[split]:
                continue
            if not (rest in ("mix.flac", "metadata.yaml") or rest.startswith("stems/")):
                continue
            key = (split, track)
            if key not in have:
                open_now = sum(1 for k in have if k[1] not in done[k[0]])
                if open_now >= max_open:
                    continue  # demasiadas a medias: solo se terminan las ya empezadas
                have[key] = set()
            dst = os.path.join(a.out, split, track, rest)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with tar.extractfile(m) as src, open(dst, "wb") as f:
                shutil.copyfileobj(src, f, 1 << 20)
            have[key].add(rest)
            if rest == "metadata.yaml":
                need[key] = needed(dst)
            if complete(key) and track not in done[split]:
                done[split].add(track)
                print(f"{split}: {len(done[split])}/{want[split]} {track} completa", flush=True)
                if all(len(done[k]) >= want[k] for k in want):
                    break  # ya hay suficiente: se corta la descarga
    # Fuera lo incompleto (y lo que sobró)
    for (split, track) in have:
        if track not in done[split]:
            shutil.rmtree(os.path.join(a.out, split, track), ignore_errors=True)
    # Si la validación quedó corta, se apartan canciones de entrenamiento completas (no se usan para entrenar)
    falta = want["validation"] - len(done["validation"])
    if falta > 0 and len(done["train"]) > falta:
        for tr in sorted(done["train"])[-falta:]:
            os.makedirs(os.path.join(a.out, "validation"), exist_ok=True)
            shutil.move(os.path.join(a.out, "train", tr), os.path.join(a.out, "validation", tr))
            done["train"].discard(tr); done["validation"].add(tr)
    print("listo:", {k: len(v) for k, v in done.items()}, flush=True)
    if len(done["train"]) < min(10, a.train // 2) or not done["validation"]:
        sys.exit("Muy pocas canciones completas: revisa la conexión y vuelve a correr.")


if __name__ == "__main__":
    main()
