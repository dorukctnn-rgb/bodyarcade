// The keys and the swipes of the three games of builder G1, through the platform's real input hub: a player without a camera
// (and the accessibility route, tech.md 4.5) must be able to play every game end to end with a keyboard or a finger.
import { describe, expect, it } from 'vitest';
import type { GameModule, InputFrame, KeyMap, TouchMap } from '../../core/types/index.ts';
import { createInputHub } from '../../core/input/hub.ts';
import kneeSprint from '../knee-sprint/index.ts';
import squatFlap from '../squat-flap/index.ts';
import summitClimb from '../summit-climb/index.ts';

function rig(controls: { keys?: KeyMap; touch?: TouchMap }) {
  const clock = { t: 1000 };
  const hub = createInputHub({ now: () => clock.t });
  const keys = new EventTarget();
  const el = new EventTarget() as unknown as HTMLElement;
  if (controls.keys) hub.bindKeyboard(controls.keys, keys);
  if (controls.touch) hub.bindTouch(el, controls.touch);
  const down = (k: string, repeat = false): void => { keys.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: k, repeat, metaKey: false, ctrlKey: false, altKey: false })); };
  const up = (k: string): void => { keys.dispatchEvent(Object.assign(new Event('keyup', { cancelable: true }), { key: k, repeat: false, metaKey: false, ctrlKey: false, altKey: false })); };
  const gesture = (dx: number, dy: number, ms = 100): void => {
    el.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 1, clientX: 200, clientY: 300 }));
    clock.t += ms;
    el.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy }));
  };
  const sample = (advance = 0): InputFrame => { clock.t += advance; return hub.sample(clock.t); };
  return { hub, clock, down, up, tap: () => gesture(2, 2, 80), swipe: gesture, sample };
}

const ids = (f: InputFrame): string[] => f.events.map((e) => `${e.id}:${e.kind}:${e.source}`);

const controlsOf = (m: GameModule) => ({ ...(m.controls?.keys ? { keys: m.controls.keys } : {}), ...(m.controls?.touch ? { touch: m.controls.touch } : {}) });

describe('Squat Flap: keys and swipes', () => {
  it('space, the up arrow and W flap; the down arrow glides while it is held; a tap flaps, a swipe down glides for a moment', () => {
    const r = rig(controlsOf(squatFlap));
    r.down(' ');
    expect(ids(r.sample())).toEqual(['squat:rep:keyboard']);
    r.down(' ', true);
    expect(r.sample().events).toEqual([]);
    r.down('ArrowDown');
    expect(r.sample().channels['glide']).toBe(1);
    r.up('ArrowDown');
    expect(r.sample().channels['glide'] ?? 0).toBe(0);
    r.tap();
    expect(ids(r.sample())).toEqual(['squat:rep:touch']);
    r.swipe(0, 90);
    expect(r.sample().channels['glide']).toBe(1);
    expect(r.sample(1200).channels['glide'] ?? 0).toBe(0);
  });
});

describe('Knee Sprint: keys and swipes', () => {
  it('the arrows (or A and D) step, Space, the up arrow and W jump; a tap steps and a swipe up jumps', () => {
    const r = rig(controlsOf(kneeSprint));
    for (const k of ['ArrowLeft', 'ArrowRight', 'a', 'd']) { r.down(k); r.up(k); }
    expect(ids(r.sample())).toEqual(Array(4).fill('kneeLift:rep:keyboard'));
    for (const k of [' ', 'ArrowUp', 'w']) { r.down(k); r.up(k); }
    expect(ids(r.sample())).toEqual(Array(3).fill('jump:rep:keyboard'));
    r.tap();
    expect(ids(r.sample())).toEqual(['kneeLift:rep:touch']);
    r.swipe(0, -90);
    expect(ids(r.sample())).toEqual(['jump:rep:touch']);
  });
});

describe('Summit Climb: keys and swipes', () => {
  it('space, the up arrow and W pull a hand; the down arrow and S step up a ledge', () => {
    const r = rig(controlsOf(summitClimb));
    for (const k of [' ', 'ArrowUp', 'w']) { r.down(k); r.up(k); }
    expect(ids(r.sample())).toEqual(Array(3).fill('pull:rep:keyboard'));
    for (const k of ['ArrowDown', 's']) { r.down(k); r.up(k); }
    expect(ids(r.sample())).toEqual(Array(2).fill('kneeLift:rep:keyboard'));
  });

  it('the left and right arrows (or A and D) lean for as long as they are held, and let go in the middle', () => {
    const r = rig(controlsOf(summitClimb));
    expect(r.sample().channels['lane'] ?? 0).toBe(0);
    r.down('ArrowLeft');
    expect(r.sample().channels['lane']).toBe(-1);
    r.up('ArrowLeft');
    expect(r.sample().channels['lane'] ?? 0).toBe(0);
    r.down('d');
    expect(r.sample().channels['lane']).toBe(1);
    r.up('d');
    expect(r.sample().channels['lane'] ?? 0).toBe(0);
  });

  it('a tap and a swipe up pull, a swipe down steps up; a swipe to the side leans long enough for a rock to land and then lets go', () => {
    const r = rig(controlsOf(summitClimb));
    r.tap();
    r.swipe(0, -90);
    expect(ids(r.sample())).toEqual(['pull:rep:touch', 'pull:rep:touch']);
    r.swipe(0, 90);
    expect(ids(r.sample())).toEqual(['kneeLift:rep:touch']);
    r.swipe(-90, 0);
    expect(r.sample().channels['lane']).toBe(-1);
    // The rock's warning is 1.6 seconds and it lands at the end of it: still leaning then, in the middle again a little later.
    expect(r.sample(1500).channels['lane']).toBe(-1);
    expect(r.sample(500).channels['lane'] ?? 0).toBe(0);
    r.swipe(90, 0);
    expect(r.sample().channels['lane']).toBe(1);
  });
});
