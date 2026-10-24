// What this device and this build can offer, as the shell needs it. The decision about two players on one camera
// belongs to the platform builder (core/device/capabilities.ts, the contract's Capabilities); this module adds what
// only the shell cares about: the layout class of the window, touch, camera and secure-page facts, and the extra
// condition that the split HUD needs at least 1000 px of width (layout.ts duoAvailable, design/LAYOUT.md section 12).
import type { Capabilities as DeviceCapabilities, DeviceKind } from '../types/index.ts';
import { detectCapabilities as detectDevice } from '../device/capabilities.ts';
import { deviceClass, duoAvailable, type DeviceClass } from './layout.ts';

export type Platform = 'web' | 'android-app';

/** Why the "2 players, same camera" choice is hidden or disabled; 'ok' when it is offered. */
export type Local2Reason = DeviceCapabilities['local2Reason'] | 'narrow';

export interface UiEnv {
  viewport: { w: number; h: number };
  /** navigator.mediaDevices.getUserMedia exists. */
  camera: boolean;
  /** https or localhost; the camera needs it (B8 showed the wrong message for this). */
  secure: boolean;
  touch: boolean;
  /** Tests and tools: a keyboard is there whatever the device is. */
  keyboard?: boolean;
}

export interface UiCapabilities {
  device: DeviceKind;
  platform: Platform;
  deviceClass: DeviceClass;
  landscape: boolean;
  touch: boolean;
  camera: boolean;
  secure: boolean;
  /** A TV platform: the shell turns big text on by default. */
  tv: boolean;
  /**
   * Keyboard play is offered as a way around the camera (laptops, desktops, TVs with arrow keys). A phone or a tablet has
   * no keys worth using: a camera game there says it needs the camera and helps with the permission instead.
   */
  keyboard: boolean;
  /** Offer "2 players, same camera". Both the device rule and the split-HUD width rule must pass. */
  local2: boolean;
  local2Reason: Local2Reason;
}

/** Pure: the platform builder's answer plus what the window and browser add. */
export function uiCapabilities(device: DeviceCapabilities, env: UiEnv): UiCapabilities {
  const { w, h } = env.viewport;
  const fits = duoAvailable({ w, h });
  const local2 = device.local2 && fits;
  const reason: Local2Reason = local2 ? 'ok' : !device.local2 ? device.local2Reason : 'narrow';
  return {
    device: device.device,
    platform: device.device === 'android_app' ? 'android-app' : 'web',
    deviceClass: deviceClass(w, h),
    landscape: w > h,
    touch: env.touch,
    camera: env.camera,
    secure: env.secure,
    tv: device.device === 'tv',
    keyboard: env.keyboard ?? (device.device === 'desktop' || device.device === 'tv'),
    local2,
    local2Reason: reason,
  };
}

/** Reads the browser. Only called in the browser; the page generator never needs it. */
export function detectUiCapabilities(win: Window & typeof globalThis, o: { keyboard?: boolean } = {}): UiCapabilities {
  const nav = win.navigator;
  return uiCapabilities(detectDevice(win), {
    viewport: { w: win.innerWidth, h: win.innerHeight },
    camera: !!nav.mediaDevices?.getUserMedia,
    secure: win.isSecureContext,
    touch: 'ontouchstart' in win || nav.maxTouchPoints > 0,
    ...(o.keyboard !== undefined ? { keyboard: o.keyboard } : {}),
  });
}

/** What the page generator and the tests use when there is no browser: a laptop with a camera, no claim about two players. */
export const SERVER_CAPABILITIES: UiCapabilities = {
  device: 'desktop', platform: 'web', deviceClass: 'medium', landscape: true, touch: false, camera: true, secure: true, tv: false, keyboard: true,
  local2: false, local2Reason: 'small_screen',
};
