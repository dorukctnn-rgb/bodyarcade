// The audit's simbot (audit-harness/simbot.mjs) as a reusable player: given what the run shows next, it decides the
// lane, the crouch and the jump. 'perfect' acts with time to spare, 'late' too late, 'idle' never moves.
export type BotMode = 'perfect' | 'late' | 'idle';

export interface BotView { next(): { move: string; eta: number } | null }

export interface BotAction { lane: number; crouch: number; jump: boolean }

const LEAD = {
  perfect: { hurdle: 0.4, duck: 0.8, squat: 0.8, wall: 0.9 },
  late: { hurdle: 0.02, duck: 0.1, squat: 0.1, wall: 0.1 },
} as const;

export function botAction(run: BotView, mode: BotMode): BotAction {
  const a: BotAction = { lane: 0, crouch: 0, jump: false };
  if (mode === 'idle') return a;
  const n = run.next();
  if (!n) return a;
  const L = LEAD[mode];
  if (n.move === 'hurdle') a.jump = n.eta < L.hurdle;
  else if (n.move === 'duck' || n.move === 'squat') a.crouch = n.eta < L.duck ? 1 : 0;
  else if (n.move === 'wallL') a.lane = n.eta < L.wall ? -1 : 0;
  else if (n.move === 'wallR') a.lane = n.eta < L.wall ? 1 : 0;
  return a;
}
