# Intérprete en PyTorch del grafo tfjs de Basic Pitch (Spotify, Apache-2.0) tal como lo usa la app
# (node_modules/@spotify/basic-pitch/model). Ejecuta el mismo grafo nodo por nodo, así que la salida es la del
# modelo original; las capas aprendibles (convoluciones de las cabezas) quedan como parámetros para afinarlas y
# luego se escriben de vuelta en el mismo .bin (la app no cambia: mismo grafo, otros números).
import json, base64, math
import numpy as np, torch
import torch.nn.functional as F

TRAIN_KEYS = ("conv2d_1/", "conv2d_2/", "conv2d_3/", "conv2d_4/", "conv2d_5/", "contours-reduced/")


class BPGraph(torch.nn.Module):
    def __init__(self, model_dir):
        super().__init__()
        m = json.load(open(f"{model_dir}/model.json"))
        self.meta = m
        man = m["weightsManifest"][0]
        buf = b"".join(open(f"{model_dir}/{p}", "rb").read() for p in man["paths"])
        self.consts, self.trainable = {}, torch.nn.ParameterDict()
        self.order, off = [], 0
        for w in man["weights"]:
            n = math.prod(w["shape"]) if w["shape"] else 1
            dt = {"float32": np.float32, "int32": np.int32}[w["dtype"]]
            a = np.frombuffer(buf, dt, n, off).reshape(w["shape"]).copy(); off += n * 4
            self.order.append((w["name"], w["dtype"], w["shape"]))
            if dt == np.float32 and any(k in w["name"] for k in TRAIN_KEYS):
                self.trainable[self._key(w["name"])] = torch.nn.Parameter(torch.from_numpy(a))
            else:
                self.consts[w["name"]] = torch.from_numpy(a) if dt == np.float32 else a
        self.nodes = {n["name"]: n for n in m["modelTopology"]["node"]}
        out = m["signature"]["outputs"]
        self.out_names = {k: v["name"].split(":")[0] for k, v in out.items()}
        # ¿cuál salida es nota y cuál ataque?
        def reaches(name, key, seen=None):
            seen = seen or set()
            if name in seen or name not in self.nodes: return False
            seen.add(name)
            if key in name: return True
            return any(reaches(i.split(":")[0].lstrip("^"), key, seen) for i in self.nodes[name].get("input", [])[:1])
        self.map = {}
        for k, nm in self.out_names.items():
            src = self.nodes[nm]["input"][0]
            self.map["contour" if "contour/" in src else "note" if "note/" in src else "onset" if "onset/" in src else k] = nm

    @staticmethod
    def _key(name): return name.replace("StatefulPartitionedCall/model_1/", "").replace("/", "__")

    def const(self, name):
        k = self._key(name)
        if k in self.trainable: return self.trainable[k]
        return self.consts[name]

    def forward(self, x):
        """x: (B, 43844, 1) → dict con contour (B,172,264), note (B,172,88), onset (B,172,88)."""
        memo = {"input_2": x}
        def ev(name):
            name = name.split(":")[0]
            if name in memo: return memo[name]
            n = self.nodes[name]; op = n["op"]; a = n.get("attr", {})
            if op == "Const": r = self.const(name)
            else:
                ins = [ev(i) for i in n.get("input", []) if not i.startswith("^")]
                r = OPS[op](ins, a)
            memo[name] = r
            return r
        out = {k: ev(v) for k, v in self.map.items()}
        memo.clear()  # ciclo ev↔memo: liberar ya
        return out

    def export_bin(self, path):
        """Escribe el .bin con los pesos actuales, en el mismo orden y formato que el original."""
        parts = []
        for name, dt, shape in self.order:
            k = self._key(name)
            if k in self.trainable: a = self.trainable[k].detach().cpu().numpy().astype(np.float32)
            else:
                c = self.consts[name]; a = c.numpy() if torch.is_tensor(c) else c
            parts.append(np.ascontiguousarray(a).astype(np.float32 if dt == "float32" else np.int32).tobytes())
        open(path, "wb").write(b"".join(parts))


def _s(a, k): return base64.b64decode(a[k]["s"]).decode()
def _ints(a, k): return [int(v) for v in a[k]["list"].get("i", [])]
def _i(a, k): return int(a.get(k, {}).get("i", 0))
def _np(v): return v.detach().cpu().numpy() if torch.is_tensor(v) else np.asarray(v)


def strided_slice(ins, a):
    x, b, e, s = ins[0], _np(ins[1]).tolist(), _np(ins[2]).tolist(), _np(ins[3]).tolist()
    bm, em, elm, nam, sam = (_i(a, k) for k in ("begin_mask", "end_mask", "ellipsis_mask", "new_axis_mask", "shrink_axis_mask"))
    isnp = not torch.is_tensor(x)
    rank = len(x.shape)
    idx, dim, shrink_dims, j = [], 0, [], 0
    for j in range(len(b)):
        if elm >> j & 1:
            rest = rank - (len(b) - j - 1 - sum((nam >> k & 1) for k in range(j + 1, len(b))))
            while dim < rest: idx.append(slice(None)); dim += 1
            continue
        if nam >> j & 1: idx.append(None); continue
        if sam >> j & 1:
            idx.append(int(b[j])); dim += 1; continue
        st = int(s[j])
        bb = None if bm >> j & 1 else int(b[j]); ee = None if em >> j & 1 else int(e[j])
        idx.append(slice(bb, ee, st)); dim += 1
    if isnp: return np.asarray(x)[tuple(idx)]
    if any(isinstance(i, slice) and i.step and i.step < 0 for i in idx):
        raise NotImplementedError("paso negativo")
    return x[tuple(idx)]


