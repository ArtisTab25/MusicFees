# Corre align.py para cada partitura contra sus audios candidatos (por nombre y, si no hay, por duración
# parecida entre los audios sin partitura) y se queda con el de mejor parecido.
import json, glob, os, re, subprocess, sys, unicodedata
S = "/tmp/claude-0/-home-claude/60ef1adc-302d-5c3b-906d-0f153600cc71/scratchpad/audinfo.json"
info = json.load(open(S)); ad, aud = info["ad"], info["aud"]
def norm(s):
    s = unicodedata.normalize("NFD", s.lower()); s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\.(gp5?|mp3|m4a)$", "", s); s = re.sub(r"\(.*?\)|\bed\b[\s.,]*\d*|ed\.?\d+|ed,\d+|\d+ed", "", s)
    return re.sub(r"[^a-z0-9]", "", s)
gps = sorted(glob.glob("gp/*.gp*"))
by_name = {g: [a for a in aud if norm(a) == norm(os.path.basename(g)) or (len(norm(os.path.basename(g))) > 3 and (norm(a).startswith(norm(os.path.basename(g))) or norm(os.path.basename(g)).startswith(norm(a))))] for g in gps}
used = {a for v in by_name.values() for a in v}
free = [a for a in aud if a not in used and not a.endswith(".m4a")]
os.makedirs("align/cands", exist_ok=True)
best = {}
for g in gps:
    base = re.sub(r"\.gp5?$", "", os.path.basename(g)); rj = f"ref/{base}.json"
    R = json.load(open(rj)); dur = R["dur"]
    cands = [a for a in by_name[g] if not a.endswith(".m4a")]
    if not cands:
        cands = [a for a in free if 0.7 < ad[a] / dur < 1.4] or [a for a in free if 0.5 < ad[a] / dur < 2.5]
    for a in cands:
        o = f"align/cands/{base}__{os.path.splitext(a)[0]}.json"
        if not os.path.exists(o):
            subprocess.run([sys.executable, "-I", "align.py", rj, aud[a], o], check=False)
        if os.path.exists(o):
            r = json.load(open(o)); score = r["sim"] - r["baseline"]
            if base not in best or score > best[base][1]:
                best[base] = (a, score, r["sim"], r["baseline"])
json.dump(best, open("align/best.json", "w"), ensure_ascii=False, indent=1)
for k, v in sorted(best.items()):
    print(f"{k:24s} → {v[0]:28s} parecido {v[2]:.2f} (azar {v[3]:.2f})")
