// ICE servers for WebRTC (tech.md 2.3): STUN always, TURN credentials minted per request from the Cloudflare Realtime
// TURN key (the key never reaches the browser). Without a key only STUN is offered and the Room relay carries the match.
import type { IceGrant } from '../../../core/types/net.ts';
import type { LiveEnv } from './env.ts';

const STUN = { urls: 'stun:stun.cloudflare.com:3478' };
const TTL_S = 4 * 3600;

/** Browsers refuse the alternate port 53 (tech.md 2.3). */
export function withoutPort53(urls: string | string[]): string | string[] {
  const keep = (u: string) => !/:53(\?|$)/.test(u);
  return Array.isArray(urls) ? urls.filter(keep) : keep(urls) ? urls : [];
}

export async function iceGrant(env: LiveEnv, nowMs: number, fetcher: typeof fetch = fetch): Promise<IceGrant> {
  const exp = Math.floor(nowMs / 1000) + TTL_S;
  if (env.ICE_LOCAL_TURN) {
    // tests: a local TURN server with long-term credentials
    return { iceServers: [STUN, { urls: env.ICE_LOCAL_TURN.split(','), username: env.ICE_LOCAL_USER ?? '', credential: env.ICE_LOCAL_PASS ?? '' }], turn: true, exp };
  }
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_S }),
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const j = (await r.json()) as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[] };
        const servers = (j.iceServers ?? [])
          .map((s) => ({ ...s, urls: withoutPort53(s.urls) }))
          .filter((s) => (Array.isArray(s.urls) ? s.urls.length > 0 : s.urls.length > 0));
        if (servers.length) return { iceServers: servers, turn: servers.some((s) => s.credential !== undefined), exp };
      }
      console.log(JSON.stringify({ evt: 'ice_error', status: r.status }));
    } catch (e) {
      console.log(JSON.stringify({ evt: 'ice_error', error: String(e) }));
    }
  }
  return { iceServers: [STUN], turn: false, exp };
}
