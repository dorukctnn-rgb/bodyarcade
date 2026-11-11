// The vertical clip of a round: nine seconds, 9:16, made on this device when the player asks for it on the results screen, for a story,
// a reel or a TikTok. It shows the game (the round's own highlight when there is one: the game view, never the camera; else the game's
// picture), the player's 3D figure doing the game's move and then cheering, and the score card: the score counting up, a personal best,
// two or three numbers of the round, and at the end where to play. bodyarcade.com is written small at the bottom of every frame.
//
// There is no camera picture in it at all: the figure is posed from the game's move (story-pose.ts), not from the player's body, and the
// scene is the game's view or its picture. The file is made by the browser's MediaRecorder from a canvas (MP4 where the browser makes it,
// else WebM) in real time, so it takes the nine seconds it lasts; nothing of it leaves the device until the player shares or saves it.
import { CLIP_BRAND, clipKind, type ClipFile, type RecorderCtor, type RecorderLike } from './clip.ts';
import { cheerPose, mixPoses, movePose, STAND, type StoryMove, type StoryPose } from './story-pose.ts';
import { drawFigure, MOVER_NIGHT, type MoverStyle } from '../../../games/_shared/mover.ts';
import type { Ctx2D } from '../../../core/render2d/ctx.ts';

export const STORY_W = 720;
export const STORY_H = 1280;
export const STORY_MS = 9000;
export const STORY_FPS = 30;
export const STORY_BITS = 4_000_000;

/** Where the figure stage sits on the picture (the WebGL canvas is drawn there). */
export const FIGURE_BOX = { x: 0, y: 250, w: 720, h: 740 } as const;
/** The game's picture, behind the figure. */
export const SCENE_BOX = { x: 48, y: 168, w: 624, h: 468, r: 34 } as const;
/** The score card, under the figure. */
export const CARD_BOX = { x: 40, y: 960, w: 640, h: 236, r: 34 } as const;

/** The moments of the clip, in milliseconds. */
export const BEATS = {
  introEnd: 900,
  countFrom: 1400,
  countTo: 4400,
  badge: 4600,
  stats: 5100,
  cheerFrom: 5600,
  cheerTo: 6600,
  outro: 7500,
} as const;

export interface StoryPlayer { label: string; score: number; colour: string; winner: boolean }

/** Everything the picture says, already in the page's language. */
export interface StoryText {
  game: string;
  level: string;
  /** "points in 3:00" */
  unit: string;
  stats: readonly { value: string; label: string }[];
  /** "Personal best", or null. */
  best: string | null;
  /** The last frames: "Can you beat 1,240?" and "Play free at bodyarcade.com". */
  challenge: string;
  cta: string;
  /** Two players: each one's score, and who won (or null for one player). */
  players: readonly [StoryPlayer, StoryPlayer] | null;
  verdict: string | null;
}

export interface StoryInput {
  text: StoryText;
  score: number;
  /** The score as the page writes numbers. */
  format(n: number): string;
  move: StoryMove;
  players: 1 | 2;
  /** The game view (the round's highlight video) or the game's picture; null: the background alone. */
  scene: CanvasImageSource | null;
  /** Smaller camera moves (the player asked for less motion). */
  reducedMotion: boolean;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const ease = (x: number): number => 1 - (1 - clamp01(x)) ** 3;
const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));

/** The score shown at `tMs`: 0 until the count starts, the full score from its end, counted up in between (fast first, then slow). */
export function countedScore(score: number, tMs: number): number {
  const s = Math.max(0, Math.round(score));
  return Math.round(s * ease(span(tMs, BEATS.countFrom, BEATS.countTo)));
}

/** How far each part of the picture has come in at `tMs` (0 to 1). */
export function storyPhase(tMs: number): { intro: number; count: number; badge: number; stats: number; cheer: number; outro: number } {
  return {
    intro: ease(span(tMs, 0, BEATS.introEnd)),
    count: span(tMs, BEATS.countFrom, BEATS.countTo),
    badge: ease(span(tMs, BEATS.badge, BEATS.badge + 350)),
    stats: ease(span(tMs, BEATS.stats, BEATS.stats + 500)),
    cheer: tMs < BEATS.cheerFrom || tMs > BEATS.cheerTo ? -1 : span(tMs, BEATS.cheerFrom, BEATS.cheerTo),
    outro: ease(span(tMs, BEATS.outro, BEATS.outro + 600)),
  };
}

