// A drawing context that writes down what it is asked to do, for tests that run in Node. Not part of the kit.
import type { Ctx2D, Surface, SurfaceFactory } from '../ctx.ts';

export interface Call { name: string; args: unknown[] }

export interface Recorder extends Ctx2D {
  calls: Call[];
  /** Style and state values at the moment of each paint call, for checking colours and widths of strokes and fills. */
  log: { name: string; fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalAlpha: number; op: string }[];
  count(name: string): number;
  reset(): void;
}

const METHODS = ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'rect', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'translate', 'rotate', 'scale', 'setTransform'] as const;
const PAINT = new Set(['stroke', 'fill', 'fillRect', 'strokeRect', 'drawImage']);

export function recorder(): Recorder {
  const state = { fillStyle: '#000' as unknown, strokeStyle: '#000' as unknown, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: 'transparent', imageSmoothingEnabled: true };
  const r = {
    calls: [] as Call[],
    log: [] as Recorder['log'],
    count(name: string): number { return r.calls.filter((c) => c.name === name).length; },
    reset(): void { r.calls.length = 0; r.log.length = 0; },
    createLinearGradient: (...a: unknown[]) => { r.calls.push({ name: 'createLinearGradient', args: a }); return { addColorStop: () => undefined } as unknown as CanvasGradient; },
    createRadialGradient: (...a: unknown[]) => { r.calls.push({ name: 'createRadialGradient', args: a }); return { addColorStop: () => undefined } as unknown as CanvasGradient; },
  } as unknown as Recorder & Record<string, unknown>;
  for (const m of METHODS) {
    (r as Record<string, unknown>)[m] = (...args: unknown[]): void => {
      r.calls.push({ name: m, args });
      if (PAINT.has(m)) {
        r.log.push({ name: m, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, lineWidth: state.lineWidth, globalAlpha: state.globalAlpha, op: state.globalCompositeOperation });
      }
    };
  }
  for (const k of Object.keys(state) as (keyof typeof state)[]) {
    Object.defineProperty(r, k, { get: () => state[k], set: (v) => { (state as Record<string, unknown>)[k] = v; }, enumerable: true });
  }
  return r;
}

export interface FakeSurface extends Surface { ctx: Recorder }

/** A surface factory that remembers every surface it made, so a test can count the live ones. */
export function fakeSurfaces(): { factory: SurfaceFactory; made: FakeSurface[]; live(): number } {
  const made: FakeSurface[] = [];
  return {
    made,
    factory: (width, height) => {
      const ctx = recorder();
      const s: FakeSurface = { width, height, ctx, getContext: () => ctx };
      made.push(s);
      return s;
    },
    live: () => made.filter((s) => s.width > 0 && s.height > 0).length,
  };
}
