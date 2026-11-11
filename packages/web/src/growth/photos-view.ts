// Photos: the guided capture (4 directions free, 360 in Pro), the review, the comparison views and the timeline (SPEC 2).
// The camera picture stays on the device: frames are encoded to JPEG here and sealed into the vault. In trace mode (tests,
// developers) there is no video: the "photo" is a drawing of the traced body, so the whole flow runs headless.
import { browserServices } from '../../../core/loop/browser.ts';
import { POSE_MODEL, WASM_BASE } from '../../../core/pose/assets.ts';
import { parseTrace, traceSource } from '../../../core/pose/trace.ts';
import { Capture, type CaptureMode, type CaptureState } from '../../../core/growth/photos/capture.ts';
import type { Bucket } from '../../../core/growth/photos/angle.ts';
import { alignTransform, applyTransform, postureDiffers, type PhotoPose } from '../../../core/growth/photos/align.ts';
import { lightDiffers, lightStats, sharpness, type LightStats } from '../../../core/growth/photos/image-stats.ts';
import { encodeGif } from '../../../core/growth/photos/gif.ts';
import { askPersist } from '../../../core/growth/vault/persist.ts';
import { newId } from '../../../core/growth/vault/vault.ts';
import { LM, POSE_CONNECTIONS, type CameraLease, type Landmark, type PoseFrame } from '../../../core/types/index.ts';
import { chips, field, saveFile, select, type Ctx } from './ctx.ts';
import { fill, type GrowthKey } from './strings.ts';

export interface ShotRecord { bucket: Bucket; photo: string; thumb: string; lm: Landmark[]; aspect: number; w: number; h: number; approximate: boolean; forced: boolean; light: LightStats | null }
export interface PhotoSession { at: number; mode: CaptureMode; note: string; shots: ShotRecord[] }

const dirKey = (b: Bucket): GrowthKey => `dir${b}` as GrowthKey;
const CUE_KEY: Record<NonNullable<CaptureState['cue']>, GrowthKey> = { 'start-front': 'cueStart', turn: 'cueTurn', slower: 'cueSlower', closer: 'cueCloser', farther: 'cueFarther', stay: 'cueStay', still: 'cueStill', 'same-way': 'cueSameWay', 'turn-to': 'cueTurnTo', hold: 'cueHold', check: 'cueCheck', done: 'cueDone' };

export async function loadSessions(c: Ctx): Promise<{ id: string; s: PhotoSession }[]> {
  return (await c.vault.all<PhotoSession>('sessions')).map(({ id, value }) => ({ id, s: value })).sort((a, b) => a.s.at - b.s.at);
}

async function bitmapOf(c: Ctx, id: string, store: 'photos' | 'thumbs' = 'photos'): Promise<ImageBitmap | null> {
  const bytes = await c.vault.getBytes(store, id);
  if (!bytes) return null;
  return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
}

async function urlOf(c: Ctx, id: string): Promise<string | null> {
  const bytes = await c.vault.getBytes('thumbs', id);
  return bytes ? URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })) : null;
}

function drawFigure(ctx2: CanvasRenderingContext2D, lm: readonly Landmark[], w: number, h: number, colour: string, width: number, mirror = false): void {
  ctx2.strokeStyle = colour; ctx2.lineWidth = width; ctx2.lineCap = 'round';
  const X = (x: number): number => (mirror ? (1 - x) * w : x * w);
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = lm[a], q = lm[b];
    if (!p || !q || p.visibility < 0.5 || q.visibility < 0.5) continue;
    ctx2.beginPath(); ctx2.moveTo(X(p.x), p.y * h); ctx2.lineTo(X(q.x), q.y * h); ctx2.stroke();
  }
  const n = lm[LM.nose];
  if (n && n.visibility > 0.3) { ctx2.beginPath(); ctx2.arc(X(n.x), n.y * h, width * 3.2, 0, Math.PI * 2); ctx2.stroke(); }
}

const toJpeg = (cv: HTMLCanvasElement, q = 0.85): Promise<Uint8Array<ArrayBuffer>> =>
  new Promise((res, rej) => cv.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('jpeg'))), 'image/jpeg', q));

