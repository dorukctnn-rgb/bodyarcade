// BodyArcade v2 module and API contract (code-audit.md 11.4, refined by the platform builder).
// Every module codes against these types; implementations live in packages/core/<module>.
//
// Conventions
// - Time is performance.now() milliseconds (type Ms) unless a field says epoch ms or seconds.
// - Games receive coordinates in the MIRRORED view (what the player sees), normalised by the player's own torso
//   length T and shoulder width W; see the coordinate spaces at the top of body.ts.
// - L and R are the player's own left and right.
// - Imports use explicit .ts extensions; within packages/core use relative paths, elsewhere '@core/...'.
// - Every resource (GPU, camera, DOM, worker) has a release in the same module and a test that counts it (11.1.5).
//
// Changes against the code-audit draft (all additive unless noted):
// - camera: FrameSource is a union of a video source and a landmark source (traces have no video element);
//   CameraLease adds `stream` (live play replaceTrack) and `info`; CameraService adds stats() for the counting tests.
// - pose: PoseFrame adds `aspect`; PoseService adds setMaxHz() and dispose(); LM indices and POSE_CONNECTIONS.
// - trace: frames carry their own time (real recordings jitter and skip), plus meta and labels; the draft's
//   `{ fps, frames: (Landmark[] | null)[] }` becomes Trace in trace.ts. File format: trace.schema.json.
// - body: BodyProfile adds `aspect` and `hz`; more calibration codes (too_far, head_out, feet_out); Features adds
//   seq, seen, shoulders, hips, foot, headDrop, shoulderSpan; positions use the body space defined in body.ts.
// - moves: Detector.channels(), MovementEngine.setProfile(), channels(), last(), reset(); MovementEvent.value.
// - input: InputFrame adds `t`; events carry their source; InputHub adds allowed(), inject(), setTracking(),
//   reset(), dispose(); typed KeyMap and TouchMap.
// - game: GameManifest adds minPoseHz; GameModule for the catalogue.
//
// Two players, one camera (23 Oct, additive):
// - players.ts: PlayerSlot, PlayerFrame, PlayerAssignment (stable players from unordered detections),
//   TwoPlayerCalibrator with two-person framing codes and guidance.
// - device.ts: Capabilities (local2 only on desktop, laptop, TV and landscape tablets; never in the Android app
//   or on phone-sized screens) from DeviceSignals.
// - pose: PoseLoadOptions.numPoses, PoseService.setNumPoses(), PoseFrame.poses; traces keep `people`.
// - input: InputFrame.players (one stream per player), InputEvent.player, TrackingCode 'player_missing'.
// - loop and game: mode 'local2', PauseReason 'player_lost', SessionEvents.player, StartOptions.profiles,
//   RunSummary.players and log entries per player.
//
// Easy calibration (24 Oct, additive; "kamera hips'i algılamadı, daha kolay ve hızlı olmalı"):
// - body: framing profiles (FramingProfile: full, upper = a desk, seated, side) and the game kinds each one runs
//   (ProfileSupport); the Calibrator takes the best profile it can measure and never blocks (CalibratorOptions.fallback);
//   CalibrationStatus adds profile, supports, hint (measured steps and direction), seen, fallbackInMs, outcome, escape;
//   Calibrator.accept(); new codes move_left, move_right, too_dark, backlit, many_people; BodyProfile.kind and
//   hipsEstimated; HeadroomCode (raise_hands, headroom, kept apart from CalibrationCode) and GameManifest.headroom
//   ('arms-up') with BodyProfile.headroom and reachY.
// - pose: PoseFrame.light (a 16 x 12 brightness map, a few per second, for too_dark and backlit).
// - loop: SessionEvents.profile (how the calibration ended, 'fallback' = the seated variant is played), Session.playAtDesk();
//   SessionEvents.error carries a code, an empty message and the developer's detail: no player-facing text from the platform.

export * from './common.ts';
export * from './camera.ts';
export * from './pose.ts';
export * from './trace.ts';
export * from './body.ts';
export * from './moves.ts';
export * from './input.ts';
export * from './loop.ts';
export * from './game.ts';
export * from './render.ts';
export * from './store.ts';
export * from './entitlements.ts';
export * from './net.ts';
export * from './players.ts';
export * from './device.ts';
