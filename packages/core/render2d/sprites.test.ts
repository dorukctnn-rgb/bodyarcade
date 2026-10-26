// Sprites: every kind draws, shapes are what they claim to be, and the bank paints once, stamps often, stays bounded
// and gives its surfaces back.
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, drawSprite, heartPoints, SPRITE_KINDS, SpriteBank, starPoints } from './sprites.ts';
import { fakeSurfaces, recorder } from './testing/recorder.ts';

describe('shapes', () => {
  it('a star has twice as many corners as tips, alternating outer and inner radius, first tip straight up', () => {
    const pts = starPoints(5, 10, 4.6);
    expect(pts.length).toBe(10);
    expect(Math.hypot(...pts[0]!)).toBeCloseTo(10, 9);
    expect(Math.hypot(...pts[1]!)).toBeCloseTo(4.6, 9);
    expect(pts[0]![0]).toBeCloseTo(0, 9);
    expect(pts[0]![1]).toBeCloseTo(-10, 9);
  });

  it('a heart is symmetric about the vertical axis, two wide, and its point is at the bottom', () => {
    const pts = heartPoints(64);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(1, 1);
    expect(Math.min(...xs)).toBeCloseTo(-1, 1);
    expect(Math.max(...ys)).toBeGreaterThan(Math.abs(Math.min(...ys)) * 0.8);   // the tip hangs below the lobes
    for (const [x, y] of pts) expect(pts.some(([a, b]) => Math.abs(a + x) < 0.08 && Math.abs(b - y) < 0.08)).toBe(true);
    expect(Math.max(...ys)).toBeLessThan(1.2);
    expect(Math.min(...ys)).toBeGreaterThan(-1.2);
  });
});

describe('drawSprite', () => {
  it.each(SPRITE_KINDS.map((k) => [k]))('%s paints something, with the colours it was given', (kind) => {
    const c = recorder();
    drawSprite(c, kind, 100, 80, 30, { fill: '#112233', stroke: '#445566', glow: null });
    expect(c.count('fill')).toBeGreaterThan(0);
    expect(c.log.some((l) => l.fillStyle === '#112233' || kind === 'orb')).toBe(true);
  });

  it.each(SPRITE_KINDS.map((k) => [k]))('%s stays inside its radius (plus a stroke)', (kind) => {
    const c = recorder();
    drawSprite(c, kind, 0, 0, 50);
    for (const call of c.calls) {
      if (call.name !== 'moveTo' && call.name !== 'lineTo') continue;
      const [x, y] = call.args as number[];
      expect(Math.hypot(x!, y!)).toBeLessThanOrEqual(50 * 1.25);
    }
  });

  it('a turned star has its tips elsewhere', () => {
    const a = recorder(), b = recorder();
    drawSprite(a, 'star', 0, 0, 50, DEFAULT_STYLE, 0);
    drawSprite(b, 'star', 0, 0, 50, DEFAULT_STYLE, Math.PI / 5);
    expect(a.calls.find((x) => x.name === 'moveTo')!.args).not.toEqual(b.calls.find((x) => x.name === 'moveTo')!.args);
  });

  it('a style without an edge draws no edge', () => {
    const c = recorder();
    drawSprite(c, 'star', 0, 0, 20, { fill: '#fff', stroke: null, glow: null });
    expect(c.count('stroke')).toBe(0);
  });
});

describe('SpriteBank', () => {
  const make = (dpr = 2, max = 48): { bank: SpriteBank; s: ReturnType<typeof fakeSurfaces> } => {
    const s = fakeSurfaces();
    return { bank: new SpriteBank(s.factory, () => dpr, max), s };
  };

  it('paints a sprite once and stamps it from then on', () => {
    const { bank, s } = make();
    const ctx = recorder();
    for (let i = 0; i < 40; i++) bank.stamp(ctx, 'star', 30 + i * 5, 80, 40);
    expect(s.made.length).toBe(1);
    expect(bank.stats()).toMatchObject({ misses: 1, hits: 39, entries: 1 });
    expect(ctx.count('drawImage')).toBe(40);
    expect(s.made[0]!.ctx.count('fill')).toBeGreaterThan(0);
  });

  it('the bitmap is as sharp as the screen: size times pixel ratio, with room for a glow', () => {
    const { bank, s } = make(3);
    bank.get('orb', 40);
    expect(s.made[0]!.width).toBe(Math.ceil(40 * 1.6 * 3));
    const flat = make(1);
    flat.bank.get('orb', 40);
    expect(flat.s.made[0]!.width).toBe(64);
  });

  it('a new pixel ratio or style or size paints again; the same does not', () => {
    const s = fakeSurfaces();
    let ratio = 2;
    const bank = new SpriteBank(s.factory, () => ratio);
    bank.get('star', 40); bank.get('star', 40);
    ratio = 3;
    bank.get('star', 40);
    bank.get('star', 40, { fill: '#000', stroke: null, glow: null });
    bank.get('star', 44);
    expect(s.made.length).toBe(4);
  });

  it('stamps centred on the point, scaled to the size plus its margin', () => {
    const { bank } = make(2);
    const ctx = recorder();
    bank.stamp(ctx, 'ring', 200, 100, 50);
    const call = ctx.calls.find((c) => c.name === 'drawImage')!;
    const total = 50 * 1.6;
    expect(call.args.slice(1)).toEqual([200 - total / 2, 100 - total / 2, total, total]);
  });

  it('a turned stamp rotates about its centre and restores the context; alpha is restored too', () => {
    const { bank } = make();
    const ctx = recorder();
    ctx.globalAlpha = 0.8;
    bank.stamp(ctx, 'heart', 50, 60, 30, DEFAULT_STYLE, { rot: 0.5, alpha: 0.5 });
    expect(ctx.count('save')).toBe(ctx.count('restore'));
    expect(ctx.calls.find((c) => c.name === 'translate')!.args).toEqual([50, 60]);
    expect(ctx.log.find((l) => l.name === 'drawImage')!.globalAlpha).toBeCloseTo(0.4, 9);
    expect(ctx.globalAlpha).toBe(0.8);
    const none = recorder();
    bank.stamp(none, 'heart', 50, 60, 30, DEFAULT_STYLE, { alpha: 0 });
    expect(none.count('drawImage')).toBe(0);
  });

  it('is bounded: the least recently used is given back first', () => {
    const { bank, s } = make(1, 3);
    bank.get('star', 10); bank.get('ring', 10); bank.get('pad', 10);
    bank.get('star', 10);                      // star is fresh again
    bank.get('heart', 10);                     // evicts ring, the oldest
    expect(bank.stats()).toMatchObject({ entries: 3, evicted: 1 });
    expect(s.made[1]!.width).toBe(0);          // ring was given back
    expect(s.made[0]!.width).toBeGreaterThan(0);
    expect(s.live()).toBe(3);
  });

  it('clear and dispose give every surface back', () => {
    const { bank, s } = make();
    for (const k of SPRITE_KINDS) bank.get(k, 24);
    expect(s.live()).toBe(SPRITE_KINDS.length);
    bank.dispose();
    expect(s.live()).toBe(0);
    expect(bank.stats().entries).toBe(0);
  });

  it('a glow is painted into the bitmap, not into every stamp', () => {
    const { bank, s } = make();
    bank.get('orb', 30, { fill: '#fc0', stroke: null, glow: '#fc0' });
    expect(s.made[0]!.ctx.calls.length).toBeGreaterThan(3);
    expect(s.made[0]!.ctx.shadowBlur).toBeGreaterThan(0);
  });
});
