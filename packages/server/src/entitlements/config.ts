// What the Worker's secrets and variables mean for the entitlement engine. Everything is optional here: a missing or broken
// setting turns that one capability off (and is named in `problems`, never its value), it never stops the module.
import { GUMROAD_PRODUCTS } from '../../../core/entitlements/catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, isPlanId, type PlanId } from '../../../core/entitlements/plans.ts';
import { importSigningKey, parsePrivateJwk, publicKeyOf } from '../../../core/entitlements/sign.ts';
import type { TokenKey } from '../../../core/entitlements/token.ts';
import type { Signer } from './engine.ts';
import { parseServiceAccount, type ServiceAccount } from './upstream/google.ts';

export interface LoadedConfig {
  signer: Signer | null;
  publicKeys: TokenKey[];
  /** Gumroad product id -> plan: the products of this release first, the two sold before v2 after them. */
  products: Map<string, PlanId>;
  playAccount: ServiceAccount | null;
  mail: { token: string; from: string } | null;
  noLimits: boolean;
  /** Names of settings that were present but unusable, or that are missing and matter. Never values. */
  problems: string[];
}

const PRODUCT_ID_RE = /^[A-Za-z0-9_=-]{8,64}$/;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** `{ "<product id>": "<plan id>" }`; entries that are not that are dropped. */
export function parseProducts(text: unknown): Record<string, PlanId> {
  if (typeof text !== 'string' || text.trim() === '') return {};
  let j: unknown;
  try { j = JSON.parse(text) as unknown; } catch { return {}; }
  if (!isRecord(j)) return {};
  const out: Record<string, PlanId> = {};
  for (const [id, plan] of Object.entries(j)) if (PRODUCT_ID_RE.test(id) && isPlanId(plan)) out[id] = plan;
  return out;
}

/** A JSON array of { kid, jwk } with only the public half of each key. */
export function parsePublicKeys(text: unknown): TokenKey[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  let j: unknown;
  try { j = JSON.parse(text) as unknown; } catch { return []; }
  if (!Array.isArray(j)) return [];
  const out: TokenKey[] = [];
  for (const k of j) {
    if (!isRecord(k) || typeof k['kid'] !== 'string' || !isRecord(k['jwk'])) continue;
    const { kty, crv, x, y } = k['jwk'];
    if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') continue;
    out.push({ kid: k['kid'], jwk: { kty, crv, x, y } });
  }
  return out;
}

/** `catalog`: the products of this release; default the catalog of the repository (a test passes its own, so it does not move with it). */
export async function loadConfig(env: Record<string, unknown>, o: { catalog?: Readonly<Record<string, PlanId>> } = {}): Promise<LoadedConfig> {
  const problems: string[] = [];
  const publicKeys: TokenKey[] = [];

  let signer: Signer | null = null;
  const rawKey = env['ENT_PRIV_JWK'];
  if (typeof rawKey !== 'string' || rawKey === '') {
    problems.push('ENT_PRIV_JWK missing');
  } else {
    const priv = parsePrivateJwk(rawKey);
    if (!priv) problems.push('ENT_PRIV_JWK unusable');
    else {
      try {
        signer = { kid: priv.kid, key: await importSigningKey(priv) };
        publicKeys.push(publicKeyOf(priv));
      } catch {
        problems.push('ENT_PRIV_JWK unusable');
      }
    }
  }
  for (const k of parsePublicKeys(env['ENT_PUB_JWKS'])) if (!publicKeys.some((p) => p.kid === k.kid)) publicKeys.push(k);

  const products = new Map<string, PlanId>();
  for (const [id, plan] of Object.entries({ ...(o.catalog ?? GUMROAD_PRODUCTS), ...parseProducts(env['GUMROAD_PRODUCTS']) })) products.set(id, plan);
  for (const [id, plan] of Object.entries(GUMROAD_LEGACY_PRODUCTS)) if (!products.has(id)) products.set(id, plan);

  let playAccount: ServiceAccount | null = null;
  if (typeof env['PLAY_SA_JSON'] === 'string' && env['PLAY_SA_JSON'] !== '') {
    playAccount = parseServiceAccount(env['PLAY_SA_JSON']);
    if (!playAccount) problems.push('PLAY_SA_JSON unusable');
  }

  const token = env['ENT_MAIL_TOKEN'];
  const from = env['ENT_MAIL_FROM'];
  const mail = typeof token === 'string' && token.length >= 8 && typeof from === 'string' && /@/.test(from) && from.length <= 200 ? { token, from } : null;
  if ((typeof token === 'string' && token !== '') !== (typeof from === 'string' && from !== '') ) problems.push('ENT_MAIL_TOKEN and ENT_MAIL_FROM go together');

  return { signer, publicKeys, products, playAccount, mail, noLimits: env['ENT_NO_LIMITS'] === '1', problems };
}
