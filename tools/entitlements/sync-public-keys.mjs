// Copies the entitlement tokens' PUBLIC keys from the release owner's secrets folder into
// packages/core/entitlements/keys.ts, so a new key is one command and never a hand copy.
//
//   node tools/entitlements/sync-public-keys.mjs            rewrite keys.ts from the two public key files
//   node tools/entitlements/sync-public-keys.mjs --check    exit 1 when keys.ts differs from them (nothing is written)
//
// Only <target>.entitlements-public.jwk.json is read, never the *.secrets.json next to it. A file that carries a private
// member ("d") is refused without printing it. Folder: BA_SECRETS_DIR, else ~/apps/_tools/bodyarcade-tools/secrets
// (the same as release/secrets.ts).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TARGETS = ['preview', 'production'];
const BEGIN = '// BEGIN public keys (written by tools/entitlements/sync-public-keys.mjs)';
const END = '// END public keys';

/** A JWK as the app's TokenKey, or throws. Never echoes the input. */
export function toTokenKey(jwk) {
  if (typeof jwk !== 'object' || jwk === null) throw new Error('the key file is not a JSON object');
  if ('d' in jwk) throw new Error('the key file has a private member; only the public key may be copied');
  const { kty, crv, x, y, kid } = jwk;
  if (kty !== 'EC' || crv !== 'P-256') throw new Error('the key is not an EC P-256 key');
  for (const [name, v] of [['x', x], ['y', y], ['kid', kid]]) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(v)) throw new Error(`the key's ${name} is missing or malformed`);
  }
  return { kid, jwk: { kty, crv, x, y } };
}

const q = (s) => `'${s}'`;

/** The text between the markers of keys.ts. */
export function render(keys) {
  const lines = TARGETS.map((t) => {
    const list = keys[t].map((k) => `{ kid: ${q(k.kid)}, jwk: { kty: ${q(k.jwk.kty)}, crv: ${q(k.jwk.crv)}, x: ${q(k.jwk.x)}, y: ${q(k.jwk.y)} } }`);
    return `  ${t}: [${list.join(', ')}],`;
  });
  return `${BEGIN}\nexport const PUBLIC_KEYS: Readonly<Record<ReleaseTarget, readonly TokenKey[]>> = {\n${lines.join('\n')}\n};\n${END}`;
}

/** keys.ts with the block between the markers replaced. */
export function replaceBlock(source, block) {
  const text = source.replace(/\r\n/g, '\n');
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error('keys.ts has lost its BEGIN/END markers');
  const out = `${text.slice(0, a)}${block}${text.slice(b + END.length)}`;
  return source.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out;
}

export function readKeys(dir) {
  const keys = {};
  for (const t of TARGETS) {
    const file = join(dir, `${t}.entitlements-public.jwk.json`);
    if (!existsSync(file)) throw new Error(`missing ${file}`);
    keys[t] = [toTokenKey(JSON.parse(readFileSync(file, 'utf8')))];
  }
  if (keys.preview[0].kid === keys.production[0].kid) throw new Error('preview and production share a key id');
  return keys;
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(here).href) {
  const dir = process.env.BA_SECRETS_DIR ?? join(homedir(), 'apps', '_tools', 'bodyarcade-tools', 'secrets');
  const target = join(here, '..', '..', '..', 'packages', 'core', 'entitlements', 'keys.ts');
  try {
    const next = replaceBlock(readFileSync(target, 'utf8'), render(readKeys(dir)));
    if (process.argv.includes('--check')) {
      if (readFileSync(target, 'utf8') !== next) { console.error('keys.ts differs from the public key files: run node tools/entitlements/sync-public-keys.mjs'); process.exit(1); }
      console.log('keys.ts matches the public key files');
    } else {
      writeFileSync(target, next);
      console.log('keys.ts written');
    }
  } catch (e) {
    console.error(`sync-public-keys: ${e instanceof Error ? e.message : 'failed'}`);
    process.exit(1);
  }
}
