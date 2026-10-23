// The platform's part of a Session in the browser: ONE camera service and ONE pose service per page (the model
// loads once and stays for every later round), the device capabilities, the page as the key target and the screen
// wake lock (createSession's default). The shell adds what it owns: the games, the HUD, store, audio and strings
// (`ui`), and the play area for swipes. A SessionFactory in the shell is then:
//
//   (r) => createBrowserSession({ games: (id) => modules[id], ui: () => ({ hud: r.stage.hud, ... }),
//                                 touchTarget: () => r.stage.scene })
//
// The session's 'video' event hands out the camera picture for the self view; frames for a skeleton overlay come
// from browserServices().pose.onFrame.
import type { CameraService, PoseService, Session } from '../types/index.ts';
import { createCameraService } from '../camera/camera.ts';
import { detectCapabilities } from '../device/capabilities.ts';
import { createPoseService } from '../pose/service.ts';
import { createSession, type SessionDeps } from './session.ts';

export interface BrowserServices { camera: CameraService; pose: PoseService }

let shared: BrowserServices | null = null;

/** The page's camera and pose services, made on first use and shared by every session. */
export function browserServices(): BrowserServices {
  shared ??= { camera: createCameraService(), pose: createPoseService() };
  return shared;
}

/** A session with the page's services and the device capabilities; anything in `o` overrides them. */
export function createBrowserSession(o: Pick<SessionDeps, 'games' | 'ui'> & Partial<SessionDeps>): Session {
  const { camera, pose } = browserServices();
  return createSession({ camera, pose, capabilities: () => detectCapabilities(), ...o });
}
