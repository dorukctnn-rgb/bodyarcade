// What the leak runner decides from the numbers of each round (pure, so it has tests).
import type { QaSnapshot } from './instrument.ts';

export interface RoundState {
  round: number;
  heapMB: number;
  nodes: number;
  listeners: number;
  documents: number;
  qa: QaSnapshot;
  domNodes: number;
}

/** Compares the later rounds with the baseline (round 2). Exported for the tests. */
export function judge(rounds: readonly RoundState[], tolerance = 0.1, input: 'camera' | 'keyboard' = 'camera'): string[] {
  const problems: string[] = [];
  const base = rounds[1];
  if (!base || rounds.length < 3) return ['too few rounds to compare (need at least 3)'];
  for (const r of rounds.slice(2)) {
    const tag = `round ${r.round}`;
    for (const k of new Set([...Object.keys(base.qa.gl.live), ...Object.keys(r.qa.gl.live)])) {
      const a = base.qa.gl.live[k] ?? 0;
      const b = r.qa.gl.live[k] ?? 0;
      if (b > a) problems.push(`${tag}: WebGL ${k}s alive ${a} -> ${b} (created but not deleted)`);
    }
    if (r.qa.listeners.total > base.qa.listeners.total) {
      const grew = Object.entries(r.qa.listeners.byKey).filter(([k, n]) => n > (base.qa.listeners.byKey[k] ?? 0)).map(([k, n]) => `${k} ${(base.qa.listeners.byKey[k] ?? 0)} -> ${n}`);
      problems.push(`${tag}: listeners on the page ${base.qa.listeners.total} -> ${r.qa.listeners.total} (${grew.join(', ')})`);
    }
    if (r.qa.timers.intervals > base.qa.timers.intervals) problems.push(`${tag}: intervals ${base.qa.timers.intervals} -> ${r.qa.timers.intervals}`);
    if (r.qa.timers.raf > base.qa.timers.raf) problems.push(`${tag}: animation callbacks waiting ${base.qa.timers.raf} -> ${r.qa.timers.raf}`);
    if (r.qa.workers.live > base.qa.workers.live) problems.push(`${tag}: workers alive ${base.qa.workers.live} -> ${r.qa.workers.live}`);
    if (r.qa.audio.contexts - r.qa.audio.closed > Math.max(1, base.qa.audio.contexts - base.qa.audio.closed)) problems.push(`${tag}: audio contexts open ${r.qa.audio.contexts - r.qa.audio.closed}`);
    if (input === 'camera' && r.qa.tracks.live > 0) problems.push(`${tag}: ${r.qa.tracks.live} camera track(s) still live after leaving the game`);
    if (r.heapMB > base.heapMB * (1 + tolerance) + 2) problems.push(`${tag}: JavaScript heap ${base.heapMB} -> ${r.heapMB} MB after a collection (more than ${Math.round(tolerance * 100)} %)`);
    if (r.nodes > base.nodes * (1 + tolerance) + 100) problems.push(`${tag}: DOM nodes ${base.nodes} -> ${r.nodes}`);
    if (r.listeners > base.listeners * (1 + tolerance) + 20) problems.push(`${tag}: event listeners (Chrome) ${base.listeners} -> ${r.listeners}`);
    if (r.documents > base.documents) problems.push(`${tag}: documents ${base.documents} -> ${r.documents}`);
  }
  if (input === 'camera' && (rounds[0]?.qa.tracks.live ?? 0) > 0) problems.push('round 1: camera track still live after leaving the game');
  return problems;
}
