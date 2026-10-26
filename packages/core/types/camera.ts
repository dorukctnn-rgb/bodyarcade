// core/camera: the only code that calls getUserMedia. A lease is the only owner of a stream.
import type { Landmark } from './pose.ts';
import type { Ms, Unsubscribe } from './common.ts';

/** Where the pose service gets its frames: a video element (camera) or ready-made landmarks (trace, test). */
export type FrameSource = VideoFrameSource | LandmarkFrameSource;

export interface VideoFrameSource {
  readonly kind: 'video';
  /** Attaches the stream to the video element and starts playback. Resolves once a frame is available. */
  start(): Promise<void>;
  /** Pauses playback. Does not release the camera (that is CameraLease.release). */
  stop(): void;
  readonly video: HTMLVideoElement;
}

/** One landmark frame from a non-camera source. `t` is on the performance.now() clock. */
export interface SourceLandmarks { t: Ms; landmarks: Landmark[] | null; inferenceMs?: number; poses?: Landmark[][] }

export interface LandmarkFrameSource {
  readonly kind: 'landmarks';
  /** 'trace' for recorded files, 'test' for scripted input. Ranked and live modes refuse both (B20). */
  readonly source: 'trace' | 'test';
  /** Width / height of the image the landmarks were measured in. */
  readonly aspect: number;
  start(): Promise<void>;
  stop(): void;
  onFrame(cb: (f: SourceLandmarks) => void): Unsubscribe;
  /** True once a non-looping source has delivered its last frame. */
  readonly done: boolean;
}

export interface CameraInfo {
  width: number;
  height: number;
  frameRate?: number;
  facingMode?: string;
  deviceId?: string;
  label?: string;
}

export interface CameraLease extends VideoFrameSource {
  /** Idempotent; stops every track and detaches the video element. */
  release(): void;
  /** Fires once when any track ends: unplugged, permission revoked, taken by another app (B8). */
  onEnded(cb: () => void): Unsubscribe;
  /** False once any track has ended or the lease was released. */
  readonly alive: boolean;
  /** The stream itself, for live play (RTCRtpSender.replaceTrack). Never stop its tracks directly: call release(). */
  readonly stream: MediaStream;
  readonly info: CameraInfo;
}

export interface CameraAcquireOptions {
  /** Aborting before or during the permission prompt rejects with name 'AbortError' and leaves no live track (B9). */
  signal?: AbortSignal;
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: 'user' | 'environment';
  deviceId?: string;
}

/** Why acquire failed, so the UI can show the right message (B8 showed the wrong one). */
export type CameraErrorCode =
  | 'denied'           // the player or the browser refused permission
  | 'not_found'        // no camera
  | 'in_use'           // the device could not be started (another app, driver)
  | 'overconstrained'  // no camera matches deviceId or facingMode
  | 'no_frames'        // the stream started but delivered no frame in time
  | 'insecure'         // not https (getUserMedia is missing)
  | 'unsupported'      // no getUserMedia in this browser
  | 'unknown';

export interface CameraFailure { readonly name: 'CameraError'; readonly code: CameraErrorCode; readonly message: string }

export interface CameraService {
  // Rejects with an error named 'AbortError' and leaves NO live track if the signal fires before or during the
  // permission prompt (B9). Other failures reject with a CameraFailure. A lease is the only owner of a stream,
  // so the results screen releases it explicitly (B10) and "Run again" acquires a new one.
  acquire(o?: CameraAcquireOptions): Promise<CameraLease>;
  /** Counters for the resource tests (rule 3): every acquired lease must end up released. */
  stats(): { acquired: number; released: number; live: number };
}