/** The figure's pose at `tMs`: still for a moment, the game's move, the cheer when the score is in, the move again more gently. */
export function storyPoseAt(move: StoryMove, tMs: number, player = 0): StoryPose {
  const t = tMs + player * 180;   // two players do not move as one
  const ph = storyPhase(tMs);
  const still: StoryPose = { limbs: STAND, fwd: {}, twist: 0, lift: 0 };
  if (tMs < 300) return still;
  const moving = mixPoses(still, movePose(move, t - 300), span(tMs, 300, 700));
  if (ph.cheer >= 0) {
    const c = cheerPose(ph.cheer);
    // into the cheer quickly and out of it at the end
    return mixPoses(moving, c, Math.min(span(tMs, BEATS.cheerFrom, BEATS.cheerFrom + 150), 1 - span(tMs, BEATS.cheerTo - 150, BEATS.cheerTo)));
  }
  return moving;
}

/** The file's name: the game and the score, so a folder of clips reads well. */
export function storyFileName(slug: string, score: number, ext: 'mp4' | 'webm'): string {
  return `bodyarcade-${slug}-${Math.max(0, Math.round(score))}-vertical.${ext}`;
}

const STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const INK = '#1C1433';
const CHALK = '#F4F2F8';
const SUN = '#FFC53A';
const FLUSH = '#FF4F6E';

type Pen = CanvasRenderingContext2D;

function round(c: Pen, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  if (typeof c.roundRect === 'function') c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
}

/** The largest size up to `px` at which `text` fits in `maxW`. */
export function fitSize(measure: (font: string) => number, text: string, px: number, maxW: number, weight = 800, min = 12): number {
  let size = px;
  while (size > min && measure(`${weight} ${size}px ${STACK}`) > maxW) size -= 2;
  return size;
}

function text(c: Pen, s: string, x: number, y: number, o: { px: number; weight?: number; colour?: string; align?: CanvasTextAlign; maxW?: number; alpha?: number }): void {
  if (!s) return;
  const weight = o.weight ?? 800;
  const px = o.maxW ? fitSize((f) => { c.font = f; return c.measureText(s).width; }, s, o.px, o.maxW, weight) : o.px;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.font = `${weight} ${px}px ${STACK}`;
  c.fillStyle = o.colour ?? CHALK;
  c.textAlign = o.align ?? 'left';
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
  c.restore();
}

/** The flat figure, for a browser that cannot draw the 3D one: the Mover in the pose of the moment. */
function flatFigure(c: Pen, p: StoryPose, x: number, colour: string | null): void {
  const style: MoverStyle = colour ? { ...MOVER_NIGHT, head: colour } : MOVER_NIGHT;
  const T = 150;
  drawFigure(c as unknown as Ctx2D, { x, y: FIGURE_BOX.y + FIGURE_BOX.h - 60 - 1.8 * T - p.lift * 300, T, limbs: p.limbs }, style);
}