def conv2d(ins, a, fused=None):
    x, w = ins[0], ins[1]
    if not torch.is_tensor(w): w = torch.as_tensor(w)
    st = _ints(a, "strides"); sh, sw = st[1], st[2]
    xi = x.permute(0, 3, 1, 2); wi = w.permute(3, 2, 0, 1)
    if _s(a, "padding") == "SAME":
        H, W = xi.shape[2], xi.shape[3]; kh, kw = wi.shape[2], wi.shape[3]
        ph = max((math.ceil(H / sh) - 1) * sh + kh - H, 0); pw = max((math.ceil(W / sw) - 1) * sw + kw - W, 0)
        xi = F.pad(xi, (pw // 2, pw - pw // 2, ph // 2, ph - ph // 2))
    y = F.conv2d(xi, wi, stride=(sh, sw)).permute(0, 2, 3, 1)
    if fused is not None:
        ops = [base64.b64decode(s).decode() for s in a["fused_ops"]["list"]["s"]]
        if "BiasAdd" in ops: y = y + ins[2]
        if "Relu" in ops: y = torch.relu(y)
        if set(ops) - {"BiasAdd", "Relu"}: raise NotImplementedError(ops)
    return y


def mirror_pad(ins, a):
    x, p = ins[0], _np(ins[1]).tolist()
    assert _s(a, "mode") == "REFLECT"
    for d, (l, r) in enumerate(p):
        if l or r:
            L = x.shape[d]
            parts = []
            if l: parts.append(x.narrow(d, 1, l).flip(d))
            parts.append(x)
            if r: parts.append(x.narrow(d, L - 1 - r, r).flip(d))
            x = torch.cat(parts, d)
    return x


def pad(ins, a):
    x, p = ins[0], _np(ins[1]).tolist()
    flat = []
    for l, r in reversed(p): flat += [l, r]
    return F.pad(x, flat)


def reduce(fn):
    def f(ins, a):
        x, ax = ins[0], _np(ins[1]).reshape(-1).tolist()
        kd = a.get("keep_dims", {}).get("b", False)
        for d in sorted([d % x.dim() for d in ax], reverse=True):
            x = fn(x, d, kd)
        return x
    return f


OPS = {
    "Shape": lambda i, a: np.array(i[0].shape, np.int32),
    "StridedSlice": strided_slice,
    "Pack": lambda i, a: (np.stack([_np(v) for v in i], _i(a, "axis")) if not any(torch.is_tensor(v) and v.dtype.is_floating_point for v in i) else torch.stack(i, _i(a, "axis"))),
    "Reshape": lambda i, a: i[0].reshape([int(v) for v in _np(i[1]).reshape(-1)]),
    "Pad": pad,
    "MirrorPad": mirror_pad,
    "Transpose": lambda i, a: i[0].permute(*[int(v) for v in _np(i[1])]),
    "ExpandDims": lambda i, a: i[0].unsqueeze(int(_np(i[1]).reshape(-1)[0]) if int(_np(i[1]).reshape(-1)[0]) >= 0 else int(_np(i[1]).reshape(-1)[0]) + i[0].dim() + 1),
    "Squeeze": lambda i, a: i[0].squeeze(_ints(a, "squeeze_dims")[0]) if len(_ints(a, "squeeze_dims")) == 1 else i[0].squeeze(),
    "Conv2D": lambda i, a: conv2d(i, a),
    "_FusedConv2D": lambda i, a: conv2d(i, a, fused=True),
    "Neg": lambda i, a: -i[0],
    "Mul": lambda i, a: i[0] * i[1],
    "Square": lambda i, a: i[0] * i[0],
    "Sqrt": lambda i, a: torch.sqrt(i[0]),
    "Sum": reduce(lambda x, d, k: x.sum(d, keepdim=k)),
    "Min": reduce(lambda x, d, k: x.amin(d, keepdim=k)),
    "Max": reduce(lambda x, d, k: x.amax(d, keepdim=k)),
    "AddV2": lambda i, a: i[0] + i[1],
    "Add": lambda i, a: i[0] + i[1],
    "Sub": lambda i, a: i[0] - i[1],
    "Log": lambda i, a: torch.log(i[0]),
    "DivNoNan": lambda i, a: torch.where(i[1] == 0, torch.zeros_like(i[0]), i[0] / torch.where(i[1] == 0, torch.ones_like(i[1]), i[1])),
    "Sigmoid": lambda i, a: torch.sigmoid(i[0]),
    "Identity": lambda i, a: i[0],
    "ConcatV2": lambda i, a: torch.cat(i[:-1], int(_np(i[-1]))),
}
