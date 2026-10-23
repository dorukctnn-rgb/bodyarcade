// What the three games of builder G1 (flight, sprint, climb) share. Everything exported here is pure (no DOM, no
// clock): the simulations import from this file. The drawing helpers (stage, pip, selfview) are imported by the views
// from their own files.
export { clamp, lerp, smoothstep, wave, median, round } from './math.ts';
export { newRound, stepRound, phaseLeft, roundSeconds, type RoundPlan, type RoundState, type RoundPhase, type RoundChange } from './rounds.ts';
export { lanesOf, ch, type LaneInput } from './lanes.ts';
export { createSay, fill, type Say, type StringTable, type StringTables } from './say.ts';
export { hudWriter, type HudWriter, type HudValue } from './hud.ts';
