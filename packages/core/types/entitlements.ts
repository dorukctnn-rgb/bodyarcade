// core/entitlements: who may use what. Providers: Gumroad (web only), Play Billing (Play only), our server.
import type { Unsubscribe } from './common.ts';

/** 'game:squat-flap', 'worlds:all', 'difficulty:hard', 'history:full', 'family', 'live:ranked' ... */
export type FeatureId = string;

export type Plan = 'free' | 'pro' | 'family' | 'lifetime';

export interface Entitlement {
  plan: Plan;
  /** Earlier $99 lifetime buyers (BUILD-PLAN pricing). */
  founder?: boolean;
  source: 'gumroad' | 'play' | 'server' | 'none';
  /** Epoch ms when a paid period ends; absent for lifetime and active subscriptions. */
  exp?: number;
  token?: string;
}

export type ActivateFailureCode = 'not_found' | 'refunded' | 'ended' | 'limit' | 'network' | 'server';

export type ActivateResult =
  | { ok: true; e: Entitlement }
  | { ok: false; code: ActivateFailureCode; message: string };

export interface EntitlementProvider {
  readonly id: Entitlement['source'];
  activate(input: string): Promise<ActivateResult>;
  // 'keep' on network errors, 5xx, 429 and unparsable bodies; only an explicit refusal returns 'revoked' (B2, rule 6).
  refresh(e: Entitlement): Promise<Entitlement | 'keep' | 'revoked'>;
}

export interface Entitlements {
  current(): Entitlement;
  can(f: FeatureId): boolean;
  use(p: EntitlementProvider): void;
  onChange(cb: (e: Entitlement) => void): Unsubscribe;
}
