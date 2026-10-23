// can(feature): who may use what. A free player gets what is free; a paid plan gets everything, except the family
// features, which need the Family plan (or a founder, who has them from the $99 purchase).
import type { Entitlement, FeatureId } from '../types/index.ts';

/** 'game:squat-flap', 'world:alps', 'difficulty:hard', 'history:full', 'family', 'profiles:6', 'live:ranked'. */
const FEATURE_RE = /^[a-z][a-z0-9]{0,15}(?::[A-Za-z0-9][A-Za-z0-9._-]{0,47})?$/;

/** What stays free besides the free games: the three free worlds of the runner and the two easier difficulties. */
export const DEFAULT_FREE_FEATURES: ReadonlySet<FeatureId> = new Set([
  'world:alps', 'world:desert', 'world:forest', 'difficulty:easy', 'difficulty:medium',
]);

/** Features that belong to the family profiles, not to Pro. */
const FAMILY_FEATURES: ReadonlySet<string> = new Set(['family', 'profiles']);

export interface FeatureRules {
  /** A game that is free for everyone (the manifests' `free` flag). Games not named here are Pro. */
  isFreeGame?: (gameId: string) => boolean;
  /** Free features other than games. */
  free?: ReadonlySet<FeatureId> | ((feature: FeatureId) => boolean);
}

export function hasFamilyFeatures(e: Entitlement): boolean {
  return e.plan === 'family' || e.founder === true;
}

export function canUse(feature: FeatureId, e: Entitlement, rules: FeatureRules = {}): boolean {
  if (typeof feature !== 'string' || !FEATURE_RE.test(feature)) return false;
  const [kind = '', rest] = feature.split(':') as [string, string | undefined];
  if (FAMILY_FEATURES.has(kind)) return e.plan !== 'free' && hasFamilyFeatures(e);
  if (e.plan !== 'free') return true;
  if (kind === 'game') return rest !== undefined && (rules.isFreeGame?.(rest) ?? false);
  const free = rules.free ?? DEFAULT_FREE_FEATURES;
  return typeof free === 'function' ? free(feature) === true : free.has(feature);
}
