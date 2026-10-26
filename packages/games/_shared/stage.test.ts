// The Stage adapter: a play area that holds still while the HUD's command takes one line or two, effects and figures that grow with the
// screen, and one answer for everyone who asks a kit for its stage.
import { describe, expect, it, vi } from 'vitest';
import { BREAKPOINTS } from '../../core/ui/layout.ts';
import { sceneUnit, stageOf } from './stage.ts';
import { testKit, testKitDuo } from './testing/context.ts';

/** The HUD with a command of this height (a wide plate does not fit between the two status plates, so it sits under them). */
function hud(t: ReturnType<typeof testKit>, commandH: number, corner: 'bottom-left' | 'bottom-right' = 'bottom-left'): void {
  t.kit.setHud({
    mode: 'scene', pipCorner: corner,
    measured: { statusLeft: { w: 120, h: 60 }, statusRight: { w: 150, h: 60 }, command: { w: 300, h: commandH }, reason: { w: 1, h: 1 } },
  });
}

describe('the scene unit', () => {
  it('is 1 on every phone, grows with the screen and stops at 1.5 on a laptop and a TV', () => {
    const units = BREAKPOINTS.map((b) => [b.id, b.w, b.h, sceneUnit(b.w, b.h)] as const);
    for (const [id, w, h, u] of units) if (Math.min(w, h) < 500) expect(u, id).toBe(1);
    expect(sceneUnit(1440, 900)).toBeGreaterThan(1.49);
    expect(sceneUnit(1920, 1080)).toBe(1.5);
    expect(sceneUnit(1280, 800)).toBeGreaterThan(1.2);
    expect(sceneUnit(1280, 800)).toBeLessThan(1.5);
    // bigger screen, bigger unit
    expect(sceneUnit(1024, 768)).toBeLessThan(sceneUnit(1280, 800));
    expect(sceneUnit(1280, 800)).toBeLessThan(sceneUnit(1440, 900));
    expect(sceneUnit(0, 0)).toBe(1);
  });

  it('is what the stage says, and a burst on a big screen is faster, bigger and heavier in the same proportion (the same picture)', () => {
    const phone = testKit(390, 844);
    const tv = testKit(1920, 1080);
    const burstP = vi.spyOn(phone.kit.particles, 'burst');
    const burstT = vi.spyOn(tv.kit.particles, 'burst');
    const sp = stageOf(phone.kit) as NonNullable<ReturnType<typeof stageOf>>;
    const st = stageOf(tv.kit) as NonNullable<ReturnType<typeof stageOf>>;
    expect(sp.unit).toBe(1);
    expect(st.unit).toBe(1.5);
    const o = { speed: [100, 200] as [number, number], size: [2, 4] as [number, number], gravity: 100, life: [1, 2] as [number, number], drag: 1.1 };
    sp.burst(10, 10, 5, o);
    st.burst(10, 10, 5, o);
    expect(burstP.mock.calls[0]?.[3]).toEqual(o);
    expect(burstT.mock.calls[0]?.[3]).toEqual({ speed: [150, 300], size: [3, 6], gravity: 150, life: [1, 2], drag: 1.1 });
    expect(o.speed).toEqual([100, 200]);   // the caller's options are left alone
    st.burst(10, 10, 5);                   // no options at all is fine
    expect(burstT.mock.calls[1]?.[3]).toBeUndefined();
  });
});

