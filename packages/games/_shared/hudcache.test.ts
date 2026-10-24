// The HUD writer: a slot is written once per value, a one-player run writes the plain score, combo and reason even to the shell's
// HUD (which has plates per player in every run, and so has setPlayer), and a two-player run writes per player and never the plain
// slots (the duo HUD has no plate for them). The first run on the real HUD in a browser found the plain slots silent.
import { describe, expect, it } from 'vitest';
import type { Hud, HudSlot } from '../../core/types/index.ts';
import { HudWriter } from './hudcache.ts';

function spy(plates: boolean): { hud: Hud; log: string[] } {
  const log: string[] = [];
  const hud: Hud & { setPlayer?: (p: number, slot: string, v: unknown) => void } = {
    set: (slot: HudSlot, v) => { log.push(`${slot}=${JSON.stringify(v)}`); },
    announce: () => undefined,
    toast: () => undefined,
  };
  if (plates) hud.setPlayer = (p, slot, v) => { log.push(`${slot}${p}=${JSON.stringify(v)}`); };
  return { hud, log };
}

describe('a one-player run', () => {
  it('writes the plain slots to a HUD that has plates per player', () => {
    const { hud, log } = spy(true);
    const w = new HudWriter(hud);
    w.setPlayers(1);
    w.set('score', 120);
    w.set('combo', 3);
    w.set('hint', 'Hold it longer');
    w.set('timer', 20);
    expect(log).toEqual(['score=120', 'combo=3', 'hint="Hold it longer"', 'timer=20']);
  });

  it('writes the plain slots to a HUD that has none, and Player 1 goes to the plain slots too', () => {
    const { hud, log } = spy(false);
    const w = new HudWriter(hud);
    w.setPlayers(1);
    w.set('score', 5);
    w.setPlayer(1, 'score', 7);
    w.setPlayer(2, 'hint', 'never seen');
    expect(log).toEqual(['score=5', 'score=7']);
  });

  it('writes a value once, and again when it changes or after a reset', () => {
    const { hud, log } = spy(true);
    const w = new HudWriter(hud);
    w.setPlayers(1);
    w.set('score', 1);
    w.set('score', 1);
    w.set('score', 2);
    w.reset();
    w.set('score', 2);
    expect(log).toEqual(['score=1', 'score=2', 'score=2']);
  });
});

describe('a two-player run', () => {
  it('writes per player and never the plain score, combo, reason or lives', () => {
    const { hud, log } = spy(true);
    const w = new HudWriter(hud);
    w.setPlayers(2);
    w.set('score', 1);
    w.set('combo', 1);
    w.set('hint', 'x');
    w.set('lives', 3);
    w.set('timer', 40);
    w.set('prompt', { icon: 'tPose', text: 'Match it' });
    w.setPlayer(1, 'score', 10);
    w.setPlayer(2, 'hint', 'Left arm off the shape');
    expect(log).toEqual(['timer=40', 'prompt={"icon":"tPose","text":"Match it"}', 'score1=10', 'hint2="Left arm off the shape"']);
  });

  it('the next run, with one player, writes the plain slots again', () => {
    const { hud, log } = spy(true);
    const w = new HudWriter(hud);
    w.setPlayers(2);
    w.set('score', 1);
    w.setPlayers(1);
    w.reset();
    w.set('score', 1);
    expect(log).toEqual(['score=1']);
  });
});
