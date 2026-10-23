// Weather: the particles stay in their box for ever, the same seed gives the same sky, a tier only changes how many are
// drawn (and moved), and the kit frees what it made.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../loop/rng.ts';
import { ResourceTracker } from './dispose.ts';
import { QUALITY_TIERS } from './quality.ts';
import { themeOrThrow, type WeatherDef } from './theme.ts';
import { createWeather, drawnParticles, HEAVY_COUNT, seedParticles, stepWeather, WEATHER_BOX } from './weather.ts';

const worlds = (JSON.parse(readFileSync(new URL('./themes/classic-worlds.json', import.meta.url), 'utf8')) as Record<string, unknown>[]).map((w) => themeOrThrow(w));
const withWeather = worlds.filter((w) => w.weather);
const T0 = QUALITY_TIERS[0], T1 = QUALITY_TIERS[1], T2 = QUALITY_TIERS[2];

describe('weather of the classic worlds', () => {
  it('has the five kinds in the live worlds: dust, leaves (two worlds), rain, snow, embers', () => {
    expect(withWeather.map((w) => w.weather!.kind).sort()).toEqual(['dust', 'embers', 'leaves', 'leaves', 'rain', 'snow']);
  });

  it.each(withWeather.map((w) => [w.id, w.weather!] as const))('%s: particles stay inside the box over two minutes of frames', (_id, def) => {
    const rng = mulberry32(5);
    const p = new Float32Array(def.count * 3);
    seedParticles(p, def.count, rng);
    let t = 0;
    for (let frame = 0; frame < 7200; frame++) {
      const dt = 1 / 60;
      t += dt;
      stepWeather(p, def.count, def, dt, 0.18 * (1 + (frame % 7) / 20), t, rng);
      if (frame % 600 === 599) {
        for (let i = 0; i < def.count; i++) {
          expect(Math.abs(p[i * 3]!)).toBeLessThanOrEqual(WEATHER_BOX.x + Math.abs(def.drift) * 60);   // drift may carry a little past the spawn width
          expect(p[i * 3 + 1]).toBeGreaterThanOrEqual(0);
          expect(p[i * 3 + 1]).toBeLessThanOrEqual(WEATHER_BOX.top);
          expect(p[i * 3 + 2]).toBeLessThanOrEqual(WEATHER_BOX.near);
          expect(p[i * 3 + 2]).toBeGreaterThanOrEqual(WEATHER_BOX.far - 1);
        }
      }
    }
  });

  it('the same seed gives the same sky, another seed another', () => {
    const def = worlds.find((w) => w.id === 'storm')!.weather!;
    const run = (seed: number): Float32Array => {
      const rng = mulberry32(seed);
      const p = new Float32Array(def.count * 3);
      seedParticles(p, def.count, rng);
      for (let i = 0; i < 300; i++) stepWeather(p, def.count, def, 1 / 60, 0.2, i / 60, rng);
      return p;
    };
    expect(Array.from(run(1))).toEqual(Array.from(run(1)));
    expect(Array.from(run(1))).not.toEqual(Array.from(run(2)));
  });

  it('rain falls, embers rise, snow and leaves drift sideways', () => {
    const rng = mulberry32(1);
    const rain: WeatherDef = { kind: 'rain', count: 1, color: '#fff', size: 0.1, opacity: 1, fall: 20, drift: 0 };
    const p = new Float32Array([0, 10, -20]);
    stepWeather(p, 1, rain, 0.1, 0, 0, rng);
    expect(p[1]).toBeCloseTo(8, 6);
    const embers: WeatherDef = { kind: 'embers', count: 1, color: '#fff', size: 0.1, opacity: 1, fall: -4, drift: 0 };
    const e = new Float32Array([0, 10, -20]);
    stepWeather(e, 1, embers, 0.5, 0, 0, rng);
    expect(e[1]).toBeCloseTo(12, 6);
    const snow: WeatherDef = { kind: 'snow', count: 1, color: '#fff', size: 0.1, opacity: 1, fall: 2, drift: 3 };
    const s = new Float32Array([0, 10, -20]);
    stepWeather(s, 1, snow, 0.1, 0, Math.PI / 1.4, rng);   // sin(t * 0.7) = 1
    expect(s[0]).toBeCloseTo(0.3, 6);
  });

  it('a particle that hits the ground returns to the top; one that rises out of the box returns to the ground; one that passes the camera goes to the far end', () => {
    const rng = mulberry32(2);
    const def: WeatherDef = { kind: 'snow', count: 1, color: '#fff', size: 0.1, opacity: 1, fall: 5, drift: 0 };
    const p = new Float32Array([1, 0.01, 7.9]);
    stepWeather(p, 1, def, 0.1, 0.5, 0, rng);
    expect(p[1]).toBe(WEATHER_BOX.top);
    expect(p[2]).toBeCloseTo(7.9 + 0.4 - (WEATHER_BOX.near - WEATHER_BOX.far), 4);
    const up: WeatherDef = { kind: 'embers', count: 1, color: '#fff', size: 0.1, opacity: 1, fall: -5, drift: 0 };
    const q = new Float32Array([1, 15.9, 0]);
    stepWeather(q, 1, up, 0.1, 0, 0, rng);
    expect(q[1]).toBe(0);
  });
});

