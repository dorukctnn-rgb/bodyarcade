// Controlled faults on real traces (semi-synthetic, SPEC.md 10): which fixture, which fault, which rule should fire.
// expect: 'flagged' (default) = every counted repetition carries the rule; 'not-counted' = the fault makes the movement too
// small to count and the coach must say `cue`; 'below-threshold' = measured and reported, not asserted (a known limit).
import type { Trace } from '../../packages/core/types/index.ts';
import type { FormMoveId } from '../../packages/core/form/types.ts';
import { ARMS, LEFT_ARM, hips, kneesIn, lagArm, shrinkRange } from './perturb.ts';
import { restIndex } from './run-lib.ts';

export interface FaultCase { fixture: string; move: FormMoveId; fault: string; rule: string; make: (t: Trace) => Trace; expect?: 'flagged' | 'not-counted' | 'below-threshold'; cue?: string }

export const FAULTS: FaultCase[] = [
  ...['sq-mixkit-52106-front', 'sq-tf-goblet-front', 'sq-mixkit-752-45', 'sq-tf-frontraise-side'].map((fixture) => ({ fixture, move: 'squat' as const, fault: 'half range (x0.5)', rule: 'squat.depth', make: (t: Trace) => shrinkRange(t, 0.5, undefined, restIndex('squat', t)) })),
  ...['sq-mixkit-52106-front', 'sq-tf-goblet-front'].map((fixture) => ({ fixture, move: 'squat' as const, fault: 'knees 0.1 leg inside the hip-ankle line at the bottom', rule: 'squat.kneesIn', make: (t: Trace) => kneesIn(t, 0.1, restIndex('squat', t)) })),
  ...['pu-interval-side', 'pu-tf-crush-side'].flatMap((fixture) => [
    { fixture, move: 'pushUp' as const, fault: 'hips sag (0.35 torso)', rule: 'pushUp.line', make: (t: Trace) => hips(t, 0.35) },
    { fixture, move: 'pushUp' as const, fault: 'hips piked (0.35 torso)', rule: 'pushUp.line', make: (t: Trace) => hips(t, -0.35) },
  ]),
  // no shallow push-up here: pulling the landmarks towards the top position keeps the hips high while the shoulders go down
  // (a pike that a real push-up never has); shallow push-ups wait for real recordings (SPEC.md 7.3)
  ...['sp-mixkit-42899-front', 'sp-cdc-seated-close', 'sp-colossus-45-close'].flatMap((fixture) => [
    { fixture, move: 'dbShoulderPress' as const, fault: 'left arm only half way up', rule: 'press.together', make: (t: Trace) => shrinkRange(t, 0.5, LEFT_ARM, restIndex('dbShoulderPress', t)) },
    { fixture, move: 'dbShoulderPress' as const, fault: 'left arm 0.6 s behind', rule: 'press.together', expect: 'below-threshold' as const, make: (t: Trace) => lagArm(t, 18) },
    { fixture, move: 'dbShoulderPress' as const, fault: 'arms stop short (x0.6)', rule: 'press.top', make: (t: Trace) => shrinkRange(t, 0.6, ARMS, restIndex('dbShoulderPress', t)) },
  ]),
];
