// Percentiles of a list of numbers, rounded for reports.
export interface Stats { p50: number; p95: number; p99: number; max: number }

export function stats(values: readonly number[]): Stats {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number): number => v[Math.min(v.length - 1, Math.floor(q * v.length))] as number;
  const r = (x: number): number => Math.round(x * 100) / 100;
  return { p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(v[v.length - 1] as number) };
}

/** What the whole machine did with its processors between two looks: the share of time they were busy, 0 to 1. */
export interface CpuLook { idle: number; total: number }

export function cpuLook(cpus: readonly { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): CpuLook {
  let idle = 0;
  let total = 0;
  for (const c of cpus) { idle += c.times.idle; total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq; }
  return { idle, total };
}

export function busyBetween(a: CpuLook, b: CpuLook): number {
  const total = b.total - a.total;
  return total > 0 ? Math.round((1 - (b.idle - a.idle) / total) * 1000) / 1000 : 0;
}
