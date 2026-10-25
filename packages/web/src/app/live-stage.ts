// What a race in a room draws on the stage of the round, over the game (builder N): a tile for each of the others (their camera
// while it really flows, otherwise their skeleton from the frames of their page, their name and points, a line and a retry button
// when their camera did not connect), the line that says who the start waits for or who holds the race and why, the Room's own
// 3-2-1 in big numbers, the messages and reactions the others send as a bubble on their tile, and a row of reactions to send
// while the race is not running (nobody taps a screen in the middle of a squat). Free text is never typed here: the room's page has
// the box, where the room allows it. Everything gives way to a panel of the round (the calibration, a pause, an error).
import { BODY_STYLES, bodyScale, createPoints, drawSkeleton, toCanvasPoints } from '../../../core/render2d/body.ts';
import type { Ctx2D } from '../../../core/render2d/ctx.ts';
import { REACTIONS, type ReactionId } from '../../../core/types/net.ts';
import type { Unsubscribe } from '../../../core/types/index.ts';
import type { I18n } from '../../../core/ui/i18n/index.ts';
import { REACTION_ART } from '../social/screens/room.ts';
import type { LiveMessage, LiveSource, LiveTile, LiveView } from './live-race.ts';
import { lrText } from './live-strings.ts';
import type { RaceStageMount } from './race.ts';

/** What the line of the stage says, from what the race is doing: empty while it runs (the game speaks then). Pure. */
export function statusOf(v: LiveView, i18n: Pick<I18n, 'tx'>): string {
  const t = lrText(i18n);
  if (!v.online) return t('offline');
  switch (v.phase) {
    case 'wait':
      if (v.alone) return t('wait.alone');
      if (v.waiting.length === 1) return t('wait.one', { name: v.waiting[0] ?? '' });
      if (v.waiting.length > 1) return t('wait.many', { n: v.waiting.length });
      return t('wait.start');
    case 'watch': return t('watch');
    case 'count': return v.count > 0 ? t('count', { n: v.count }) : '';
    case 'hold': {
      const [one, ...more] = v.held;
      if (!one) return '';
      return more.length > 0 ? t('hold.many', { n: v.held.length }) : t(`hold.${one.reason}`, { name: one.name });
    }
    case 'over': return t('settle');
    default: return '';
  }
}

/** What the HUD shows on the stage (the plates, the command, the self view): the line and the reactions keep clear of it. */
const HUD_PARTS = '.ba-hud .hud-plate:not([hidden]), .ba-hud .hud-command:not([hidden]), .ba-hud .tile';
const GAP = 8;

interface Box { top: number; bottom: number; left: number; right: number }
const meets = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Where a box that may move only up or down goes so that it overlaps none of `parts`: from where its style put it, it steps past
 * each part it meets (below it, or above it), a few times at most. Pure: the offset in pixels (0 when nothing is in the way).
 */
export function clearOf(box: Box, parts: readonly Box[], dir: 'down' | 'up'): number {
  let dy = 0;
  for (let i = 0; i < 6; i++) {
    const at = { ...box, top: box.top + dy, bottom: box.bottom + dy };
    const hit = parts.find((p) => meets(at, p));
    if (!hit) return dy;
    dy += dir === 'down' ? hit.bottom + GAP - at.top : hit.top - GAP - at.bottom;
  }
  return dy;
}