describe('tiers', () => {
  it('draw 20 % of heavy weather and 40 % of light weather at T0, everything at T1 and T2', () => {
    const rain = worlds.find((w) => w.id === 'storm')!.weather!;
    const dust = worlds.find((w) => w.id === 'desert')!.weather!;
    expect(rain.count).toBeGreaterThan(HEAVY_COUNT);
    expect(dust.count).toBeLessThan(HEAVY_COUNT);
    expect(drawnParticles(rain, T0)).toBe(Math.ceil(rain.count * 0.2));
    expect(drawnParticles(dust, T0)).toBe(Math.ceil(dust.count * 0.4));
    expect(drawnParticles(rain, T1)).toBe(rain.count);
    expect(drawnParticles(dust, T2)).toBe(dust.count);
  });

  it('a tier changes the draw range and only the drawn particles move', () => {
    const def = worlds.find((w) => w.id === 'storm')!.weather!;
    const tracker = new ResourceTracker();
    const kit = createWeather(def, tracker, mulberry32(3), T2);
    const pos = kit.points.geometry.getAttribute('position').array as Float32Array;
    expect(kit.points.geometry.drawRange.count).toBe(def.count);
    kit.applyTier(T0);
    expect(kit.drawn).toBe(Math.ceil(def.count * 0.2));
    expect(kit.points.geometry.drawRange.count).toBe(kit.drawn);
    const tail = Array.from(pos.slice(kit.drawn * 3, kit.drawn * 3 + 30));
    const head = Array.from(pos.slice(0, 30));
    kit.update(1 / 60, 0.2);
    expect(Array.from(pos.slice(kit.drawn * 3, kit.drawn * 3 + 30))).toEqual(tail);
    expect(Array.from(pos.slice(0, 30))).not.toEqual(head);
    kit.applyTier(T2);
    expect(kit.drawn).toBe(def.count);
    tracker.release();
  });

  it('rain uses the streak sprite at six times the size; embers add light; everything else is a round dot', () => {
    const tracker = new ResourceTracker();
    const rain = worlds.find((w) => w.id === 'storm')!.weather!;
    const embers = worlds.find((w) => w.id === 'volcano')!.weather!;
    const snow = worlds.find((w) => w.id === 'arctic')!.weather!;
    const a = createWeather(rain, tracker, mulberry32(1), T2), b = createWeather(embers, tracker, mulberry32(1), T2), c = createWeather(snow, tracker, mulberry32(1), T2);
    const mat = (k: typeof a): { size: number; blending: number; map: { image: { width: number; height: number } } } => k.points.material as never;
    expect(mat(a).size).toBeCloseTo(rain.size * 6, 9);
    expect(mat(c).size).toBeCloseTo(snow.size, 9);
    expect(mat(b).blending).toBe(2);   // THREE.AdditiveBlending
    expect(mat(a).blending).toBe(1);   // THREE.NormalBlending
    tracker.release();
  });

  it('owns one geometry, one material and one texture, and frees all of them', () => {
    const tracker = new ResourceTracker();
    createWeather(worlds.find((w) => w.id === 'arctic')!.weather!, tracker, mulberry32(1), T1);
    expect(tracker.counts()).toEqual({ geometries: 1, materials: 1, textures: 1, other: 0 });
    tracker.release();
    expect(tracker.empty).toBe(true);
  });
});
