// A stand-in for core/entitlements (builder S) until it lands: it holds the plan in the store, says honestly that the
// license server cannot be reached when a key is typed, and in the demo build accepts one fixed key so the Pro screens
// can be walked through. Swap in boot.ts when the real module exists.
import type { ActivateFailureCode, Plan, Unsubscribe } from '../../../core/types/index.ts';
import type { EntitlementsPort } from './ports.ts';

export const DEMO_KEY = 'PRO-DEMO-0000';

export interface LocalEntitlementsOptions {
  initial?: Plan;
  /** Accept DEMO_KEY (development and test builds only). */
  demo?: boolean;
  /** Where the plan is remembered; null keeps it in memory. */
  save?: (plan: Plan) => void;
}

export function localEntitlements(o: LocalEntitlementsOptions = {}): EntitlementsPort & { set(plan: Plan): void } {
  let plan: Plan = o.initial ?? 'free';
  const listeners = new Set<(p: Plan) => void>();
  const set = (p: Plan): void => {
    if (p === plan) return;
    plan = p;
    o.save?.(p);
    for (const cb of [...listeners]) cb(p);
  };
  return {
    plan: () => plan,
    set,
    onChange(cb): Unsubscribe {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    async activate(key) {
      const clean = key.trim().toUpperCase();
      if (o.demo && clean === DEMO_KEY) { set('pro'); return { ok: true, plan: 'pro' }; }
      if (clean.length < 8) return { ok: false, code: 'not_found' as ActivateFailureCode };
      return { ok: false, code: 'network' as ActivateFailureCode };
    },
  };
}