/** Moves an element of the layer up or down out of the way of the HUD (a browser only; nothing to do where there is no layout). */
function keepClear(stage: HTMLElement, el: HTMLElement, dir: 'down' | 'up'): void {
  if (el.hidden || typeof stage.querySelectorAll !== 'function' || typeof el.getBoundingClientRect !== 'function') return;
  el.style.translate = '';
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const parts = [...stage.querySelectorAll<HTMLElement>(HUD_PARTS)].map((x) => x.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
  const dy = clearOf(r, parts, dir);
  if (dy !== 0) el.style.translate = `0 ${Math.round(dy)}px`;
}

const TILE_W = 120;
const TILE_H = 90;
const BUBBLE_MS = 3200;

interface TileEls { li: HTMLLIElement; canvas: HTMLCanvasElement; video: HTMLVideoElement; name: HTMLElement; score: HTMLElement; note: HTMLElement; retry: HTMLButtonElement; bubble: HTMLElement; bubbleTimer: ReturnType<typeof setTimeout> | null; stream: MediaStream | null }

export interface LiveStageOptions {
  /** How often the stage is drawn again (default 100 ms: a skeleton at ten frames a second is enough for a tile). */
  everyMs?: number;
}

/** Draws the race of a room on the stage until the returned function is called. */
export function mountLiveStage(m: RaceStageMount, src: LiveSource, o: LiveStageOptions = {}): Unsubscribe {
  const doc = m.document;
  const layer = doc.createElement('div');
  layer.className = 'lr-layer';
  layer.setAttribute('data-live-race', '');
  layer.dataset['room'] = src.room;
  const status = doc.createElement('p');
  status.className = 'lr-status';
  status.setAttribute('role', 'status');
  status.setAttribute('data-lr-status', '');
  const count = doc.createElement('div');
  count.className = 'lr-count';
  count.setAttribute('aria-hidden', 'true');
  count.setAttribute('data-lr-count', '');
  const tiles = doc.createElement('ul');
  tiles.className = 'lr-tiles';
  tiles.setAttribute('data-lr-tiles', '');
  const reacts = doc.createElement('div');
  reacts.className = 'lr-reacts';
  reacts.setAttribute('role', 'group');
  reacts.setAttribute('data-lr-reacts', '');
  layer.append(status, count, tiles, reacts);
  m.stage.append(layer);

  const els = new Map<string, TileEls>();
  const pts = createPoints();
  let lang = '';
  let lastStatus = '';

  const words = (): void => {
    const i18n = m.i18n();
    if (i18n.lang === lang) return;
    lang = i18n.lang;
    const t = lrText(i18n);
    tiles.setAttribute('aria-label', t('tiles'));
    reacts.setAttribute('aria-label', t('reacts'));
    reacts.replaceChildren(...REACTIONS.map((id: ReactionId) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'lr-react';
      b.dataset['lrReact'] = id;
      b.setAttribute('aria-label', i18n.t('room.react.send', { name: i18n.tx(`room.react.${id}`) }));
      // the drawings are written in room.ts and hold nothing from outside
      b.innerHTML = REACTION_ART[id];
      return b;
    }));
    for (const e of els.values()) e.retry.textContent = i18n.t('common.retry');
  };

  const tileOf = (seat: string): TileEls => {
    let e = els.get(seat);
    if (e) return e;
    const li = doc.createElement('li');
    li.className = 'lr-tile';
    li.dataset['seat'] = seat;
    const pic = doc.createElement('div');
    pic.className = 'lr-pic';
    const canvas = doc.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    canvas.setAttribute('aria-hidden', 'true');
    const video = doc.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.hidden = true;
    video.setAttribute('aria-hidden', 'true');
    const bubble = doc.createElement('span');
    bubble.className = 'lr-bubble';
    bubble.hidden = true;
    pic.append(canvas, video, bubble);
    const row = doc.createElement('div');
    row.className = 'lr-who';
    const name = doc.createElement('span');
    name.className = 'lr-name';
    const score = doc.createElement('b');
    score.className = 'lr-score';
    row.append(name, score);
    const note = doc.createElement('p');
    note.className = 'lr-note';
    note.setAttribute('role', 'status');
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'lr-retry';
    retry.dataset['lrRetry'] = seat;
    retry.hidden = true;
    retry.textContent = m.i18n().t('common.retry');
    li.append(pic, row, note, retry);
    tiles.append(li);
    e = { li, canvas, video, name, score, note, retry, bubble, bubbleTimer: null, stream: null };
    els.set(seat, e);
    return e;
  };

  const drawTile = (e: TileEls, tile: LiveTile): void => {
    const i18n = m.i18n();
    e.li.dataset['show'] = tile.show;
    e.li.classList.toggle('is-out', tile.out || !tile.online);
    if (e.name.textContent !== tile.name) e.name.textContent = tile.name;
    const pts$ = i18n.number(tile.score);
    if (e.score.textContent !== pts$) e.score.textContent = pts$;
    e.li.dataset['score'] = String(tile.score);
    const note = tile.out ? lrText(i18n)('left', { name: tile.name }) : tile.note ? i18n.t(tile.note) : '';
    if (e.note.textContent !== note) e.note.textContent = note;
    e.note.hidden = note === '';
    e.retry.hidden = !tile.retry;
    // the camera picture while it flows, else the skeleton
    const video = tile.show === 'video' && tile.stream ? tile.stream : null;
    if (video !== e.stream) {
      e.stream = video;
      e.video.srcObject = video;
      if (video) void e.video.play?.()?.catch?.(() => undefined);
    }
    e.video.hidden = !video;
    e.canvas.hidden = !!video;
    const g = video ? null : (e.canvas.getContext('2d') as Ctx2D | null);
    if (g) {
      g.clearRect(0, 0, TILE_W, TILE_H);
      if (tile.pose && toCanvasPoints(tile.pose, { x: 0, y: 0, w: TILE_W, h: TILE_H }, pts)) {
        drawSkeleton(g, pts, BODY_STYLES[2], bodyScale(pts, TILE_W * 0.25));
        e.li.dataset['skeleton'] = '1';
      } else e.li.dataset['skeleton'] = '0';
    } else if (!video) e.li.dataset['skeleton'] = tile.pose ? '1' : '0';
  };

  const draw = (): void => {
    words();
    const i18n = m.i18n();
    const v = src.view();
    const busy = m.busy();
    layer.dataset['phase'] = v.phase;
    layer.dataset['online'] = v.online ? '1' : '0';
    layer.dataset['match'] = v.match ?? '';
    layer.dataset['seed'] = v.seed === null ? '' : String(v.seed);
    layer.classList.toggle('is-busy', busy);
    const text = statusOf(v, i18n);
    if (text !== lastStatus) { lastStatus = text; status.textContent = text; }
    status.hidden = busy || text === '';
    const n = v.phase === 'count' && v.count > 0 ? String(v.count) : '';
    if (count.textContent !== n) count.textContent = n;
    count.hidden = busy || n === '';
    reacts.hidden = busy || v.phase === 'run' || v.alone;
    tiles.hidden = busy || v.tiles.length === 0;
    // the line goes below the command and the plates at the top, the reactions above the hint and the self view at the bottom
    keepClear(m.stage, status, 'down');
    keepClear(m.stage, reacts, 'up');
    const seen = new Set<string>();
    for (const tile of v.tiles) {
      seen.add(tile.seat);
      drawTile(tileOf(tile.seat), tile);
    }
    for (const [seat, e] of els) if (!seen.has(seat)) { if (e.bubbleTimer) clearTimeout(e.bubbleTimer); e.li.remove(); els.delete(seat); }
  };

  const said = (msg: LiveMessage): void => {
    const e = els.get(msg.seat);
    if (!e) return;
    const i18n = m.i18n();
    if (msg.react) {
      e.bubble.innerHTML = REACTION_ART[msg.react];
      e.bubble.setAttribute('role', 'img');
      e.bubble.setAttribute('aria-label', i18n.tx(`room.react.${msg.react}`));
    } else {
      e.bubble.removeAttribute('role');
      e.bubble.removeAttribute('aria-label');
      e.bubble.textContent = msg.preset ? i18n.tx(`room.say.${msg.preset}`) : (msg.text ?? '');
    }
    e.bubble.dataset['kind'] = msg.react ? 'react' : 'say';
    e.bubble.hidden = false;
    if (!msg.react) m.announce(lrText(i18n)('said', { name: msg.name, text: e.bubble.textContent ?? '' }));
    if (e.bubbleTimer) clearTimeout(e.bubbleTimer);
    e.bubbleTimer = setTimeout(() => { e.bubble.hidden = true; e.bubbleTimer = null; }, BUBBLE_MS);
  };

  const onClick = (ev: Event): void => {
    const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-lr-react], [data-lr-retry]');
    if (!el) return;
    ev.preventDefault();
    const react = el.dataset['lrReact'];
    if (react && (REACTIONS as readonly string[]).includes(react)) src.react(react as ReactionId);
    const seat = el.dataset['lrRetry'];
    if (seat) { src.retryVideo(seat); m.announce(m.i18n().t('room.video.connecting')); }
  };
  layer.addEventListener('click', onClick);
  const offMsg = src.onMessage(said);
  draw();
  const timer = setInterval(draw, o.everyMs ?? 100);

  return () => {
    clearInterval(timer);
    offMsg();
    layer.removeEventListener('click', onClick);
    for (const e of els.values()) { if (e.bubbleTimer) clearTimeout(e.bubbleTimer); e.video.srcObject = null; }
    els.clear();
    layer.remove();
  };
}