/** One frame of the clip. `figure`: the 3D stage's canvas, drawn for this moment (null: the flat figure is drawn). */
export function paintStory(c: Pen, tMs: number, s: StoryInput, figure: CanvasImageSource | null): void {
  const ph = storyPhase(tMs);
  const t = s.text;
  c.save();
  // the background: the brand's night, a glow behind the figure
  const bg = c.createLinearGradient(0, 0, 0, STORY_H);
  bg.addColorStop(0, '#120C26');
  bg.addColorStop(0.55, '#2A1F55');
  bg.addColorStop(1, '#120C26');
  c.fillStyle = bg;
  c.fillRect(0, 0, STORY_W, STORY_H);
  const glow = c.createRadialGradient(STORY_W / 2, 760, 40, STORY_W / 2, 760, 460);
  glow.addColorStop(0, 'rgba(255, 197, 58, 0.30)');
  glow.addColorStop(1, 'rgba(255, 197, 58, 0)');
  c.fillStyle = glow;
  c.fillRect(0, 250, STORY_W, 900);

  // the game: its view or its picture, in a card that comes down and settles
  const drift = s.reducedMotion ? 0 : 1;
  const sy = SCENE_BOX.y - 40 * (1 - ph.intro) * drift;
  c.save();
  c.globalAlpha = ph.intro;
  round(c, SCENE_BOX.x, sy, SCENE_BOX.w, SCENE_BOX.h, SCENE_BOX.r);
  c.clip();
  c.fillStyle = '#3A2E6B';
  c.fillRect(SCENE_BOX.x, sy, SCENE_BOX.w, SCENE_BOX.h);
  if (s.scene) {
    try {
      const zoom = 1.12 - 0.08 * (tMs / STORY_MS) * drift;
      const w = SCENE_BOX.w * zoom;
      const h = SCENE_BOX.h * zoom;
      const src = sizeOf(s.scene);
      // cover the card: crop the picture to its shape
      const k = Math.max(w / src.w, h / src.h);
      const dw = src.w * k;
      const dh = src.h * k;
      c.drawImage(s.scene, SCENE_BOX.x + (SCENE_BOX.w - dw) / 2, sy + (SCENE_BOX.h - dh) / 2, dw, dh);
    } catch { /* a frame of the video that is not there yet */ }
  }
  const fade = c.createLinearGradient(0, sy + SCENE_BOX.h * 0.45, 0, sy + SCENE_BOX.h);
  fade.addColorStop(0, 'rgba(18, 12, 38, 0)');
  fade.addColorStop(1, 'rgba(18, 12, 38, 0.9)');
  c.fillStyle = fade;
  c.fillRect(SCENE_BOX.x, sy, SCENE_BOX.w, SCENE_BOX.h);
  c.restore();

  // the game's name and level over the top
  text(c, t.game, STORY_W / 2, 92, { px: 54, align: 'center', maxW: 620, alpha: ph.intro });
  text(c, t.level, STORY_W / 2, 136, { px: 28, weight: 700, colour: SUN, align: 'center', maxW: 600, alpha: ph.intro });

  // the figure (or figures), in front of the game
  if (figure) {
    try { c.drawImage(figure, FIGURE_BOX.x, FIGURE_BOX.y, FIGURE_BOX.w, FIGURE_BOX.h); } catch { /* the stage lost its picture */ }
  } else {
    const xs = s.players === 2 ? [STORY_W * 0.3, STORY_W * 0.7] : [STORY_W / 2];
    xs.forEach((x, i) => flatFigure(c, storyPoseAt(s.move, tMs, i), x, s.players === 2 ? (i === 0 ? SUN : '#46B4FF') : null));
  }

  // the score card
  const cy = CARD_BOX.y + 60 * (1 - ease(span(tMs, 900, 1500))) * drift;
  c.save();
  c.globalAlpha = ease(span(tMs, 900, 1500));
  round(c, CARD_BOX.x, cy, CARD_BOX.w, CARD_BOX.h, CARD_BOX.r);
  c.fillStyle = 'rgba(244, 242, 248, 0.96)';
  c.fill();
  if (s.players === 2 && t.players) {
    t.players.forEach((p, i) => {
      const x = CARD_BOX.x + (i === 0 ? CARD_BOX.w * 0.25 : CARD_BOX.w * 0.75);
      c.fillStyle = p.colour;
      c.fillRect(CARD_BOX.x + (i === 0 ? 24 : CARD_BOX.w / 2 + 12), cy + 26, CARD_BOX.w / 2 - 36, 8);
      text(c, p.label, x, cy + 76, { px: 28, weight: 700, colour: INK, align: 'center', maxW: CARD_BOX.w / 2 - 40 });
      text(c, s.format(countedScore(p.score, tMs)), x, cy + 158, { px: 78, colour: INK, align: 'center', maxW: CARD_BOX.w / 2 - 40 });
    });
    if (t.verdict) text(c, t.verdict, STORY_W / 2, cy + 212, { px: 28, weight: 750, colour: FLUSH, align: 'center', maxW: CARD_BOX.w - 60, alpha: ph.badge });
  } else {
    text(c, s.format(countedScore(s.score, tMs)), STORY_W / 2, cy + 128, { px: 112, colour: INK, align: 'center', maxW: CARD_BOX.w - 80 });
    text(c, t.unit, STORY_W / 2, cy + 172, { px: 28, weight: 650, colour: '#5B5375', align: 'center', maxW: CARD_BOX.w - 80 });
    // the numbers of the round
    const stats = t.stats.slice(0, 3);
    stats.forEach((st, i) => {
      const x = CARD_BOX.x + (CARD_BOX.w / (stats.length + 1)) * (i + 1);
      text(c, `${st.value} ${st.label}`, x, cy + 216, { px: 24, weight: 700, colour: INK, align: 'center', maxW: CARD_BOX.w / stats.length - 16, alpha: ph.stats });
    });
  }
  c.restore();

  // a personal best: a flush tab on the card's edge
  if (t.best && ph.badge > 0) {
    c.save();
    const scale = 0.6 + 0.4 * ph.badge;
    c.translate(STORY_W / 2, cy - 4);
    c.scale(scale, scale);
    c.globalAlpha = ph.badge;
    c.font = `800 30px ${STACK}`;
    const w = c.measureText(t.best).width + 48;
    round(c, -w / 2, -26, w, 52, 26);
    c.fillStyle = FLUSH;
    c.fill();
    text(c, t.best, 0, 11, { px: 30, colour: CHALK, align: 'center' });
    c.restore();
  }

  // the end: a dark veil over the game, the challenge and where to play
  if (ph.outro > 0) {
    c.save();
    c.globalAlpha = ph.outro;
    const veil = c.createLinearGradient(0, 0, 0, 560);
    veil.addColorStop(0, 'rgba(18, 12, 38, 0.92)');
    veil.addColorStop(0.55, 'rgba(18, 12, 38, 0.78)');
    veil.addColorStop(1, 'rgba(18, 12, 38, 0)');
    c.fillStyle = veil;
    c.fillRect(0, 0, STORY_W, 560);
    c.restore();
    text(c, t.challenge, STORY_W / 2, 236, { px: 50, align: 'center', maxW: 640, alpha: ph.outro });
    text(c, t.cta, STORY_W / 2, 292, { px: 32, weight: 700, colour: SUN, align: 'center', maxW: 640, alpha: ph.outro });
  }

  // the site, small, on every frame
  text(c, CLIP_BRAND, STORY_W / 2, STORY_H - 34, { px: 26, weight: 750, colour: 'rgba(244, 242, 248, 0.78)', align: 'center' });
  c.restore();
}