describe('the play area that holds still', () => {
  it('shrinks when the command takes a second line and does not come back when it takes one again', () => {
    const t = testKit(360, 780);
    const stage = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
    hud(t, 80);
    const one = stage.play;
    expect(one).toEqual(t.kit.rects.play);
    hud(t, 142);
    const two = stage.play;
    expect(two.y).toBeGreaterThan(one.y);
    expect(two.x).toBe(one.x);
    expect(two.w).toBe(one.w);
    expect(two.y + two.h).toBeCloseTo(one.y + one.h, 6);          // the bottom did not move
    hud(t, 80);
    expect(t.kit.rects.play.y).toBe(one.y);                      // the HUD gave the larger area back ...
    expect(stage.play).toEqual(two);                             // ... and the stage keeps the smaller one
    hud(t, 142);
    hud(t, 80);
    expect(stage.play).toEqual(two);
  });

  it('is inside every play area the HUD gave since the run began, so nothing in it is ever under a plate', () => {
    const t = testKit(412, 915);
    const stage = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
    for (const h of [60, 80, 142, 100, 166, 80, 120]) {
      hud(t, h);
      const raw = t.kit.rects.play, steady = stage.play;
      expect(steady.y).toBeGreaterThanOrEqual(raw.y - 1e-9);
      expect(steady.y + steady.h).toBeLessThanOrEqual(raw.y + raw.h + 1e-9);
    }
    expect(stage.play.y).toBeGreaterThan(t.kit.rects.play.y);
  });

  it('starts again with a new run (resetLayout), a new screen size, another corner of the self view, or a hidden one', () => {
    const t = testKit(360, 780);
    const stage = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
    hud(t, 142);
    stage.play;
    hud(t, 80);
    expect(stage.play.y).toBeGreaterThan(t.kit.rects.play.y);
    stage.resetLayout();
    expect(stage.play).toEqual(t.kit.rects.play);
    hud(t, 142);
    stage.play;                                                  // a view reads the play area every frame
    hud(t, 80);
    expect(stage.play.y).toBeGreaterThan(t.kit.rects.play.y);
    hud(t, 80, 'bottom-right');                                  // the self view moved: another layout, taken afresh
    expect(stage.play).toEqual(t.kit.rects.play);
    t.kit.setHud({ mode: 'scene', pipCorner: 'hidden', measured: { statusLeft: { w: 120, h: 60 }, statusRight: { w: 150, h: 60 }, command: { w: 300, h: 80 }, reason: { w: 1, h: 1 } } });
    expect(stage.pip).toBeNull();
    expect(stage.play).toEqual(t.kit.rects.play);
  });

  it('is one answer for the game and for whoever looks over its shoulder (a test, a tool): every stage of a kit shares it', () => {
    const t = testKit(390, 844);
    const a = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
    const b = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
    hud(t, 142);
    const two = a.play;
    hud(t, 80);
    expect(b.play).toEqual(two);
    b.resetLayout();
    expect(a.play).toEqual(t.kit.rects.play);
  });

  it('holds the two lanes of two players still in the same way, and never moves them sideways', () => {
    const t = testKitDuo(1280, 800);
    const stage = stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>;
    const duo = (commandH: number): void => {
      const m = {
        statusP1: { w: 160, h: 62 }, statusP2: { w: 160, h: 62 }, timer: { w: 140, h: 62 },
        command: { w: 300, h: commandH }, reasonP1: { w: 1, h: 1 }, reasonP2: { w: 1, h: 1 },
      };
      t.kit.setHudDuo(m);
    };
    duo(80);
    const first = stage.lanes;
    expect(first).not.toBeNull();
    duo(150);
    const second = stage.lanes as readonly [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }];
    expect(second[0].y).toBeGreaterThan((first as NonNullable<typeof first>)[0].y);
    expect(second[1].y).toBeGreaterThan((first as NonNullable<typeof first>)[1].y);
    expect(second[0].x).toBe((first as NonNullable<typeof first>)[0].x);
    expect(second[1].w).toBe((first as NonNullable<typeof first>)[1].w);
    duo(80);
    expect(stage.lanes).toEqual(second);
    expect(stage.play.y).toBeGreaterThanOrEqual(Math.max(second[0].y, second[1].y) - 1e-9);
  });

  it('leaves a kit without lanes with none, and a scene that is not the kit with no stage', () => {
    const t = testKit(390, 844);
    expect((stageOf(t.kit) as NonNullable<ReturnType<typeof stageOf>>).lanes).toBeNull();
    expect(stageOf(undefined)).toBeNull();
    expect(stageOf(null)).toBeNull();
    expect(stageOf({} as never)).toBeNull();
  });
});
