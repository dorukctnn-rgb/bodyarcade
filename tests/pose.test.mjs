// Tests the camera lifecycle of site/game/pose.js with stand-ins for getUserMedia, the video element and
// the camera tracks: node --test tests/pose.test.mjs
// Covers the 23 Oct 2026 audit items B8 (a camera that dies mid-run), B9 (Back during the permission
// prompt left the camera on), B10 (camera released when a run ends) and B7 (calibration that never ends).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── stand-ins ──
const requests = []; // getUserMedia calls waiting for an answer
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: (constraints) => new Promise((resolve, reject) => requests.push({ resolve, reject, constraints })) } },
});
globalThis.HTMLVideoElement = class { requestVideoFrameCallback() {} };

function fakeStream() {
  const listeners = {};
  const track = {
    readyState: 'live',
    stop() { this.stopCalls = (this.stopCalls || 0) + 1; this.readyState = 'ended'; }, // like the real thing: stop() fires no "ended" event
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    unplug() { this.readyState = 'ended'; (listeners.ended || []).forEach((f) => f()); }, // the browser ends the track and fires "ended"
  };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
const fakeVideo = (readyState = 4) => ({ srcObject: null, muted: false, playsInline: false, readyState, onloadeddata: null, play: async () => {} });
const fakeInput = () => ({ source: '', tracking: { ok: true, reason: '' }, setCrouch() {}, setLane() {}, triggerJump() {} });
const grant = (stream = fakeStream()) => { const r = requests.shift(); assert.ok(r, 'a getUserMedia request was waiting'); r.resolve(stream); return stream; };
const tick = () => new Promise((r) => setImmediate(r));

const { PoseTracker, calibrationNotice, MIN_POSE_FPS } = await import(process.env.POSE_URL || new URL('../site/game/pose.js', import.meta.url).href);
beforeEach(() => { requests.length = 0; });

// ── B8 ──
test('B8: a stream whose tracks ended is reported as ended, dropped and asked for again', async () => {
  const video = fakeVideo(); const tr = new PoseTracker(video, fakeInput());
  assert.equal(tr.cameraState(), 'none');
  const first = tr.startCamera(); const a = grant(); await first;
  assert.equal(tr.cameraState(), 'live');
  assert.equal(video.srcObject, a);
  a.track.unplug(); // webcam pulled out
  assert.equal(tr.cameraState(), 'ended');
  const second = tr.startCamera();
  assert.equal(requests.length, 1, 'a dead stream is not handed back, the browser is asked again');
  const b = grant(); await second;
  assert.equal(tr.cameraState(), 'live');
  assert.equal(video.srcObject, b);
});

test('B8: the "ended" event reaches onCameraEnded once, and not after the camera was released', async () => {
  const tr = new PoseTracker(fakeVideo(), fakeInput()); let n = 0; tr.onCameraEnded = () => n++;
  const p = tr.startCamera(); const a = grant(); await p;
  a.track.unplug();
  assert.equal(n, 1);
  const p2 = tr.startCamera(); const b = grant(); await p2;
  tr.stopCamera(); b.track.unplug(); // a track that is no longer ours must not call back
  assert.equal(n, 1);
});

test('B8: a track that is stopped by script (no "ended" event) is still seen as ended when polled', async () => {
  const tr = new PoseTracker(fakeVideo(), fakeInput());
  const p = tr.startCamera(); const a = grant(); await p;
  a.track.stop();
  assert.equal(tr.cameraState(), 'ended');
});

// ── B9 ──
test('B9: Back while the browser is still asking: the stream that arrives later is stopped at once', async () => {
  const video = fakeVideo(); const tr = new PoseTracker(video, fakeInput());
  const p = tr.startCamera();
  tr.stopCamera(); // the player pressed Back
  const s = grant(); // ...then allowed the prompt
  await assert.rejects(p, (e) => e.cancelled === true);
  assert.equal(s.track.readyState, 'ended', 'the camera light goes off');
  assert.equal(tr.stream, null);
  assert.equal(video.srcObject, null);
  assert.equal(tr.cameraState(), 'none');
});

test('B9: Back while waiting for the first video frame cancels that wait too (it used to hang)', async () => {
  const video = fakeVideo(0); const tr = new PoseTracker(video, fakeInput()); // readyState 0: no frame yet
  const p = tr.startCamera(); const s = grant(); await tick();
  assert.equal(tr.cameraState(), 'live');
  tr.stopCamera();
  await assert.rejects(p, (e) => e.cancelled === true);
  assert.equal(s.track.readyState, 'ended');
  assert.equal(video.srcObject, null);
});

test('B9: Back while video.play() is still starting ends the start instead of waiting for a frame that never comes', async () => {
  const video = fakeVideo(0); const tr = new PoseTracker(video, fakeInput());
  let finishPlay; video.play = () => new Promise((r) => { finishPlay = r; }); // the element is still starting up
  const p = tr.startCamera(); const s = grant(); await tick();
  assert.equal(tr.cameraState(), 'live');
  tr.stopCamera(); // the player pressed Back; removing the source also settles play()
  finishPlay();
  const outcome = await Promise.race([p.then(() => 'resolved', (e) => (e.cancelled ? 'cancelled' : 'failed')), new Promise((r) => setTimeout(() => r('hung'), 300))]);
  assert.equal(outcome, 'cancelled');
  assert.equal(s.track.readyState, 'ended');
});

test('B9: the camera can be opened again after a cancelled start', async () => {
  const tr = new PoseTracker(fakeVideo(), fakeInput());
  const p = tr.startCamera(); tr.stopCamera(); grant(); await assert.rejects(p);
  const p2 = tr.startCamera(); grant(); await p2;
  assert.equal(tr.cameraState(), 'live');
});

test('two callers asking for the camera at once cause one browser prompt', async () => {
  const tr = new PoseTracker(fakeVideo(), fakeInput());
  const a = tr.startCamera(); const b = tr.startCamera();
  assert.equal(requests.length, 1);
  grant(); const [sa, sb] = await Promise.all([a, b]);
  assert.equal(sa, sb);
});

// ── B10 ──
test('B10: stopCamera ends every track and clears the preview', async () => {
  const video = fakeVideo(); const tr = new PoseTracker(video, fakeInput());
  const p = tr.startCamera(); const s = grant(); await p;
  tr.stopCamera();
  assert.equal(s.track.readyState, 'ended');
  assert.equal(s.track.stopCalls, 1);
  assert.equal(video.srcObject, null);
  assert.equal(tr.cameraState(), 'none');
  tr.stopCamera(); // harmless twice
});

// ── the detection loop ──
test('a restarted detection loop leaves no second loop behind', () => {
  const video = fakeVideo(); const queue = []; video.requestVideoFrameCallback = (cb) => queue.push(cb);
  const tr = new PoseTracker(video, fakeInput()); tr.landmarker = { detectForVideo: () => ({ landmarks: [] }) };
  tr.start();
  assert.equal(queue.length, 1);
  tr.stop(); tr.start(); // the camera was restarted
  assert.equal(queue.length, 2);
  queue.splice(0).forEach((cb) => cb()); // both pending frame callbacks fire
  assert.equal(queue.length, 1, 'only the newest loop asks for the next frame');
});

// ── B7 ──
test('B7: nothing is said in the first ten seconds, then a slow device is told so and offered the keyboard', () => {
  assert.equal(calibrationNotice(4, 9.9), null);
  const slow = calibrationNotice(4, 10);
  assert.equal(slow.slow, true);
  assert.match(slow.text, /about 4 camera pictures a second/);
  assert.match(slow.text, /keyboard/);
  assert.match(calibrationNotice(0, 12).text, /No camera pictures/);
  assert.equal(calibrationNotice(MIN_POSE_FPS, 12), null, 'a fast enough device is not called slow');
  const stuck = calibrationNotice(25, 20);
  assert.equal(stuck.slow, false);
  assert.match(stuck.text, /keyboard/);
});
