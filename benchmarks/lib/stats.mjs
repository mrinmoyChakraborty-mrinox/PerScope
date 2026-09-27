/* PerScope benchmark harness — statistics helpers (pure, headless-testable).
   All latencies are milliseconds. Percentiles use the nearest-rank method
   on sorted values; small-n stats are reported as-is (n is always shown
   so nobody mistakes n=3 for a distribution). */

export function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function sorted(xs) {
  return [...xs].sort((a, b) => a - b);
}

export function median(xs) {
  if (!xs.length) return null;
  const s = sorted(xs);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = sorted(xs);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length)));
  return s[rank - 1];
}

export function summarize(values) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return { n: 0, mean: null, median: null, p95: null, min: null, max: null, std: null };
  return {
    n: xs.length,
    mean: round1(mean(xs)),
    median: round1(median(xs)),
    p95: round1(percentile(xs, 95)),
    min: round1(Math.min(...xs)),
    max: round1(Math.max(...xs)),
    std: round1(std(xs)),
  };
}

export function round1(v) {
  return v === null || v === undefined ? null : Math.round(v * 10) / 10;
}

/* Least-squares slope of y over x (used for heap drift: bytes per run).
   Returns null when there is no variance in x. */
export function slope(points) {
  if (points.length < 2) return null;
  const n = points.length;
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

/* Group steady-run stage latencies: { STAGE: [ms...] } -> { STAGE: summary } */
export function summarizeStages(runs) {
  const byStage = new Map();
  for (const run of runs) {
    for (const s of run.stages || []) {
      if (typeof s.ms !== "number") continue;
      if (!byStage.has(s.stage)) byStage.set(s.stage, []);
      byStage.get(s.stage).push(s.ms);
    }
  }
  const out = {};
  for (const [stage, xs] of byStage) out[stage] = summarize(xs);
  return out;
}
