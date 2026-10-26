// The Worker's secrets per target, kept in a local file outside the repository (never committed, never printed).
//   node release/secrets.ts status preview          which secrets the file has (names only)
//   node release/secrets.ts init preview            generate the ones that can be generated, keep existing values
// The deploy (release/deploy.ts) uploads the file with the version (`wrangler deploy --secrets-file`).
// Default folder: C:\Users\doruk\apps\_tools\bodyarcade-tools\secrets (BA_SECRETS_DIR moves it).
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TargetId } from './site.ts';

export interface SecretSpec {
  name: string;
  /** Who needs it and what happens without it. */
  why: string;
  required: boolean;
  /** With `required`: only the production Worker needs it (the preview serves no Android app and no Play purchase). */
  productionOnly?: boolean;
  /** How to make a value here, or null when only a person can provide it (a dashboard key, a store account). */
  generate: (() => string) | null;
}

const random = (bytes: number): string => randomBytes(bytes).toString('base64url');

/** An ES256 key pair as JWK: the private key is the secret, the public key goes to the client (entitlements). */
export function es256Pair(): { privateJwk: string; publicJwk: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = random(6);
  const priv = { ...privateKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig', kid };
  const pub = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig', kid };
  return { privateJwk: JSON.stringify(priv), publicJwk: JSON.stringify(pub) };
}

/** Must this target's secrets file hold it? (required, and for the production Worker only when productionOnly.) */
export function isRequired(s: Pick<SecretSpec, 'required' | 'productionOnly'>, target: TargetId): boolean {
  return s.required && (s.productionOnly !== true || target === 'production');
}

export const SECRETS: readonly SecretSpec[] = [
  { name: 'TICKET_SECRET', why: 'live play: signs room tickets and block keys (the Worker refuses to make rooms without it)', required: true, generate: () => random(36) },
  { name: 'ADMIN_TOKEN', why: 'social: the moderation API, which is how every report is read (it answers 404 without it, so no report could be read and the promise on the privacy page that a person reads each one would break)', required: true, generate: () => random(32) },
  { name: 'ENT_PRIV_JWK', why: "entitlements: signs Pro tokens (ES256); the public half goes to the client; its public half also checks the host's Pro token before a Pro game starts in a room (without it a room never starts a Pro game, free games are not affected)", required: false, generate: null },
  { name: 'TURN_KEY_ID', why: 'live video between friends behind strict NATs: Cloudflare Realtime TURN key id (STUN only without it)', required: false, generate: null },
  { name: 'TURN_KEY_API_TOKEN', why: 'the API token of that TURN key', required: false, generate: null },
  { name: 'PLAY_SA_JSON', why: 'entitlements: Google Play purchase checks (service account JSON: client_email and private_key, with the Play permissions of the app). Without it no Play purchase can be verified, so the Android app must not reach a tester or a buyer without it (the production deploy stops)', required: true, productionOnly: true, generate: null },
  { name: 'ENT_MAIL_TOKEN', why: 'entitlements: the ForwardEmail API token that sends the one trial-reminder e-mail on the web (goes with ENT_MAIL_FROM; without both the reminder box stays off)', required: false, generate: null },
  { name: 'ENT_MAIL_FROM', why: 'entitlements: the sender of that e-mail, for example "BodyArcade <info@bodyarcade.com>" (goes with ENT_MAIL_TOKEN; without both the reminder box stays off)', required: false, generate: null },
];

export function secretsDir(): string {
  return process.env['BA_SECRETS_DIR'] ?? join(homedir(), 'apps', '_tools', 'bodyarcade-tools', 'secrets');
}

export function secretsFile(target: TargetId): string {
  return join(secretsDir(), `${target}.secrets.json`);
}

export function readSecrets(target: TargetId): Record<string, string> {
  const f = secretsFile(target);
  if (!existsSync(f)) return {};
  const data = JSON.parse(readFileSync(f, 'utf8')) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${f} is not a JSON object`);
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.length > 0)) as Record<string, string>;
}

/** Fills in what can be generated; existing values are never replaced. Returns the names it added. */
export function initSecrets(target: TargetId): string[] {
  mkdirSync(secretsDir(), { recursive: true });
  const have = readSecrets(target);
  const added: string[] = [];
  for (const s of SECRETS) {
    if (have[s.name]) continue;
    if (s.name === 'ENT_PRIV_JWK') {
      const pair = es256Pair();
      have[s.name] = pair.privateJwk;
      writeFileSync(join(secretsDir(), `${target}.entitlements-public.jwk.json`), `${pair.publicJwk}\n`);
      added.push(s.name);
      continue;
    }
    if (s.generate) { have[s.name] = s.generate(); added.push(s.name); }
  }
  writeFileSync(secretsFile(target), `${JSON.stringify(have, null, 2)}\n`, { mode: 0o600 });
  return added;
}

export function status(target: TargetId): { name: string; present: boolean; required: boolean; why: string }[] {
  const have = readSecrets(target);
  return SECRETS.map((s) => ({ name: s.name, present: !!have[s.name], required: isRequired(s, target), why: s.why }));
}

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const [cmd, target] = process.argv.slice(2) as [string, TargetId];
  if (!['status', 'init'].includes(cmd) || !['preview', 'production'].includes(target)) {
    console.error('usage: node release/secrets.ts status|init preview|production');
    process.exit(2);
  }
  if (cmd === 'init') {
    mkdirSync(secretsDir(), { recursive: true });
    const added = initSecrets(target);
    console.log(added.length ? `generated: ${added.join(', ')}` : 'nothing to generate');
  }
  for (const s of status(target)) console.log(`${s.present ? 'set    ' : isRequired(s, target) ? 'MISSING' : 'missing'} ${s.name}: ${s.why}`);
  console.log(`file: ${secretsFile(target)}`);
}
