// Ritmo: tempo, seguimiento de tiempos y compás. Algoritmo propio basado en la autocorrelación de la
// función de ataque (con preferencia por tempos comunes) y programación dinámica (estilo Ellis 2007).

/** Tempo en bpm a partir de la función de ataque `env` (cuadros por segundo `fps`). */
export function estimateTempo(env: Float32Array, fps: number, lo = 50, hi = 210): { bpm: number; conf: number } {
  const n = env.length;
  if (n < fps * 3) return { bpm: 120, conf: 0 };
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  const x = Float32Array.from(env, (v) => v - mean);
  const maxLag = Math.min(n - 1, Math.ceil((60 / lo) * fps * 2) + 2);
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    ac[lag] = s / (n - lag);
  }
  // Puntaje por bpm: autocorrelación en el periodo + la mitad de su doble (refuerza el pulso real),
  // ponderada por una preferencia log-normal centrada en ~110 bpm (los tempos más comunes).
  let best = 120, bestScore = -Infinity;
  const all: number[] = [];
  const at = (lag: number) => {
    const l = Math.floor(lag), f = lag - l;
    return l + 1 <= maxLag ? ac[l] * (1 - f) + ac[l + 1] * f : 0;
  };
  for (let bpm = lo; bpm <= hi; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    const s = (at(lag) + 0.5 * at(lag * 2) + 0.25 * at(lag / 2)) * Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    all.push(s);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  // Confianza: qué tanto sobresale el mejor tempo sobre el resto (prominencia sobre la mediana).
  all.sort((a, b) => a - b);
  const med = all[all.length >> 1];
  const conf = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - Math.max(0, med)) / bestScore)) : 0;
  return { bpm: Math.round(best * 2) / 2, conf };
}

/**
 * Seguimiento de tiempos por programación dinámica: cada tiempo cae en un ataque fuerte y la
 * separación entre tiempos se parece al periodo del tempo. Devuelve los tiempos en segundos.
 */
export function trackBeats(env: Float32Array, fps: number, bpm: number, tightness = 100): number[] {
  const n = env.length;
  const period = (60 / bpm) * fps;
  if (n < period * 2) return [];
  let sd = 0, mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  for (const v of env) sd += (v - mean) * (v - mean);
  sd = Math.sqrt(sd / n) || 1;
  const o = Float32Array.from(env, (v) => v / sd);
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestV = -Infinity, bestI = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const r = Math.log((t - tau) / period);
      const v = score[tau] - tightness * r * r;
      if (v > bestV) { bestV = v; bestI = tau; }
    }
    score[t] = o[t] + (bestI >= 0 ? bestV : 0);
    back[t] = bestI;
  }
  // El último tiempo: el mejor puntaje dentro del último periodo.
  let end = n - 1, bestEnd = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t; }
  const out: number[] = [];
  for (let t = end; t >= 0; t = back[t]) out.push(t / fps);
  out.reverse();
  // Rellena hacia el inicio y el final si la canción empieza o termina sin ataques claros.
  const p = 60 / bpm;
  while (out.length && out[0] - p > 0.05) out.unshift(out[0] - p);
  const dur = n / fps;
  while (out.length && out[out.length - 1] + p < dur - 0.05) out.push(out[out.length - 1] + p);
  return out;
}

/** Valor de una función por cuadro en un instante (máximo en ±40 ms, para tolerar errores de fase). */
export function valueAt(x: Float32Array, fps: number, t: number, tol = 0.04): number {
  const a = Math.max(0, Math.floor((t - tol) * fps)), b = Math.min(x.length - 1, Math.ceil((t + tol) * fps));
  let m = 0;
  for (let i = a; i <= b; i++) if (x[i] > m) m = x[i];
  return m;
}

/**
 * Compás (3 o 4 tiempos) y fase del primer tiempo fuerte. `accent[k]` mide qué tan «de inicio de
 * compás» es el tiempo k: ataques del bajo, cambios de armonía, fuerza del golpe.
 */
export function meterAndDownbeat(accent: number[]): { meter: 3 | 4; downbeat: number; conf: number } {
  const n = accent.length;
  if (n < 8) return { meter: 4, downbeat: 0, conf: 0 };
  const res: { meter: 3 | 4; phase: number; s: number }[] = [];
  for (const m of [3, 4] as const) for (let ph = 0; ph < m; ph++) {
    let on = 0, cOn = 0, off = 0, cOff = 0;
    for (let k = 0; k < n; k++) { if ((k - ph) % m === 0) { on += accent[k]; cOn++; } else { off += accent[k]; cOff++; } }
    const s = on / Math.max(1, cOn) - off / Math.max(1, cOff);
    res.push({ meter: m, phase: ph, s: m === 3 ? s * 0.8 : s }); // 4/4 es mucho más común
  }
  res.sort((a, b) => b.s - a.s);
  const best = res[0], alt = res[1];
  return { meter: best.meter, downbeat: best.phase, conf: best.s > 0 ? Math.min(1, (best.s - Math.max(0, alt.s)) / best.s + 0.2) : 0 };
}
