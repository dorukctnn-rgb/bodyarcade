// The test entry of the Worker (wrangler.test.jsonc): the production Worker plus hooks that only tests may call.
// Production never bundles this file, so /api/admin/* does not exist there.
import { router } from './router.ts';
import { HttpError, json } from './http.ts';
import { normalizeRoomCode } from '../../core/net/codes.ts';
import type { Fetcher } from './cf.ts';
import type { LiveEnv } from './live/env.ts';
import { Room as LiveRoom } from './live/room.ts';
import worker from './index.ts';

export default worker;

/** The Room with test hooks: kick every socket (what a deploy does), and look at the room's state. */
export class Room extends LiveRoom {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/admin/kick-all') { this.engine.closeAll(1012, 'service restart'); return json({ ok: true }); }
    if (url.pathname === '/admin/state') return json(this.engine.inspect());
    return super.fetch(req);
  }
}

function stubOf(env: Record<string, unknown>, raw: string | null): Fetcher {
  const code = normalizeRoomCode(raw ?? '');
  if (!code) throw new HttpError(400, 'bad_code');
  const e = env as unknown as LiveEnv;
  return e.ROOMS.get(e.ROOMS.idFromName(code));
}

router.add('POST', '/api/admin/kick-all', (req, env) => stubOf(env, new URL(req.url).searchParams.get('code')).fetch(new Request('https://room.internal/admin/kick-all')));
router.add('GET', '/api/admin/state', (req, env) => stubOf(env, new URL(req.url).searchParams.get('code')).fetch(new Request('https://room.internal/admin/state')));
