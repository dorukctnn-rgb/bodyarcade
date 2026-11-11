// The form coach's body line: which lines are drawn from the front and from the side, and that every state has its own pattern
// (colour is never the only signal) with a cross on every red part.
import { describe, expect, it } from 'vitest';
import { PointSmoother } from '../form/smooth.ts';
import { emptySegments } from '../form/segments.ts';
import { FAR_RIGHT, frontSquat, landmarks, sidePushUp } from '../form/testing/body.ts';
import { drawFormBody, formLines, FORM_COLORS, type FormCtx } from './form-overlay.ts';

const RECT = { x: 0, y: 0, w: 1600, h: 900, aspect: 16 / 9 };

function recorder() {
  const strokes: { color: string; width: number; dash: number[]; segs: number }[] = [];
  let dash: number[] = [], segs = 0;
  const ctx = {
    save() {}, restore() {}, beginPath() { segs = 0; }, moveTo() { segs++; }, lineTo() {}, arc() {}, fill() {},
    stroke() { strokes.push({ color: String(ctx.strokeStyle), width: Number(ctx.lineWidth), dash: [...dash], segs }); },
    setLineDash(d: number[]) { dash = d; },
    strokeStyle: '' as unknown, fillStyle: '' as unknown, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1,
  };
  return { ctx: ctx as unknown as FormCtx, strokes };
}

describe('form overlay', () => {
  it('draws both sides from the front, the near side and the torso to the near points from the side', () => {
    const sm = new PointSmoother();
    const front = formLines(sm.push(landmarks(frontSquat(0)), 0, 16 / 9), 'front', 'L', RECT).map((l) => l.id);
    expect(front).toEqual(expect.arrayContaining(['shoulders', 'hips', 'torso', 'thighL', 'thighR', 'shinL', 'shinR']));
    sm.reset();
    const side = formLines(sm.push(landmarks(sidePushUp(0), { far: FAR_RIGHT }), 0, 16 / 9), 'side', 'L', RECT).map((l) => l.id);
    expect(side).toEqual(expect.arrayContaining(['torso', 'thighL', 'upperArmL', 'forearmL']));
    expect(side).not.toContain('thighR');
    expect(side).not.toContain('shoulders');
  });

  it('codes every state by colour and by pattern, and crosses every red part', () => {
    const sm = new PointSmoother();
    const pts = sm.push(landmarks(frontSquat(0)), 0, 16 / 9);
    const states = emptySegments();
    states.thighL = 'ok'; states.thighR = 'tip'; states.shinL = 'bad'; states.shinR = 'unknown';
    const { ctx, strokes } = recorder();
    drawFormBody(ctx, pts, states, { view: 'front', near: 'L', rect: RECT, width: 10 });
    const byColor = (c: string) => strokes.filter((s) => s.color === c && s.segs === 1);
    expect(byColor(FORM_COLORS.ok)[0]?.dash).toEqual([]);
    expect(byColor(FORM_COLORS.tip)[0]?.dash.length).toBe(2);
    expect(byColor(FORM_COLORS.bad)[0]?.dash.length).toBe(2);
    expect(byColor(FORM_COLORS.unknown)[0]?.dash.length).toBe(2);
    // dotted (tip) and dashed (bad) are different patterns
    expect(byColor(FORM_COLORS.tip)[0]?.dash).not.toEqual(byColor(FORM_COLORS.bad)[0]?.dash);
    // the cross: two strokes of two lines each, white over the dark outline
    expect(strokes.filter((s) => s.color === '#FFFFFF' && s.segs === 2)).toHaveLength(1);
  });
});
