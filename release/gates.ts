// What must hold before a target is deployed, besides the build itself, and what must hold for its secrets as a whole.
// Used by release/deploy.ts only. The production gate is kept out of release/build.ts and out of CI on purpose: it fails
// until the Gumroad products exist (RELEASE NEEDS 3, Doruk creates them), and a CI that is red for that reason would hide
// real failures. The preview has no gate.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { TargetId } from './site.ts';

export interface Gate {
  name: string;
  cmd: string;
  args: string[];
  /** What a failure means and what to do, for the person who reads the deploy output. */
  why: string;
}

/** The gates of a target, in the order they run. Production: the Gumroad catalog (builder S's check) must hold no placeholder, and (launch commit) Gumroad itself must say that the four products are published (--online --require-published). */
export function gatesFor(id: TargetId, root: string): Gate[] {
  if (id !== 'production') return [];
  return [{
    name: 'Gumroad catalog',
    cmd: process.execPath,
    args: [join(root, 'tools', 'entitlements', 'check-catalog.mjs'), '--release', '--online', '--require-published'],
    why: 'a plan still has a placeholder where its Gumroad product belongs (put the product ids and links in packages/core/entitlements/catalog.ts), or one of the four Gumroad products is not published yet or differs from what the app promises (launch day: publish them in Gumroad first, the paywall links answer "not found" while a product is a draft); the live site is not replaced before that.',
  }];
}

/** Runs one command; true when it exits with 0. Replaceable in tests. */
export type GateRunner = (cmd: string, args: string[], cwd: string) => boolean;

const spawnRunner: GateRunner = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit', windowsHide: true }).status === 0;

/** Runs the gates in order and stops at the first that fails; null when all pass. */
export function runGates(gates: readonly Gate[], cwd: string, run: GateRunner = spawnRunner): Gate | null {
  for (const g of gates) {
    console.log(`gate: ${g.name}`);
    if (!run(g.cmd, g.args, cwd)) return g;
  }
  return null;
}

/** Problems with the secrets as a set (each of them alone is optional); empty when all is well. */
export function secretProblems(secrets: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const token = !!secrets['ENT_MAIL_TOKEN'];
  const from = !!secrets['ENT_MAIL_FROM'];
  // The Worker reads them as a pair: with one of them the reminder box stays off and the Worker reports a problem.
  if (token !== from) out.push('ENT_MAIL_TOKEN and ENT_MAIL_FROM go together: set both (the trial reminder e-mail) or neither');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Preview-only settings ("bridges"): a setting the PREVIEW Worker may carry for a while, never production.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The settings only wrangler.jsonc (the preview) may carry, each with why it is there and what removes it; the list must only
 * shrink. Production (wrangler.prod.jsonc) and the server's own config (packages/server/wrangler.jsonc) never have one, and
 * the production deploy waits until the preview has dropped them too: the final test runs on the preview, so it has to run on
 * the rules production has.
 */
export const PREVIEW_ONLY: Readonly<Record<string, string>> = {
  SOCIAL_ALLOW_UNSIGNED: 'a room call with no signature is a guest, for as long as the shell does not sign its room calls with the social profile (the signed fetcher and roomIdentity() of the social client, handed to createLiveRoomPort as LiveRoomDeps.fetcher)',
};

/**
 * The text without its comments (`//` and block comments), string contents left alone: a wrangler config is JSON with comments, and
 * the same reading serves the web app's TypeScript. Plain quotes end at the end of their line, so a stray quote in a regular
 * expression costs at most that line; a template literal may run over lines.
 */
export function withoutComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const next = text[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && (c === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out;
}

/** Which preview-only settings a text names. */
const bridgesNamed = (text: string): string[] => Object.keys(PREVIEW_ONLY).filter((name) => text.includes(name));

/** The Worker configs as text. */
export interface ReleaseConfigs {
  /** wrangler.jsonc: the preview. */
  preview: string;
  /** wrangler.prod.jsonc. */
  production: string;
  /** packages/server/wrangler.jsonc: the server's own config (the release step renames it); optional. */
  server?: string;
}

/**
 * Does the shell sign its room calls? True when a source of the web app (tests excluded) calls createLiveRoomPort and gives it
 * a `fetcher` (the signed one of the social client). `sources` maps a path to its text; the definition of the function does not count.
 */
export function shellSignsRoomCalls(sources: Readonly<Record<string, string>>): boolean {
  return Object.entries(sources).some(([path, text]) => {
    if (/\.(test|spec)\.[cm]?[jt]s$/.test(path)) return false;
    const code = withoutComments(text);
    return /(?<!function\s+)\bcreateLiveRoomPort\s*\(/.test(code) && /\bfetcher\b/.test(code);
  });
}

/** The sources of the web app (packages/web/src, without node_modules), by path relative to the root. */
export function readShellSources(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.[cm]?[jt]s$/.test(e.name)) out[relative(root, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(join(root, 'packages', 'web', 'src'));
  return out;
}

/**
 * What is wrong with the preview-only settings for a deploy of `id`; empty when all is well.
 *  production  never in wrangler.prod.jsonc or the server's config (not even in a comment: a grep must find nothing), and the
 *              preview has dropped them (its comments may still talk about them)
 *  preview     may carry them until the shell signs its room calls; from then on the line must go (shellSigns)
 */
export function bridgeProblems(id: TargetId, c: ReleaseConfigs, shellSigns: boolean): string[] {
  const out: string[] = [];
  const inPreview = bridgesNamed(withoutComments(c.preview));
  if (id === 'production') {
    for (const name of bridgesNamed(c.production)) out.push(`wrangler.prod.jsonc names ${name}: production never has it (${PREVIEW_ONLY[name]})`);
    for (const name of bridgesNamed(c.server ?? '')) out.push(`packages/server/wrangler.jsonc names ${name}: only the preview config may have it (${PREVIEW_ONLY[name]})`);
    for (const name of inPreview) out.push(`wrangler.jsonc (the preview) still sets ${name}: ${PREVIEW_ONLY[name]}. Delete it, redeploy the preview and run the final test again: it has to run on the rules production has`);
  } else if (shellSigns) {
    for (const name of inPreview) out.push(`wrangler.jsonc still sets ${name} but the shell signs its room calls now: delete the setting, so the preview has the rules production has (${PREVIEW_ONLY[name]})`);
  }
  return out;
}
