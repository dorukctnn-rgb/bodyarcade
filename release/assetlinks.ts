// Digital Asset Links of the Android app (Trusted Web Activity): release/static/.well-known/assetlinks.json says which signing
// certificates may open bodyarcade.com without an address bar. The app that Google Play hands out is signed with Play's own
// app-signing key, not with our upload key, so that key's SHA-256 must be in the file as well (Play Console > Test and release >
// App integrity > App signing > "App signing key certificate"). Without it the app opens bodyarcade.com in a Chrome tab.
//
//   node release/assetlinks.ts check                  what the file holds (fingerprints, never anything secret) and what is wrong with it
//   node release/assetlinks.ts add <SHA-256>          add the Play app-signing key (idempotent; with or without colons, any case)
//   add --file <path>  to work on another copy (a test, a preview)
// The change is made in the repository and goes live with the next release deploy; this script deploys nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ANDROID_PACKAGE = 'com.peakapps.bodyarcade';
export const RELATION = 'delegate_permission/common.handle_all_urls';
export const ASSETLINKS_FILE = fileURLToPath(new URL('./static/.well-known/assetlinks.json', import.meta.url));

export interface AssetStatement {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}

/** "2a31 24:0c..." or "2A:31:24:..." or 64 hex digits -> "2A:31:24:..."; throws when it is not a SHA-256 (32 bytes). */
export function normalizeFingerprint(input: string): string {
  const hex = String(input).replace(/[\s:]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error('not a SHA-256 certificate fingerprint: 32 bytes as 64 hex digits, with or without colons');
  return hex.match(/../g)!.join(':');
}

export function parse(text: string): AssetStatement[] {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) throw new Error('assetlinks.json must be a JSON array of statements');
  return data as AssetStatement[];
}

/** The statement of our app, or undefined. */
export const ours = (statements: readonly AssetStatement[]): AssetStatement | undefined =>
  statements.find((s) => s?.target?.namespace === 'android_app' && s.target.package_name === ANDROID_PACKAGE);

export function fingerprintsOf(text: string): string[] {
  return ours(parse(text))?.target.sha256_cert_fingerprints ?? [];
}

/** What is wrong with the file; empty when it is fine. `minFingerprints`: 2 once the pages say the app is on Google Play (upload key + Play app-signing key). */
export function problems(text: string, o: { minFingerprints?: number } = {}): string[] {
  const out: string[] = [];
  let statements: AssetStatement[];
  try { statements = parse(text); } catch (e) { return [e instanceof Error ? e.message : String(e)]; }
  const mine = ours(statements);
  if (!mine) return [`no statement for the package ${ANDROID_PACKAGE}`];
  if (!mine.relation?.includes(RELATION)) out.push(`the statement of ${ANDROID_PACKAGE} lacks the relation ${RELATION}`);
  const prints = mine.target.sha256_cert_fingerprints;
  if (!Array.isArray(prints) || prints.length === 0) return [...out, 'no certificate fingerprint'];
  for (const p of prints) {
    try { if (normalizeFingerprint(p) !== p) out.push(`fingerprint ${p} is not written as upper-case hex pairs with colons`); } catch { out.push(`fingerprint ${p} is not a SHA-256`); }
  }
  if (new Set(prints).size !== prints.length) out.push('the same fingerprint is listed twice');
  const min = o.minFingerprints ?? 1;
  if (prints.length < min) out.push(`${prints.length} fingerprint(s), at least ${min} needed: the upload key and the Play app-signing key`);
  return out;
}

/** The file's layout: two-space JSON, the relation on one line, a final newline. */
export function layout(statements: readonly AssetStatement[]): string {
  const text = JSON.stringify(statements, null, 2).replace(/"relation": \[([^\]]*)\]/g, (_m, inner: string) => `"relation": [${inner.split(',').map((x) => x.trim()).filter(Boolean).join(', ')}]`);
  return `${text}\n`;
}

/** The file's text with one more fingerprint on our statement (nothing changes when it is there already). */
export function withFingerprint(text: string, sha256: string): string {
  const fp = normalizeFingerprint(sha256);
  const statements = parse(text);
  const mine = ours(statements);
  if (!mine) throw new Error(`no statement for the package ${ANDROID_PACKAGE}`);
  if (!mine.target.sha256_cert_fingerprints.includes(fp)) mine.target.sha256_cert_fingerprints.push(fp);
  return layout(statements);
}

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const file = fi >= 0 ? (args[fi + 1] as string) : ASSETLINKS_FILE;
  const rest = args.filter((a, i) => fi < 0 || (i !== fi && i !== fi + 1));
  const [cmd, value] = rest;
  const text = readFileSync(file, 'utf8');
  if (cmd === 'add' && value) {
    let next: string;
    try { next = withFingerprint(text, value); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }
    if (next !== text.replace(/\r\n/g, '\n')) writeFileSync(file, next);
    console.log(`${file}: ${fingerprintsOf(next).length} fingerprints now`);
    for (const p of fingerprintsOf(next)) console.log(`  ${p}`);
    const bad = problems(next);
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  } else if (cmd === 'check') {
    const prints = fingerprintsOf(text);
    console.log(`${file}: ${prints.length} fingerprint(s)`);
    for (const p of prints) console.log(`  ${p}`);
    const bad = problems(text, { minFingerprints: rest.includes('--live') ? 2 : 1 });
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
    console.log('ok');
  } else {
    console.error('usage: node release/assetlinks.ts check [--live] | add <SHA-256> [--file <path>]');
    process.exit(2);
  }
}
