# Exporta Demucs v4 de 6 fuentes (htdemucs_6s, Meta, licencia MIT) a ONNX para el modo «Fiel» de MusicFees.
# La STFT/ISTFT queda fuera de la red (ONNX no las tiene; la app las hace en src/transcribe/demucs.ts).
# Solo usa el paquete oficial `demucs` de PyPI y el checkpoint oficial, comprobado por su huella sha256
# (empieza con 34c22ccb, igual que su nombre). Lo corre GitHub Actions antes de compilar.
#
#   python scripts/export-demucs.py <checkpoint 5c90dfd2-34c22ccb.th> <carpeta de salida>
#
# Salida: htdemucs_6s.graph.onnx (la red, ~5 MB), htdemucs_6s.graph39.onnx (trozos de 3,9 s) y htdemucs_6s.f16 (pesos en float16, ~55 MB: los mismos
# del checkpoint, que ya viene en float16). La app convierte los pesos a float32 al cargarlos.
import hashlib, os
import sys, math, fractions, torch
from torch.nn import functional as F
import demucs.htdemucs as H
from einops import rearrange

torch.serialization.add_safe_globals([fractions.Fraction, H.HTDemucs])
# El oficial se comprueba por su huella; uno afinado por nosotros (scripts/train) se acepta tal cual.
if os.path.basename(sys.argv[1]).startswith("5c90dfd2") and not hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest().startswith("34c22ccb"):
    sys.exit("El checkpoint no es el oficial (sha256 distinto).")
pkg = torch.load(sys.argv[1], map_location="cpu", weights_only=True)
model = H.HTDemucs(*pkg["args"], **pkg["kwargs"])
model.load_state_dict(pkg["state"])
model.eval()
L = int(model.segment * model.samplerate)


def core(self, mix, x):
    """Igual que HTDemucs.forward, pero recibe el espectro (complejo como canales) y devuelve
    la salida de la rama de frecuencia (antes de la ISTFT) y la de la rama de tiempo."""
    B, C, Fq, T = x.shape
    mean = x.mean(dim=(1, 2, 3), keepdim=True)
    std = x.std(dim=(1, 2, 3), keepdim=True)
    x = (x - mean) / (1e-5 + std)
    xt = mix
    meant = xt.mean(dim=(1, 2), keepdim=True)
    stdt = xt.std(dim=(1, 2), keepdim=True)
    xt = (xt - meant) / (1e-5 + stdt)
    saved, saved_t, lengths, lengths_t = [], [], [], []
    for idx, encode in enumerate(self.encoder):
        lengths.append(x.shape[-1])
        inject = None
        if idx < len(self.tencoder):
            lengths_t.append(xt.shape[-1])
            tenc = self.tencoder[idx]
            xt = tenc(xt)
            if not tenc.empty:
                saved_t.append(xt)
            else:
                inject = xt
        x = encode(x, inject)
        if idx == 0 and self.freq_emb is not None:
            frs = torch.arange(x.shape[-2], device=x.device)
            emb = self.freq_emb(frs).t()[None, :, :, None].expand_as(x)
            x = x + self.freq_emb_scale * emb
        saved.append(x)
    if self.crosstransformer:
        if self.bottom_channels:
            b, c, f, t = x.shape
            x = rearrange(x, "b c f t-> b c (f t)")
            x = self.channel_upsampler(x)
            x = rearrange(x, "b c (f t)-> b c f t", f=f)
            xt = self.channel_upsampler_t(xt)
        x, xt = self.crosstransformer(x, xt)
        if self.bottom_channels:
            x = rearrange(x, "b c f t-> b c (f t)")
            x = self.channel_downsampler(x)
            x = rearrange(x, "b c (f t)-> b c f t", f=f)
            xt = self.channel_downsampler_t(xt)
    for idx, decode in enumerate(self.decoder):
        skip = saved.pop(-1)
        x, pre = decode(x, skip, lengths.pop(-1))
        offset = self.depth - len(self.tdecoder)
        if idx >= offset:
            tdec = self.tdecoder[idx - offset]
            length_t = lengths_t.pop(-1)
            if tdec.empty:
                pre = pre[:, :, 0]
                xt, _ = tdec(pre, None, length_t)
            else:
                skip = saved_t.pop(-1)
                xt, _ = tdec(xt, skip, length_t)
    S = len(self.sources)
    x = x.view(B, S, -1, Fq, T)
    x = x * std[:, None] + mean[:, None]
    xt = xt.view(B, S, -1, mix.shape[-1])
    xt = xt * stdt[:, None] + meant[:, None]
    return x, xt


class Core(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, mix, x):
        return core(self.m, mix, x)


def spec(mix):
    z = model._spec(mix)
    return model._magnitude(z)


if __name__ == "__main__":
    import numpy as np, onnx
    from onnx import numpy_helper
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    print("segment", float(model.segment), "L", L, "sources", model.sources, "params", sum(p.numel() for p in model.parameters()))
    w = torch.randn(1, 2, L)
    mag = spec(w)
    # Comprobación: núcleo + ISTFT == forward original.
    with torch.no_grad():
        ref = model(w)
        x, xt = Core(model)(w, mag)
        z = model._mask(model._spec(w), x)
        diff = float((model._ispec(z, L) + xt - ref).abs().max())
    print("diferencia con el original", diff)
    assert diff < 1e-4
    # Dos redes con los mismos pesos: trozos de 7,8 s (la original) y de 3,9 s (la mitad de memoria, para
    # teléfonos). Se comparten los pesos (mismo orden de inicializadores).
    for seg, name in ((L, "graph"), (L // 2, "graph39")):
        full = os.path.join(out, "full.onnx")
        w = torch.randn(1, 2, seg)
        torch.onnx.export(Core(model), (w, spec(w)), full, export_params=True, opset_version=17, do_constant_folding=True,
                          input_names=["mix", "spec"], output_names=["freq", "time"], dynamo=False)
        m = onnx.load(full)
        offset, f16 = 0, []
        for t in m.graph.initializer:
            if t.data_type != onnx.TensorProto.FLOAT or np.prod(t.dims) < 16:
                continue
            a = numpy_helper.to_array(t).astype(np.float32)
            t.ClearField("raw_data"); t.ClearField("float_data")
            t.data_location = onnx.TensorProto.EXTERNAL
            del t.external_data[:]
            for k, v in (("location", "htdemucs_6s.data"), ("offset", str(offset * 4)), ("length", str(a.size * 4))):
                e = t.external_data.add(); e.key = k; e.value = v
            f16.append(a.astype(np.float16).ravel()); offset += a.size
        onnx.save(m, os.path.join(out, f"htdemucs_6s.{name}.onnx"))
        w16 = np.concatenate(f16)
        path = os.path.join(out, "htdemucs_6s.f16")
        if name == "graph": w16.tofile(path)
        else: assert np.array_equal(np.fromfile(path, dtype=np.float16), w16), "los pesos de las dos redes deben coincidir"
        os.remove(full)
    print("listo:", out)
