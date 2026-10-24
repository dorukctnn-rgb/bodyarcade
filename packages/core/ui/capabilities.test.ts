import { describe, expect, it } from 'vitest';
import type { Capabilities as DeviceCapabilities } from '../types/index.ts';
import { capabilitiesFrom as deviceFrom } from '../device/capabilities.ts';
import { BREAKPOINTS, duoAvailable } from './layout.ts';
import { SERVER_CAPABILITIES, uiCapabilities, type UiEnv } from './capabilities.ts';

const ok: DeviceCapabilities = { device: 'desktop', local2: true, local2Reason: 'ok' };
const env = (w: number, h: number): UiEnv => ({ viewport: { w, h }, camera: true, secure: true, touch: false });

describe('shell capabilities on top of the platform answer', () => {
  it('offers two players on a laptop and a landscape tablet that is wide enough', () => {
    expect(uiCapabilities(ok, env(1280, 800))).toMatchObject({ local2: true, local2Reason: 'ok', platform: 'web', tv: false });
    expect(uiCapabilities({ device: 'tablet', local2: true, local2Reason: 'ok' }, env(1024, 768)).local2).toBe(true);
  });

  it('keeps the platform reason when the device says no', () => {
    expect(uiCapabilities({ device: 'phone', local2: false, local2Reason: 'phone' }, env(390, 844))).toMatchObject({ local2: false, local2Reason: 'phone' });
    expect(uiCapabilities({ device: 'tablet', local2: false, local2Reason: 'tablet_portrait' }, env(768, 1024))).toMatchObject({ local2: false, local2Reason: 'tablet_portrait' });
  });

  it('turns it off in the Android app and names the platform', () => {
    const c = uiCapabilities({ device: 'android_app', local2: false, local2Reason: 'android_app' }, env(1280, 800));
    expect(c).toMatchObject({ platform: 'android-app', local2: false, local2Reason: 'android_app' });
  });

  it('turns it off when the device allows it but the window is too narrow for the split HUD', () => {
    const c = uiCapabilities({ device: 'tablet', local2: true, local2Reason: 'ok' }, env(960, 600));
    expect(c).toMatchObject({ local2: false, local2Reason: 'narrow' });
  });

  it('marks a TV', () => {
    expect(uiCapabilities({ device: 'tv', local2: true, local2Reason: 'ok' }, env(1920, 1080))).toMatchObject({ tv: true, local2: true });
  });

  it('passes camera, secure and touch facts through', () => {
    const c = uiCapabilities(ok, { viewport: { w: 1280, h: 800 }, camera: false, secure: false, touch: true });
    expect(c).toMatchObject({ camera: false, secure: false, touch: true, landscape: true });
  });

  it('offers the keyboard as a way around the camera only where keys are worth using', () => {
    expect(uiCapabilities(ok, env(1280, 800)).keyboard).toBe(true);
    expect(uiCapabilities({ device: 'tv', local2: true, local2Reason: 'ok' }, env(1920, 1080)).keyboard).toBe(true);
    expect(uiCapabilities({ device: 'phone', local2: false, local2Reason: 'phone' }, env(390, 844)).keyboard).toBe(false);
    expect(uiCapabilities({ device: 'tablet', local2: true, local2Reason: 'ok' }, env(1024, 768)).keyboard).toBe(false);
    expect(uiCapabilities({ device: 'android_app', local2: false, local2Reason: 'android_app' }, env(412, 915)).keyboard).toBe(false);
    // tests and tools can say a keyboard is there
    expect(uiCapabilities({ device: 'phone', local2: false, local2Reason: 'phone' }, { ...env(390, 844), keyboard: true }).keyboard).toBe(true);
  });

  it('never claims two players on the server', () => {
    expect(SERVER_CAPABILITIES.local2).toBe(false);
    expect(SERVER_CAPABILITIES.platform).toBe('web');
  });

  for (const bp of BREAKPOINTS) {
    it(`${bp.id}: with the real platform rule a desktop browser is offered two players exactly when the HUD layout allows it`, () => {
      const device = deviceFrom({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', referrer: '', search: '', storedAndroidApp: false, digitalGoods: false,
        screen: { width: Math.max(bp.w, 1280), height: Math.max(bp.h, 800) }, viewport: { width: bp.w, height: bp.h },
        pointer: 'fine', anyFinePointer: true, maxTouchPoints: 0,
      });
      expect(uiCapabilities(device, env(bp.w, bp.h)).local2).toBe(duoAvailable({ w: bp.w, h: bp.h }));
    });
  }
});