function sizeOf(src: CanvasImageSource): { w: number; h: number } {
  const v = src as Partial<HTMLVideoElement & HTMLImageElement & HTMLCanvasElement>;
  const w = v.videoWidth || v.naturalWidth || (typeof v.width === 'number' ? v.width : 0) || 1;
  const h = v.videoHeight || v.naturalHeight || (typeof v.height === 'number' ? v.height : 0) || 1;
  return { w, h };
}

// ---- making the file ---------------------------------------------------------------------------------------------------------

/** What making the file needs of the browser (tests give stand-ins). */
export interface StoryDeps {
  Recorder: RecorderCtor;
  kind: { mime: string; ext: 'mp4' | 'webm' };
  now(): number;
  /** Calls `fn` about every `ms` until the returned function is called. */
  every(fn: () => void, ms: number): () => void;
  /** The canvas the clip is drawn on, and its picture as a stream. */
  canvas(): { pen: Pen; stream: MediaStream; close(): void } | null;
}

/** The browser's own parts, or null where this browser makes no clip (no recorder, no picture of a canvas). */
export function storyDeps(win: Window & typeof globalThis): StoryDeps | null {
  const kind = clipKind(win);
  const Recorder = (win as unknown as { MediaRecorder?: RecorderCtor }).MediaRecorder;
  if (!kind || !Recorder) return null;
  return {
    Recorder,
    kind,
    now: () => win.performance.now(),
    every: (fn, ms) => { const id = win.setInterval(fn, ms); return () => win.clearInterval(id); },
    canvas: () => {
      try {
        const el = win.document.createElement('canvas');
        el.width = STORY_W;
        el.height = STORY_H;
        const pen = el.getContext('2d');
        if (!pen) return null;
        const stream = el.captureStream(STORY_FPS);
        return { pen, stream, close: () => { stream.getTracks().forEach((x) => x.stop()); el.width = 0; el.height = 0; } };
      } catch { return null; }
    },
  };
}

export interface StoryFigureSource {
  /** Draws the figures for this moment and hands back the picture (null: the flat figure). */
  frame(tMs: number): CanvasImageSource | null;
}

/**
 * Records the clip: every frame painted at its moment for STORY_MS, then the file. `progress` hears 0 to 1. Null when the browser
 * could not make it (the recorder failed, nothing was recorded). Never throws.
 */
export async function recordStory(deps: StoryDeps, input: StoryInput, figure: StoryFigureSource | null, o: { progress?: (u: number) => void } = {}): Promise<ClipFile | null> {
  const surface = deps.canvas();
  if (!surface) return null;
  let rec: RecorderLike;
  const chunks: Blob[] = [];
  try {
    rec = new deps.Recorder(surface.stream, { mimeType: deps.kind.mime, videoBitsPerSecond: STORY_BITS });
  } catch { surface.close(); return null; }
  const paint = (tMs: number): void => {
    try { paintStory(surface.pen, tMs, input, figure?.frame(tMs) ?? null); } catch { /* a frame that could not be drawn is skipped */ }
  };
  paint(0);
  const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); rec.onerror = () => resolve(); });
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  try { rec.start(); } catch { surface.close(); return null; }
  const t0 = deps.now();
  await new Promise<void>((resolve) => {
    const off = deps.every(() => {
      const t = Math.min(STORY_MS, deps.now() - t0);
      paint(t);
      o.progress?.(t / STORY_MS);
      if (t >= STORY_MS) { off(); resolve(); }
    }, 1000 / STORY_FPS);
  });
  try { rec.stop(); } catch { /* it stopped by itself */ }
  // a recorder that never says it stopped must not hold the page
  await Promise.race([stopped, new Promise<void>((resolve) => { const off = deps.every(() => { off(); resolve(); }, 2000); })]);
  surface.close();
  const mime = deps.kind.mime.split(';')[0] ?? 'video/webm';
  const blob = new Blob(chunks, { type: mime });
  if (blob.size === 0) return null;
  return { blob, mime, ext: deps.kind.ext, seconds: STORY_MS / 1000 };
}
