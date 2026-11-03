# Prepara Beat This! (CPJKU, MIT) para la app: separa la red de sus pesos y guarda los pesos en float16
# (la mitad: ~41 MB). La app los vuelve a float32 al cargar y se los pasa a ONNX Runtime como datos externos.
#
#   python scripts/pack-beatthis.py <beat_this.onnx> <carpeta de salida>
#
# Salida: beat_this.graph.onnx (red, ~1 MB, pesos referidos a «beat_this.data») y beat_this.f16.
import sys, os, hashlib
import numpy as np, onnx
from onnx import numpy_helper, TensorProto

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
m = onnx.load(src)
buf, off = [], 0
for t in m.graph.initializer:
    if t.data_type != TensorProto.FLOAT:
        continue
    a = numpy_helper.to_array(t).astype(np.float32)
    buf.append(a.ravel()); n = a.nbytes
    t.ClearField("raw_data"); t.ClearField("float_data")
    t.data_location = TensorProto.EXTERNAL
    del t.external_data[:]
    for k, v in (("location", "beat_this.data"), ("offset", str(off)), ("length", str(n))):
        e = t.external_data.add(); e.key, e.value = k, v
    off += n
w = np.concatenate(buf).astype(np.float16)
w.tofile(os.path.join(out, "beat_this.f16"))
onnx.save(m, os.path.join(out, "beat_this.graph.onnx"))
print("red", os.path.getsize(os.path.join(out, "beat_this.graph.onnx")), "bytes · pesos", w.nbytes, "bytes · sha256", hashlib.sha256(w.tobytes()).hexdigest()[:12])
