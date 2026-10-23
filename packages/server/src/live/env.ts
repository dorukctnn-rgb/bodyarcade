// What the live-play module reads from the Worker's env. Each server module narrows the shared env object to its own
// bindings like this, so nobody edits a shared Env type.
import type { DurableObjectNamespaceLike, Fetcher } from '../cf.ts';

export interface LiveEnv {
  /** Durable Object namespace of the Room class. */
  ROOMS: DurableObjectNamespaceLike;
  ASSETS?: Fetcher;
  /** Worker secret, at least 32 characters: signs join tickets and derives block keys. */
  TICKET_SECRET: string;
  /** Origin of the public site for invite links (https://bodyarcade.com); the request's own origin when absent. */
  PUBLIC_ORIGIN?: string;
  /** Cloudflare Realtime TURN key (secrets). Without them only STUN is offered. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Tests: a local TURN server, comma-separated urls, and its long-term credentials. */
  ICE_LOCAL_TURN?: string;
  ICE_LOCAL_USER?: string;
  ICE_LOCAL_PASS?: string;
  /** Tests: raise the per-IP limits so a suite from one address does not hit them. "1" disables them. */
  LIVE_NO_LIMITS?: string;
}