/** The person's box from the points (for the light measure): fractions of the picture. */
function boxOf(lm: readonly Landmark[]): { x0: number; y0: number; x1: number; y1: number } {
  const v = lm.filter((p) => p.visibility > 0.5);
  if (!v.length) return { x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.95 };
  const xs = v.map((p) => p.x), ys = v.map((p) => p.y);
  return { x0: Math.max(0, Math.min(...xs) - 0.05), y0: Math.max(0, Math.min(...ys) - 0.08), x1: Math.min(1, Math.max(...xs) + 0.05), y1: Math.min(1, Math.max(...ys) + 0.04) };
}

export async function photosTab(c: Ctx, host: HTMLElement): Promise<() => void> {
  const { el, btn, W } = c;
  const disposers: (() => void)[] = [];
  const wrap = el('div', 'gc-wide'); host.append(wrap);
  const left = el('div', 'gc-grid'); left.style.gridTemplateColumns = '1fr';
  const right = el('div', 'gc-grid'); right.style.gridTemplateColumns = '1fr';
  wrap.append(left, right);
  let sessions = await loadSessions(c);

  // ---------------- capture ----------------
  const cap = el('section', 'gc-card'); cap.dataset.capture = '';
  left.append(cap);
  let mode: CaptureMode = 'quick';
  const setupList = el('ul', 'gc-list');
  for (const k of ['setup1', 'setup2', 'setup3'] as const) setupList.append(el('li', '', W[k]));
  const lastS = sessions.at(-1)?.s;
  const lastLine = lastS ? el('p', 'gc-muted', c.t('lastTime', { date: c.date(lastS.at), note: lastS.note || '-' })) : null;
  const modeNote = el('p', 'gc-note', W.fullNote); modeNote.hidden = true; modeNote.dataset.fullNote = '';
  const modes = chips(c, [['quick', W.quick], ['full', `${W.full} · ${W.proTag}`]] as const, ['quick'], false, (v) => {
    if (v[0] === 'full' && !c.access.can('growth:turntable')) { c.toast(W.proLocked); return; }
    mode = v[0] as CaptureMode;
    modeNote.hidden = mode !== 'full';
  }, 'mode');
  const stage = el('div', 'gc-stage');
  const video = el('video'); video.muted = true; video.playsInline = true; video.setAttribute('aria-hidden', 'true');
  const overlay = el('canvas'); overlay.setAttribute('aria-hidden', 'true');
  const buckets = el('div', 'gc-buckets');
  const cue = el('p', 'gc-cue'); cue.setAttribute('aria-live', 'polite'); cue.dataset.cue = '';
  // the 360 mode, step by step: the "stop" sign with how long the person has held still, and the photo's preview
  const holdSign = el('div', 'gc-hold'); holdSign.dataset.hold = ''; holdSign.hidden = true;
  const holdBar = el('i'), holdTrack = el('span', 'gc-hold-bar');
  holdTrack.append(holdBar); holdSign.append(el('b', '', W.holdSign), holdTrack);
  const preview = el('div', 'gc-step-preview'); preview.dataset.stepPreview = ''; preview.hidden = true;
  stage.append(video, overlay, buckets, holdSign, cue, preview);
  stage.hidden = true;
  const actions = el('div', 'gc-row');
  const startB = btn(W.startCapture, 'gc-btn gc-btn--primary');
  const anywayB = btn(W.anyway, 'gc-btn'); anywayB.hidden = true;
  const voiceL = el('label', 'gc-row'); const voice = el('input'); voice.type = 'checkbox'; voice.checked = true; voiceL.append(voice, c.doc.createTextNode(W.voice));
  actions.append(startB, anywayB, voiceL);
  const status = el('p', 'gc-muted'); status.setAttribute('role', 'status');
  const review = el('div'); review.dataset.review = '';
  cap.append(el('h2', '', W.setupCard), setupList, el('p', 'gc-note', W.laptopNote), ...(lastLine ? [lastLine] : []), modes, modeNote, stage, actions, status, review);

  const services = browserServices();
  let lease: CameraLease | null = null, offFrame: (() => void) | null = null, stopTrace: (() => void) | null = null, ac: AbortController | null = null;
  let capture: Capture | null = null;
  /** the pixels kept for each bucket, with the points of the very frame they come from */
  const kept = new Map<Bucket, { jpeg: Uint8Array<ArrayBuffer>; thumb: Uint8Array<ArrayBuffer>; w: number; h: number; light: LightStats | null; lm: Landmark[] }>();
  const grabbedAt = new Map<Bucket, number>();
  let lastLm: Landmark[] | null = null, lastAspect = 3 / 4, frameNo = 0, lastSharp = 0;
  const small = el('canvas'); small.width = 120; small.height = 160;
  const ref = sessions[0]?.s ?? null;

  function say(code: string): void {
    if (!voice.checked || !('speechSynthesis' in c.win)) return;
    try { const u = new SpeechSynthesisUtterance(code); u.lang = c.tag; c.win.speechSynthesis.cancel(); c.win.speechSynthesis.speak(u); } catch { /* no speech */ }
  }
  let lastCue = '';
  function drawBuckets(s: CaptureState | null): void {
    const wanted = capture?.wanted ?? [];
    buckets.replaceChildren(...wanted.map((b) => {
      const x = el('span', 'gc-bucket', W[dirKey(b)]);
      x.dataset.bucket = String(b);
      const filled = s ? s.filled.includes(b) : !!capture?.result.some((r) => r.bucket === b);
      // the 360 mode lights the direction asked for; the quick mode the one the person is in
      const now = s?.step ? s.step.targets.includes(b) || s.step.pending === b : s?.bucket === b;
      x.dataset.state = filled ? 'filled' : now ? 'now' : 'empty';
      return x;
    }));
  }
  function cueText(s: CaptureState): string {
    if (!s.cue) return '';
    if (s.cue === 'turn-to' && s.step) return s.step.targets.length > 1 ? W.cueTurnEither : s.step.targets[0] !== undefined ? fill(W.cueTurnTo, { dir: W[dirKey(s.step.targets[0])] }) : '';
    return W[CUE_KEY[s.cue]];
  }
  /** The 360 photo waiting for an answer: its thumbnail, retake and continue. */
  function showPreview(b: Bucket, thumb: Uint8Array<ArrayBuffer> | null): void {
    preview.replaceChildren();
    const img = el('img'); img.alt = W[dirKey(b)];
    if (thumb) { const u = URL.createObjectURL(new Blob([thumb], { type: 'image/jpeg' })); img.src = u; disposers.push(() => URL.revokeObjectURL(u)); }
    const again = btn(W.retake, 'gc-btn', () => {
      capture?.retake(); kept.delete(b); preview.hidden = true; anywayB.hidden = false;
    });
    again.dataset.stepRetake = '';
    const next = btn(W.continue, 'gc-btn gc-btn--primary', () => {
      capture?.accept(); preview.hidden = true; anywayB.hidden = false; drawBuckets(null);
      if (capture?.isDone()) void finishCapture();
    });
    next.dataset.stepContinue = '';
    const row = el('div', 'gc-row'); row.append(again, next);
    preview.dataset.bucket = String(b);
    preview.append(img, el('b', '', W[dirKey(b)]), row);
    preview.hidden = false; anywayB.hidden = true;
    next.focus({ preventScroll: true });
  }
  function drawOverlay(): void {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    const g = overlay.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, w, h);
    // the earlier photo of this direction, a thin ghost to stand into (mirrored like the live picture)
    const b = capture ? (capture.tracker.path.at(-1) ?? 0) : 0;
    const refShot = ref?.shots.find((s) => s.bucket === b);
    if (refShot) { g.globalAlpha = 0.35; drawFigure(g, refShot.lm, w, h, '#7FD8FF', 3, true); g.globalAlpha = 1; }
    if (lastLm) drawFigure(g, lastLm, w, h, '#22C383', 4, true);
  }

  /** The pixels of this moment: the video frame, or (trace) a drawing of the body. */
  async function grab(lm: Landmark[]): Promise<{ jpeg: Uint8Array<ArrayBuffer>; thumb: Uint8Array<ArrayBuffer>; w: number; h: number; light: LightStats | null; lm: Landmark[] }> {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = vw ? Math.min(1, 1080 / Math.max(vw, vh)) : 1;
    const w = vw ? Math.round(vw * scale) : 720, h = vh ? Math.round(vh * scale) : 960;
    const cv = el('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    if (vw) g.drawImage(video, 0, 0, w, h);
    else { g.fillStyle = '#2A2148'; g.fillRect(0, 0, w, h); drawFigure(g, lm, w, h, '#F4F2F8', 10); }
    const sm = el('canvas'); sm.width = 48; sm.height = 64; sm.getContext('2d')!.drawImage(cv, 0, 0, 48, 64);
    const light = lightStats(sm.getContext('2d')!.getImageData(0, 0, 48, 64), boxOf(lm));
    const th = el('canvas'); th.height = 256; th.width = Math.round((256 * w) / h); th.getContext('2d')!.drawImage(cv, 0, 0, th.width, th.height);
    return { jpeg: await toJpeg(cv), thumb: await toJpeg(th, 0.8), w, h, light, lm };
  }

  function onFrame(f: PoseFrame): void {
    if (!capture) return;
    lastLm = f.landmarks; lastAspect = f.aspect || lastAspect;
    frameNo++;
    if (video.videoWidth && frameNo % 3 === 0) {
      const g = small.getContext('2d', { willReadFrequently: true });
      if (g) { g.drawImage(video, 0, 0, small.width, small.height); lastSharp = sharpness(g.getImageData(0, 0, small.width, small.height)); }
    }
    const s = capture.push({ t: f.t, lm: f.landmarks, aspect: f.aspect, sharp: video.videoWidth ? lastSharp : 1 });
    // encoding a full frame costs tens of ms: at most one grab per bucket every 200 ms (the shot keeps the grabbed frame's own points)
    if (capture.mode === 'quick' && s.bestChanged !== null && f.landmarks && f.t - (grabbedAt.get(s.bestChanged) ?? -1e9) >= 200) { const b = s.bestChanged, lm = f.landmarks.map((p) => ({ ...p })); grabbedAt.set(b, f.t); void grab(lm).then((g) => { if (!capture?.result.some((x) => x.bucket === b) || !kept.has(b)) kept.set(b, g); }); }
    if (s.justFilled !== null) beep();
    // a 360 photo was taken: keep its pixels and show it for "retake" or "continue"
    if (s.justPending !== null && f.landmarks) { const b = s.justPending, lm = f.landmarks.map((p) => ({ ...p })); beep(); void grab(lm).then((g) => { kept.set(b, g); if (capture?.pending?.bucket === b) showPreview(b, g.thumb); }); }
    if (s.step) {
      holdSign.hidden = s.cue !== 'hold';
      holdBar.style.width = `${Math.round(s.step.hold * 100)}%`;
      holdSign.dataset.progress = String(Math.round(s.step.hold * 100));
    }
    drawBuckets(s);
    const text = cueText(s);
    cue.textContent = text;
    if (text && text !== lastCue) { lastCue = text; say(text); }
    drawOverlay();
    if (s.done) void finishCapture();
  }

  let audio: AudioContext | null = null;
  function beep(): void {
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 990; g.gain.value = 0.0001; o.connect(g).connect(audio.destination);
      const t = audio.currentTime; g.gain.exponentialRampToValueAtTime(0.15, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.start(t); o.stop(t + 0.14);
    } catch { /* no audio */ }
  }

  function stopCamera(): void {
    ac?.abort(); ac = null; offFrame?.(); offFrame = null; stopTrace?.(); stopTrace = null;
    services.pose.detach(); lease?.release(); lease = null; video.srcObject = null;
    startB.textContent = W.startCapture; startB.dataset.on = 'false'; anywayB.hidden = true;
    holdSign.hidden = true; preview.hidden = true;
  }
  disposers.push(stopCamera);

  async function startCamera(): Promise<void> {
    capture = new Capture(mode, { needFeet: !c.traceUrl?.includes('knees') });
    kept.clear(); grabbedAt.clear(); review.replaceChildren(); stage.hidden = false; drawBuckets(null);
    const ctl = new AbortController(); ac = ctl;
    startB.disabled = true; status.textContent = W.loading;
    try {
      if (c.traceUrl) {
        const trace = parseTrace(await (await c.win.fetch(c.traceUrl)).json());
        const src = traceSource(trace);
        offFrame = services.pose.onFrame(onFrame);
        services.pose.attach(src);
        await src.start();
        stopTrace = () => src.stop();
      } else {
        lease = await services.camera.acquire({ signal: ctl.signal });
        if (ctl.signal.aborted) { lease.release(); lease = null; return; }
        await lease.start();
        video.srcObject = lease.stream; await video.play();
        await services.pose.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: 'GPU', maxHz: 30, signal: ctl.signal });
        await services.pose.warmUp();
        if (ctl.signal.aborted) return;
        offFrame = services.pose.onFrame(onFrame);
        services.pose.attach(lease);
      }
      status.textContent = '';
      startB.textContent = W.stopCapture; startB.dataset.on = 'true'; anywayB.hidden = false;
    } catch {
      if (!ctl.signal.aborted) { stopCamera(); status.textContent = W.cameraError; }
    } finally { startB.disabled = false; }
  }
  startB.addEventListener('click', () => { if (startB.dataset.on === 'true') stopCamera(); else void startCamera(); });
  anywayB.addEventListener('click', () => {
    if (!capture || !lastLm) return;
    const b = capture.force();
    if (b !== null) {
      const lm = lastLm.map((p) => ({ ...p }));
      void grab(lm).then((g) => {
        kept.set(b, g);
        if (capture?.mode === 'full') { showPreview(b, g.thumb); return; }
        drawBuckets(null); if (capture?.isDone()) void finishCapture();
      });
    }
  });

  let finishing = false;
  async function finishCapture(): Promise<void> {
    if (finishing || !capture) return;
    finishing = true;
    stopCamera();
    // wait for the last frames' pixels
    for (let i = 0; i < 40 && capture.result.some((s) => !kept.has(s.bucket)); i++) await new Promise((r) => setTimeout(r, 50));
    const shots = capture.result;
    review.replaceChildren(el('h3', '', W.review));
    const grid = el('div', 'gc-shots');
    for (const s of shots) {
      const k = kept.get(s.bucket);
      const cell = el('div', 'gc-shot'); cell.dataset.shot = String(s.bucket);
      const img = el('img'); img.alt = W[dirKey(s.bucket)];
      if (k) { const u = URL.createObjectURL(new Blob([k.thumb], { type: 'image/jpeg' })); img.src = u; disposers.push(() => URL.revokeObjectURL(u)); }
      cell.append(img, el('span', '', W[dirKey(s.bucket)] + (s.approximate ? ` (${W.approx})` : '')));
      grid.append(cell);
    }
    const prevFront = sessions.at(-1)?.s.shots.find((x) => x.bucket === 0)?.light ?? null;
    const nowFront = kept.get(0)?.light ?? null;
    const warn = prevFront && nowFront && lightDiffers(prevFront, nowFront) ? el('p', 'gc-note', W.lightWarn) : null;
    const note = el('input'); note.type = 'text'; note.maxLength = 80; note.dataset.note = '';
    const saveB = btn(W.save, 'gc-btn gc-btn--primary', async () => {
      saveB.disabled = true;
      const rec: PhotoSession = { at: Date.now(), mode: capture!.mode, note: note.value.trim(), shots: [] };
      for (const s of shots) {
        const k = kept.get(s.bucket);
        if (!k) continue;
        const photo = newId(), thumb = newId();
        await c.vault.putBytes('photos', photo, k.jpeg);
        await c.vault.putBytes('thumbs', thumb, k.thumb);
        rec.shots.push({ bucket: s.bucket, photo, thumb, lm: k.lm.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(3), visibility: +p.visibility.toFixed(2) })), aspect: s.aspect, w: k.w, h: k.h, approximate: s.approximate, forced: s.forced, light: k.light });
      }
      await c.vault.putJson('sessions', newId(), rec);
      const first = c.settings.firstPhotoAt === null;
      await c.saveSettings({ photosSinceBackup: c.settings.photosSinceBackup + rec.shots.length, ...(first ? { firstPhotoAt: Date.now() } : {}) });
      if (first) await askPersist(c.win.navigator.storage as never);
      c.toast(W.saved);
      c.refresh();
    });
    review.append(grid, ...(warn ? [warn] : []), field(c, W.note, note), saveB);
    finishing = false;
  }

  // ---------------- compare ----------------
  const cmp = el('section', 'gc-card'); cmp.dataset.compare = '';
  right.append(cmp);
  cmp.append(el('h2', '', W.compare));
  if (sessions.length < 1) cmp.append(el('p', 'gc-muted', W.noPhotos));
  else {
    const opts: [string, string][] = sessions.map(({ id, s }) => [id, c.date(s.at)]);
    const selA = select(c, opts, sessions[0]!.id), selB = select(c, opts, sessions.at(-1)!.id);
    selA.dataset.dateA = ''; selB.dataset.dateB = '';
    const dirs: Bucket[] = [0, 90, 180, 270, 45, 135, 225, 315];
    const selD = select(c, dirs.map((b) => [String(b), W[dirKey(b)]] as [string, string]), '0'); selD.dataset.direction = '';
    let view: 'side' | 'slider' | 'overlay' | 'turn' | 'lapse' = 'side';
    let mirror = false, blur = false, amount = 0.5;
    const form = el('div', 'gc-form');
    form.append(field(c, W.dateA, selA), field(c, W.dateB, selB), field(c, W.direction, selD));
    const viewChips = chips(c, [['side', W.sideBySide], ['slider', W.slider], ['overlay', W.overlay], ['turn', `${W.turntable} · ${W.proTag}`], ['lapse', `${W.timelapse} · ${W.proTag}`]] as const, ['side'], false, (v) => {
      const want = v[0] as typeof view;
      if ((want === 'turn' && !c.access.can('growth:turntable')) || (want === 'lapse' && !c.access.can('growth:timelapse'))) { c.toast(W.proLocked); return; }
      view = want; void draw();
    }, 'view');
    const area = el('div'); area.dataset.compareArea = '';
    const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '50'; range.setAttribute('aria-label', W.slider);
    range.addEventListener('input', () => { amount = Number(range.value) / 100; void draw(); });
    const line = el('p', 'gc-muted'); line.dataset.compareLine = '';
    const tools = el('div', 'gc-row');
    tools.append(
      chips(c, [['m', W.mirror]] as const, [], true, (v) => { mirror = v.includes('m'); void draw(); }, 'mirror'),
      chips(c, [['b', W.blurFace]] as const, [], true, (v) => { blur = v.includes('b'); void draw(); }, 'blur'),
      btn(W.exportImage, 'gc-btn', () => void exportImage()),
      btn(`${W.exportGif} · ${W.proTag}`, 'gc-btn', () => { if (!c.access.can('growth:timelapse')) { c.toast(W.proLocked); return; } void exportGif(); }));
    cmp.append(form, viewChips, area, range, line, tools);
    [selA, selB, selD].forEach((s) => s.addEventListener('change', () => void draw()));
    const cache = new Map<string, ImageBitmap>();
    const bmp = async (id: string): Promise<ImageBitmap | null> => { if (!cache.has(id)) { const b = await bitmapOf(c, id); if (b) cache.set(id, b); } return cache.get(id) ?? null; };
    disposers.push(() => { for (const b of cache.values()) b.close(); });
    const shotOf = (sid: string, b: Bucket): ShotRecord | undefined => sessions.find((x) => x.id === sid)?.s.shots.find((s) => s.bucket === b);
    const poseOf = (s: ShotRecord): PhotoPose => ({ lm: s.lm, w: s.w, h: s.h });

    const paint = async (cv: HTMLCanvasElement, s: ShotRecord | undefined, clip?: { from: number; to: number }, alpha = 1): Promise<void> => {
      const g = cv.getContext('2d'); if (!g || !s) return;
      const img = await bmp(s.photo); if (!img) return;
      const tr = alignTransform(poseOf(s), cv.width, cv.height); if (!tr) return;
      g.save();
      if (clip) { g.beginPath(); g.rect(clip.from * cv.width, 0, (clip.to - clip.from) * cv.width, cv.height); g.clip(); }
      if (mirror) { g.translate(cv.width, 0); g.scale(-1, 1); }
      g.globalAlpha = alpha;
      applyTransform(g, tr);
      g.drawImage(img, 0, 0);
      if (blur) {
        const n = s.lm[LM.nose], l = s.lm[LM.leftShoulder], r = s.lm[LM.rightShoulder];
        if (n && l && r) {
          const rad = Math.max(Math.abs(l.x - r.x) * s.w * 0.55, 0.09 * s.h);
          g.save(); g.beginPath(); g.arc(n.x * s.w, n.y * s.h - rad * 0.15, rad, 0, Math.PI * 2); g.clip(); g.filter = 'blur(18px)'; g.drawImage(img, 0, 0); g.restore();
        }
      }
      g.restore();
    };
    const canvas = (): HTMLCanvasElement => { const cv = el('canvas'); cv.width = 600; cv.height = 800; return cv; };
    let lapseTimer = 0;
    async function draw(): Promise<void> {
      c.win.clearInterval(lapseTimer);
      const b = Number(selD.value) as Bucket;
      const A = shotOf(selA.value, b), B = shotOf(selB.value, b);
      const sa = sessions.find((x) => x.id === selA.value)!.s, sb = sessions.find((x) => x.id === selB.value)!.s;
      line.textContent = c.t('days', { n: Math.round(Math.abs(sb.at - sa.at) / 86_400_000) }) + (A && B && postureDiffers(poseOf(A), poseOf(B)) ? ` · ${W.postureWarn}` : '');
      range.hidden = !(view === 'slider' || view === 'overlay');
      area.dataset.mode = view;
      if (view === 'side') {
        const pair = el('div', 'gc-pair'); const ca = canvas(), cb = canvas();
        for (const cv of [ca, cb]) { const w = el('div', 'gc-compare'); w.append(cv); pair.append(w); }
        area.replaceChildren(pair); await paint(ca, A); await paint(cb, B);
      } else if (view === 'slider' || view === 'overlay') {
        const w = el('div', 'gc-compare'); const cv = canvas(); w.append(cv); area.replaceChildren(w);
        if (view === 'slider') { await paint(cv, A, { from: 0, to: amount }); await paint(cv, B, { from: amount, to: 1 }); const g = cv.getContext('2d')!; g.fillStyle = '#FFC53A'; g.fillRect(amount * cv.width - 2, 0, 4, cv.height); }
        else { await paint(cv, A); await paint(cv, B, undefined, amount); }
      } else if (view === 'turn') {
        const pair = el('div', 'gc-pair'); const ca = canvas(), cb = canvas();
        for (const cv of [ca, cb]) { const w = el('div', 'gc-compare'); w.append(cv); pair.append(w); }
        area.replaceChildren(pair);
        const order: Bucket[] = [0, 45, 90, 135, 180, 225, 270, 315];
        let k = 0;
        const step = async (): Promise<void> => {
          const bb = order[k++ % order.length]!;
          for (const [cv, sid] of [[ca, selA.value], [cb, selB.value]] as const) { const s = shotOf(sid, bb); cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height); await paint(cv, s); }
        };
        await step(); lapseTimer = c.win.setInterval(() => void step(), 700);
      } else {
        const w = el('div', 'gc-compare'); const cv = canvas(); w.append(cv); area.replaceChildren(w);
        const all = sessions.map((x) => x.s.shots.find((s) => s.bucket === b)).filter((s): s is ShotRecord => !!s);
        let k = 0;
        const step = async (): Promise<void> => { cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height); await paint(cv, all[k++ % Math.max(1, all.length)]); };
        await step(); lapseTimer = c.win.setInterval(() => void step(), 600);
      }
    }
    disposers.push(() => c.win.clearInterval(lapseTimer));
    async function exportImage(): Promise<void> {
      const b = Number(selD.value) as Bucket;
      const out = el('canvas'); out.width = 1200; out.height = 860;
      const g = out.getContext('2d')!; g.fillStyle = '#140F27'; g.fillRect(0, 0, out.width, out.height);
      for (const [i, sid] of [selA.value, selB.value].entries()) {
        const cv = canvas(); await paint(cv, shotOf(sid, b));
        g.drawImage(cv, i * 600, 0, 600, 800);
        g.fillStyle = '#F4F2F8'; g.font = '700 26px -apple-system,Segoe UI,Roboto,Arial,sans-serif';
        g.fillText(c.date(sessions.find((x) => x.id === sid)!.s.at), i * 600 + 20, 840);
      }
      const bytes = await toJpeg(out, 0.9);
      await saveFile(c.win, bytes, `bodyarcade-${new Date().toISOString().slice(0, 10)}.jpg`, 'image/jpeg');
    }
    /** Every session's photo of the chosen direction, aligned, as a looping GIF (made here, from the vault's photos). */
    async function exportGif(): Promise<void> {
      const b = Number(selD.value) as Bucket;
      const frames = [];
      for (const { s } of sessions) {
        const shot = s.shots.find((x) => x.bucket === b);
        if (!shot) continue;
        const cv = el('canvas'); cv.width = 360; cv.height = 480;
        const g = cv.getContext('2d')!; g.fillStyle = '#140F27'; g.fillRect(0, 0, cv.width, cv.height);
        await paint(cv, shot);
        g.fillStyle = '#F4F2F8'; g.font = '700 18px -apple-system,Segoe UI,Roboto,Arial,sans-serif'; g.fillText(c.date(s.at), 12, cv.height - 14);
        frames.push(g.getImageData(0, 0, cv.width, cv.height));
      }
      if (!frames.length) return;
      await saveFile(c.win, encodeGif(frames, 70), `bodyarcade-${new Date().toISOString().slice(0, 10)}.gif`, 'image/gif');
    }
    await draw();
  }

  // ---------------- timeline ----------------
  const tl = el('section', 'gc-card'); tl.dataset.timeline = '';
  right.append(tl);
  tl.append(el('h2', '', W.timeline));
  const list = el('ul', 'gc-list');
  for (const { id, s } of [...sessions].reverse()) {
    const li = el('li'); li.dataset.session = id;
    const img = el('img'); img.width = 48; img.height = 64; img.style.borderRadius = '6px'; img.style.objectFit = 'cover'; img.alt = '';
    const front = s.shots.find((x) => x.bucket === 0) ?? s.shots[0];
    if (front) { const u = await urlOf(c, front.thumb); if (u) { img.src = u; disposers.push(() => URL.revokeObjectURL(u)); } }
    const text = el('span'); text.append(el('b', '', c.date(s.at)), c.doc.createTextNode(` · ${s.shots.length} · ${s.note}`));
    li.append(img, text, btn(W.deleteSession, 'gc-btn', async () => {
      for (const x of s.shots) { await c.vault.remove('photos', x.photo); await c.vault.remove('thumbs', x.thumb); }
      await c.vault.remove('sessions', id);
      c.refresh();
    }));
    list.append(li);
  }
  if (!sessions.length) list.append(el('li', 'gc-muted', W.noPhotos));
  tl.append(list, btn(`${W.reminder} · ${W.every2w}`, 'gc-btn', () => void saveFile(c.win, new Blob([icsReminder(W.title)], { type: 'text/calendar' }), 'bodyarcade-progress.ics', 'text/calendar')));

  return () => { for (const d of disposers) d(); try { void audio?.close(); } catch { /* closed */ } };
}

/** A repeating calendar event every 2 weeks (the person's own calendar; nothing comes back to us). */
export function icsReminder(title: string, start = new Date(Date.now() + 86_400_000)): string {
  const d = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}${String(start.getDate()).padStart(2, '0')}`;
  const uid = `${d}-${Math.random().toString(36).slice(2)}@bodyarcade.com`;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BodyArcade//Progress coach//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${d}T090000`, `DTEND:${d}T091500`, 'RRULE:FREQ=WEEKLY;INTERVAL=2', `SUMMARY:${title.replace(/[,;\\]/g, ' ')}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
