// Camera + MediaPipe Pose Landmarker (Tasks Vision) + movement detection.
// Frames never leave the device: the model runs in the browser (WebGL/WASM).
const MP_VERSION = '0.10.21';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

// Landmark indices (BlazePose): 0 nose · 11/12 shoulders · 23/24 hips · 25/26 knees · 27/28 ankles
export const CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

// Thresholds, all relative to the player's own torso length measured at calibration.
export const THRESH = {
  jumpRise: 0.2,       // hips rise ≥ 20% of torso length → jump
  jumpRearm: 0.08,
  crouchFull: 0.55,    // hips drop 55% of torso = crouch 1.0
  headFull: 0.8,       // head drop 80% of torso = crouch 1.0
  leanOn: 0.3,         // shoulder offset (in shoulder widths) to enter a lane
  leanOff: 0.16,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class PoseTracker {
  constructor(video, input) {
    this.video = video;
    this.input = input;
    this.landmarker = null;
    this.stream = null;
    this.landmarks = null;          // last normalized landmarks (for the preview)
    this.base = null;               // calibration baseline
    this.signals = { hipRise: 0, crouch: 0, lean: 0, visible: false };
    this.delegate = null;
    this._running = false;
    this._lastTs = 0;
    this._lastSeen = 0;
    this._armed = true;
    this._lane = 0;
    this._sm = null;                // smoothed key points
    this.onFrame = null;            // callback(landmarks, signals)
    this.fps = 0; this._fpsN = 0; this._fpsT = 0;
    this.injected = false;          // true when the test hook feeds landmarks
  }

  async load(onStatus = () => {}) {
    if (this.landmarker) return;
    onStatus('Loading pose model…');
    const vision = await import(/* @vite-ignore */ MP_BUNDLE);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    try { this.landmarker = await make('GPU'); this.delegate = 'GPU'; }
    catch (e) { console.warn('GPU delegate failed, falling back to CPU', e); this.landmarker = await make('CPU'); this.delegate = 'CPU'; }
    onStatus('Pose model ready');
  }

  async startCamera() {
    if (this.stream) return this.stream;
    const constraints = { audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    await this.video.play().catch(() => {});
    await new Promise((res) => { if (this.video.readyState >= 2) res(); else this.video.onloadeddata = () => res(); });
    return this.stream;
  }

  stopCamera() {
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    this.video.srcObject = null;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const step = () => {
      if (!this._running) return;
      if (!this.injected && this.landmarker && this.video.readyState >= 2) {
        const now = performance.now();
        if (now > this._lastTs) {
          this._lastTs = now;
          try {
            const res = this.landmarker.detectForVideo(this.video, now);
            const lm = res && res.landmarks && res.landmarks[0];
            this.process(lm || null, now / 1000);
          } catch (e) { console.warn('pose detect error', e); }
        }
      }
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && !this.injected) this.video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    step();
  }
  stop() { this._running = false; }

  // Test hook: feed landmarks directly (same math as the live path).
  inject(lm, t = performance.now() / 1000) { this.injected = true; this.process(lm, t); }

  resetCalibration() { this.base = null; this._sm = null; this._calib = null; }

  // Calibration: ~1.2 s of steady frames with shoulders and hips visible.
  // Returns {progress 0..1, ready, reason}.
  calibrationStatus() { return this._calib || { progress: 0, ready: false, reason: 'Looking for you…' }; }

  process(lm, t) {
    this.landmarks = lm;
    this.lastFrameT = t;
    this._fpsN++; if (t - this._fpsT > 1) { this.fps = this._fpsN / (t - this._fpsT); this._fpsN = 0; this._fpsT = t; }
    const vis = (i) => lm && lm[i] && (lm[i].visibility == null || lm[i].visibility > 0.5);
    const shouldersOk = vis(11) && vis(12);
    const hipsOk = vis(23) && vis(24);
    const dt = this._lastT ? Math.min(0.1, t - this._lastT) : 0.033; this._lastT = t;

    if (!lm || !shouldersOk || !hipsOk) {
      // keep the last state briefly, then declare tracking lost
      if (t - this._lastSeen > 0.6) {
        this.signals.visible = false;
        this.input.tracking = { ok: false, reason: !lm ? 'Can’t see you — step into view' : !hipsOk ? 'Step back so your hips are in view' : 'Keep your shoulders in view' };
        if (!this.base) this._calib = { progress: 0, ready: false, reason: this.input.tracking.reason };
        this.input.setCrouch(0); this.input.setLane(0); this._lane = 0;
      }
      if (this.onFrame) this.onFrame(lm, this.signals);
      return;
    }
    this._lastSeen = t;
    this.signals.visible = true;
    this.input.tracking = { ok: true, reason: '' };

    const raw = {
      hipY: (lm[23].y + lm[24].y) / 2, hipX: (lm[23].x + lm[24].x) / 2,
      shY: (lm[11].y + lm[12].y) / 2, shX: (lm[11].x + lm[12].x) / 2,
      noseY: lm[0].y, shW: Math.max(0.05, Math.abs(lm[11].x - lm[12].x)),
    };
    // light smoothing (keeps jumps responsive, removes jitter)
    if (!this._sm) this._sm = { ...raw };
    const a = 0.5, s = this._sm;
    for (const k in raw) s[k] += (raw[k] - s[k]) * a;

    if (!this.base) { this._calibrate(s, t); if (this.onFrame) this.onFrame(lm, this.signals); return; }

    const b = this.base;
    const torso = Math.max(0.08, b.hipY - b.shY);
    const hipRise = (b.hipY - s.hipY) / torso;
    const hipDrop = (s.hipY - b.hipY) / torso;
    const headDrop = (s.noseY - b.noseY) / torso;
    const crouch = clamp(Math.max(hipDrop / THRESH.crouchFull, headDrop / THRESH.headFull), 0, 1);
    const tilt = ((s.shX - s.hipX) - (b.shX - b.hipX)) / b.shW;
    const shift = (s.hipX - b.hipX) / b.shW;
    const lean = tilt * 1.0 + shift * 0.7;   // + = toward image right = the player's LEFT (camera faces them)

    // jump: rising edge on hip rise, re-armed when hips settle
    if (this._armed && hipRise > THRESH.jumpRise && crouch < 0.35) { this._armed = false; this.input.triggerJump(); this._jumpT = t; }
    else if (!this._armed && hipRise < THRESH.jumpRearm && t - (this._jumpT || 0) > 0.35) this._armed = true;

    // lane with hysteresis. Lean to your left (image right) → left lane (-1).
    const L = this._lane;
    if (L === 0) { if (lean > THRESH.leanOn) this._lane = -1; else if (lean < -THRESH.leanOn) this._lane = 1; }
    else if (L === -1) { if (lean < THRESH.leanOff) this._lane = 0; }
    else if (L === 1) { if (lean > -THRESH.leanOff) this._lane = 0; }

    // slow baseline drift when standing neutral (camera or player shifts a little)
    if (Math.abs(hipRise) < 0.06 && crouch < 0.1 && Math.abs(lean) < 0.12) {
      const k = dt / 8;
      b.hipY += (s.hipY - b.hipY) * k; b.shY += (s.shY - b.shY) * k; b.noseY += (s.noseY - b.noseY) * k;
      b.hipX += (s.hipX - b.hipX) * k; b.shX += (s.shX - b.shX) * k; b.shW += (s.shW - b.shW) * k;
    }

    this.signals.hipRise = hipRise; this.signals.crouch = crouch; this.signals.lean = lean;
    this.input.source = 'pose';
    this.input.setCrouch(crouch);
    this.input.setLane(this._lane);
    if (this.onFrame) this.onFrame(lm, this.signals);
  }

  _calibrate(s, t) {
    if (!this._calibBuf) this._calibBuf = [];
    const buf = this._calibBuf;
    // too close? shoulders wider than 45% of the frame means hips/knees will leave the frame when moving
    if (s.shW > 0.45) { this._calib = { progress: 0, ready: false, reason: 'Step back a little' }; buf.length = 0; return; }
    if (s.hipY > 0.97) { this._calib = { progress: 0, ready: false, reason: 'Step back so your hips are in view' }; buf.length = 0; return; }
    buf.push({ ...s, t });
    while (buf.length && t - buf[0].t > 1.2) buf.shift();
    const n = buf.length;
    const spread = (k) => { let mn = 1e9, mx = -1e9; for (const f of buf) { mn = Math.min(mn, f[k]); mx = Math.max(mx, f[k]); } return mx - mn; };
    const steady = n > 4 && spread('hipY') < 0.05 && spread('hipX') < 0.05;
    const progress = clamp((t - buf[0].t) / 1.2, 0, 1) * (steady ? 1 : 0.3);
    if (!steady) { this._calib = { progress, ready: false, reason: 'Stand still for a moment' }; return; }
    this._calib = { progress, ready: false, reason: 'Hold still…' };
    if (n >= 12 && t - buf[0].t >= 1.15) {
      const med = (k) => { const v = buf.map(f => f[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
      this.base = { hipY: med('hipY'), hipX: med('hipX'), shY: med('shY'), shX: med('shX'), noseY: med('noseY'), shW: med('shW') };
      this._calib = { progress: 1, ready: true, reason: 'Calibrated' };
      this._lane = 0; this._armed = true;
      buf.length = 0;
    }
  }
}
