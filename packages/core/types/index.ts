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
