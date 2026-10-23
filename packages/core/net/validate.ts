// Schema checks for every message on the Room socket. The Room parses client messages strictly (anything odd is
// dropped and answered with error 'bad'); the client parses Room messages loosely (unknown types are ignored, so a
// newer Room can add messages without breaking older pages of the same protocol version).
import {
  PRESETS, REACTIONS, REPORT_REASONS, CLIENT_PAUSE_REASONS,
  type ClientMessage, type NetPauseReason, type ObstacleResult, type PresetId, type ReactionId, type ReportReason,
  type RoomMessage, type SignalData,
} from '../types/net.ts';

/** Largest client message the Room reads (an SDP offer with video is about 6-8 KB). */
export const MAX_CLIENT_MESSAGE = 32 * 1024;
/** Largest relayed game state. */
export const MAX_RELAY_CHARS = 2048;
export const MAX_FINAL_EVENTS = 600;
export const MAX_BLOCKS = 200;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isOutcome = (v: unknown): v is 'pass' | 'hit' => v === 'pass' || v === 'hit';

function signalData(v: unknown): SignalData | null {
  if (!isRec(v) || !isId(v.sess) || !isId(v.rsess)) return null;
  const out: SignalData = { sess: v.sess, rsess: v.rsess };
  if (v.description !== undefined) {
    const d = v.description;
    if (!isRec(d) || !isStr(d.type, 16) || (d.sdp !== undefined && !isStr(d.sdp, 24_000))) return null;
    out.description = d.sdp === undefined ? { type: d.type } : { type: d.type, sdp: d.sdp };
  }
  if (v.candidate !== undefined) {
    const c = v.candidate;
    if (c === null) out.candidate = null;
    else {
      if (!isRec(c)) return null;
      if (c.candidate !== undefined && !isStr(c.candidate, 1024)) return null;
      if (c.sdpMid !== undefined && c.sdpMid !== null && !isStr(c.sdpMid, 64)) return null;
      if (c.sdpMLineIndex !== undefined && c.sdpMLineIndex !== null && !isInt(c.sdpMLineIndex, 0, 64)) return null;
      if (c.usernameFragment !== undefined && c.usernameFragment !== null && !isStr(c.usernameFragment, 256)) return null;
      out.candidate = {
        candidate: c.candidate as string | undefined,
        sdpMid: (c.sdpMid ?? null) as string | null,
        sdpMLineIndex: (c.sdpMLineIndex ?? null) as number | null,
        usernameFragment: (c.usernameFragment ?? null) as string | null,
      };
    }
  }
  return out;
}

function obstacleList(v: unknown): ObstacleResult[] | null {
  if (!Array.isArray(v) || v.length > MAX_FINAL_EVENTS) return null;
  const out: ObstacleResult[] = [];
  for (const e of v) {
    if (!isRec(e) || !isInt(e.ob, 1, 100_000) || !isOutcome(e.k)) return null;
    out.push({ ob: e.ob, k: e.k });
  }
  return out;
}

/** The client message in `raw`, or null when it is malformed in any way. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_CLIENT_MESSAGE) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!isRec(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello': {
      if (!isInt(m.v, 0, 1000) || !isId(m.tab) || !isId(m.sess) || typeof m.video !== 'boolean') return null;
      if (!Array.isArray(m.reasons) || m.reasons.length > 8 || !m.reasons.every((r) => CLIENT_PAUSE_REASONS.includes(r as NetPauseReason))) return null;
      if (!Array.isArray(m.blocks) || m.blocks.length > MAX_BLOCKS || !m.blocks.every((b) => isId(b))) return null;
      return { t: 'hello', v: m.v, tab: m.tab, sess: m.sess, video: m.video, reasons: m.reasons as NetPauseReason[], blocks: m.blocks as string[] };
    }
    case 'sync':
      return typeof m.c === 'number' && Number.isFinite(m.c) ? { t: 'sync', c: m.c } : null;
    case 'signal': {
      const d = signalData(m.d);
      return isId(m.to) && d ? { t: 'signal', to: m.to, d } : null;
    }
    case 'sess':
      return isId(m.sess) ? { t: 'sess', sess: m.sess } : null;
    case 'video':
      return typeof m.on === 'boolean' ? { t: 'video', on: m.on } : null;
    case 'ready':
      return typeof m.ready === 'boolean' ? { t: 'ready', ready: m.ready } : null;
    case 'config': {
      const out: { t: 'config'; gameId?: string; durationMs?: number } = { t: 'config' };
      if (m.gameId !== undefined) { if (typeof m.gameId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(m.gameId)) return null; out.gameId = m.gameId; }
      if (m.durationMs !== undefined) { if (!isInt(m.durationMs, 1, 3_600_000)) return null; out.durationMs = m.durationMs; }
      return out;
    }
    case 'kick':
      return isId(m.seat) ? { t: 'kick', seat: m.seat } : null;
    case 'ev':
      return isId(m.mid) && isInt(m.seq, 1, 1e9) && isInt(m.ob, 1, 100_000) && isOutcome(m.k)
        ? { t: 'ev', mid: m.mid, seq: m.seq, ob: m.ob, k: m.k } : null;
    case 'final': {
      const evs = obstacleList(m.evs);
      return isId(m.mid) && evs ? { t: 'final', mid: m.mid, evs } : null;
    }
    case 'relay': {
      if (m.d === undefined) return null;
      const size = JSON.stringify(m.d).length;
      return size <= MAX_RELAY_CHARS ? { t: 'relay', d: m.d } : null;
    }
    case 'pause':
      return CLIENT_PAUSE_REASONS.includes(m.reason as NetPauseReason) ? { t: 'pause', reason: m.reason as NetPauseReason } : null;
    case 'unpause':
      return { t: 'unpause' };
    case 'chat':
      return typeof m.text === 'string' && m.text.length <= 2000 ? { t: 'chat', text: m.text } : null;
    case 'preset':
      return PRESETS.includes(m.id as PresetId) ? { t: 'preset', id: m.id as PresetId } : null;
    case 'react':
      return REACTIONS.includes(m.id as ReactionId) ? { t: 'react', id: m.id as ReactionId } : null;
    case 'block':
      return isId(m.seat) ? { t: 'block', seat: m.seat } : null;
    case 'report':
      return isId(m.seat) && REPORT_REASONS.includes(m.reason as ReportReason) && typeof m.block === 'boolean'
        ? { t: 'report', seat: m.seat, reason: m.reason as ReportReason, block: m.block } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

const ROOM_TYPES = new Set([
  'welcome', 'sync', 'presence', 'room', 'signal', 'start', 'paused', 'resumed', 'forfeit', 'settling', 'ack', 'relay',
  'result', 'chat', 'preset', 'react', 'chat_rejected', 'blocked', 'reported', 'removed', 'error',
]);

/** A Room message, checked only for its type tag (the Room is trusted); null for unknown or malformed text. */
export function parseRoomMessage(raw: unknown): RoomMessage | null {
  if (typeof raw !== 'string') return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  return isRec(m) && typeof m.t === 'string' && ROOM_TYPES.has(m.t) ? (m as unknown as RoomMessage) : null;
}
