// Particles: a fixed pool, deterministic from the seed, packed live particles, honest limits.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../loop/rng.ts';
import { createParticles } from './particles.ts';
import { recorder } from './testing/recorder.ts';

const make = (seed = 1, o = {}): ReturnType<typeof createParticles> => createParticles(mulberry32(seed), o);

describe('emitting', () => {
  it('a burst makes the particles asked for, at the given place, and reports how many', () => {
    const p = make();
    expect(p.burst(100, 200, 40)).toBe(40);
    expect(p.alive).toBe(40);
    expect(p.stats()).toMatchObject({ alive: 40, emitted: 40, dropped: 0, capacity: 600 });
  });

  it('a full pool ignores new particles and counts them, it never grows', () => {
    const p = make(1, { capacity: 50 });
    expect(p.burst(0, 0, 80)).toBe(50);
    expect(p.alive).toBe(50);
    expect(p.stats()).toMatchObject({ emitted: 80, dropped: 30 });
    expect(p.burst(0, 0, 10)).toBe(0);
  });

  it('the amount (reduced motion) scales every burst', () => {
    const p = make(1, { amount: 0.25 });
    expect(p.burst(0, 0, 40)).toBe(10);
    p.setAmount(0);
    expect(p.burst(0, 0, 40)).toBe(0);
    p.setAmount(5);
    expect(p.burst(0, 0, 40)).toBe(40);   // clamped to 1
  });

  it('confetti starts along the line it is given and falls', () => {
    const p = make();
    const pos: number[] = [];
    const draw = recorder();
    p.confetti(100, 0, 300, 60);
    p.update(0.5);
    p.draw(draw);
    expect(p.alive).toBe(60);
    for (const c of draw.calls.filter((c) => c.name === 'moveTo')) pos.push(c.args[0] as number);
    expect(Math.min(...pos)).toBeGreaterThan(60);
    expect(Math.max(...pos)).toBeLessThan(460);
  });
});

describe('motion', () => {
  it('particles with no gravity and no drag travel in a straight line at their speed', () => {
    const p = make();
    p.burst(0, 0, 1, { speed: [100, 100], angle: [0, 0], gravity: 0, drag: 0, life: [5, 5], size: [3, 3] });
    const c = recorder();
    p.update(0.5);
    p.draw(c);
    const arc = c.calls.find((x) => x.name === 'arc')!;
    expect(arc.args[0]).toBeCloseTo(50, 3);
    expect(arc.args[1]).toBeCloseTo(0, 3);
  });

  it('gravity pulls down, drag slows down', () => {
    const fall = make(), glide = make();
    fall.burst(0, 0, 1, { speed: [0, 0], gravity: 1000, drag: 0, life: [5, 5] });
    glide.burst(0, 0, 1, { speed: [200, 200], angle: [0, 0], gravity: 0, drag: 3, life: [5, 5] });
    const a = recorder(), b = recorder();
    for (let i = 0; i < 30; i++) { fall.update(1 / 60); glide.update(1 / 60); }
    fall.draw(a); glide.draw(b);
    expect(a.calls.find((x) => x.name === 'arc')!.args[1] as number).toBeGreaterThan(100);
    expect(b.calls.find((x) => x.name === 'arc')!.args[0] as number).toBeLessThan(100);
    expect(b.calls.find((x) => x.name === 'arc')!.args[0] as number).toBeGreaterThan(50);
  });

  it('particles die when their life is over and the live ones stay packed', () => {
    const p = make();
    p.burst(0, 0, 100, { life: [0.2, 1.0] });
    let prev = p.alive;
    for (let i = 0; i < 90; i++) { p.update(1 / 60); expect(p.alive).toBeLessThanOrEqual(prev); prev = p.alive; }
    expect(p.alive).toBe(0);
    // the pool is reusable after everything died
    expect(p.burst(0, 0, 100)).toBe(100);
  });

  it('removing particles in the middle does not disturb the ones that stay', () => {
    const p = make(3);
    p.burst(0, 0, 30, { life: [1, 1], speed: [0, 0], gravity: 0, drag: 0, size: [4, 4] });
    p.burst(500, 500, 30, { life: [0.1, 0.1], speed: [0, 0], gravity: 0, drag: 0, size: [4, 4] });
    p.update(0.2);
    expect(p.alive).toBe(30);
    const c = recorder();
    p.draw(c);
    for (const a of c.calls.filter((x) => x.name === 'arc')) { expect(a.args[0]).toBeCloseTo(0, 3); expect(a.args[1]).toBeCloseTo(0, 3); }
  });

  it('ignores a zero, negative or NaN step', () => {
    const p = make();
    p.burst(0, 0, 10, { life: [1, 1] });
    p.update(0); p.update(-1); p.update(NaN);
    expect(p.alive).toBe(10);
  });
});

describe('determinism', () => {
  const run = (seed: number): string => {
    const p = make(seed);
    p.burst(10, 20, 50, { shape: ['dot', 'square', 'star', 'spark'] });
    p.confetti(0, 0, 200, 30);
    const c = recorder();
    for (let i = 0; i < 40; i++) p.update(1 / 60);
    p.draw(c);
    return JSON.stringify(c.calls);
  };
  it('the same seed gives the same picture, another seed another', () => {
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });
});

describe('drawing', () => {
  it('draws one shape per particle, fades the dying ones, and leaves the context as it found it', () => {
    const p = make();
    p.burst(0, 0, 20, { life: [0.3, 0.3], shape: 'dot' });
    p.update(0.25);
    const c = recorder();
    p.draw(c);
    expect(c.count('fill')).toBe(20);
    expect(c.log.every((l) => l.name !== 'fill' || (l.globalAlpha > 0 && l.globalAlpha < 1))).toBe(true);
    expect(c.globalAlpha).toBe(1);
  });

  it('draws every shape kind', () => {
    for (const shape of ['dot', 'square', 'star', 'spark'] as const) {
      const p = make();
      p.burst(50, 50, 5, { shape, life: [1, 1] });
      const c = recorder();
      p.draw(c);
      expect(c.count('fill') + c.count('stroke')).toBe(5);
    }
  });

  it('draws nothing and touches nothing when empty', () => {
    const c = recorder();
    make().draw(c);
    expect(c.calls.length).toBe(0);
  });

  it('only changes the colour when it changes', () => {
    const p = make();
    p.burst(0, 0, 60, { colors: ['#ff0000', '#00ff00'], life: [1, 1] });
    const seen: unknown[] = [];
    const c = recorder();
    p.draw(c);
    for (const l of c.log) if (l.name === 'fill') seen.push(l.fillStyle);
    expect(new Set(seen)).toEqual(new Set(['#ff0000', '#00ff00']));
  });

  it('clear removes everything at once', () => {
    const p = make();
    p.burst(0, 0, 100);
    p.clear();
    expect(p.alive).toBe(0);
  });
});
