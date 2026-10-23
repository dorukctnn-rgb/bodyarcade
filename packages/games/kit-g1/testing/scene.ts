// A 2D scene on a recording canvas, for view tests in Node. The recorder of the 2D kit does not know text, gradients'
// colour stops or dashes, so it is extended here with no-ops that keep a log of the text drawn.
import { mulberry32 } from '../../../core/loop/rng.ts';
import { createScene2D, type CanvasLike, type Scene2DKit } from '../../../core/render2d/scene2d.ts';
import { fakeSurfaces, recorder, type Recorder } from '../../../core/render2d/testing/recorder.ts';
import type { HudMode, PipPlacement } from '../../../core/ui/layout.ts';

export interface TextRecorder extends Recorder {
  texts: { text: string; x: number; y: number; font: string }[];
}

export function textRecorder(): TextRecorder {
  const r = recorder() as TextRecorder & Record<string, unknown>;
  r.texts = [];
  r['font'] = '10px sans-serif';
  r['textAlign'] = 'left';
  r['textBaseline'] = 'alphabetic';
  r['lineDashOffset'] = 0;
  r['letterSpacing'] = '0px';
  r['fillText'] = (text: string, x: number, y: number): void => { r.texts.push({ text, x, y, font: String(r['font']) }); };
  r['strokeText'] = (): void => undefined;
  r['setLineDash'] = (): void => undefined;
  r['measureText'] = (text: string): { width: number } => ({ width: text.length * 0.55 * (Number.parseFloat(String(r['font']).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '10')) });
  r['createPattern'] = (): null => null;
  r['createConicGradient'] = (): { addColorStop(): void } => ({ addColorStop: () => undefined });
  r['isPointInPath'] = (): boolean => false;
  return r;
}

export interface TestScene {
  kit: Scene2DKit;
  ctx: TextRecorder;
  canvas: CanvasLike;
  surfaces: ReturnType<typeof fakeSurfaces>;
  size: { width: number; height: number };
}

/** The 2D kit over a recording canvas of the given CSS size. */
export function testScene(w = 390, h = 844, o: { dpr?: number; mode?: HudMode; corner?: PipPlacement; camAspect?: number } = {}): TestScene {
  const ctx = textRecorder();
  let width = 0, height = 0;
  const canvas = {
    get width() { return width; }, set width(v: number) { width = v; },
    get height() { return height; }, set height(v: number) { height = v; },
    clientWidth: w, clientHeight: h,
    getContext: () => ctx as unknown as CanvasRenderingContext2D,
  } as unknown as CanvasLike;
  (ctx as unknown as { canvas: unknown }).canvas = canvas;
  const surfaces = fakeSurfaces();
  const size = { width: w, height: h };
  const kit = createScene2D({ canvas, size: () => size, devicePixelRatio: () => o.dpr ?? 1, surfaces: surfaces.factory, rng: mulberry32(11) });
  if (o.camAspect) kit.setCamera(o.camAspect);
  kit.setHud({ mode: o.mode ?? 'scene', pipCorner: o.corner ?? 'bottom-right' });
  return { kit, ctx, canvas, surfaces, size };
}
