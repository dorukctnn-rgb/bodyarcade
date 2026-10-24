// The production gate of the deploy (the Gumroad catalog must hold no placeholder) and the secrets as a set (the reminder
// mail needs its token and its sender together). The gate stops release/deploy.ts before anything is built or uploaded;
// it is not part of the CI build, because it fails until Doruk has created the Gumroad products.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gatesFor, runGates, secretProblems, type Gate } from './gates.ts';
import { SECRETS } from './secrets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const text = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('the gates of a target', () => {
  it('the preview has none: it may ship with placeholders (a paywall that lacks a plan)', () => {
    expect(gatesFor('preview', root)).toEqual([]);
  });

  it('production runs the Gumroad catalog check with --release, from the tools folder', () => {
    const gates = gatesFor('production', root);
    expect(gates.map((g) => g.name)).toEqual(['Gumroad catalog']);
    const g = gates[0] as Gate;
    expect(g.cmd).toBe(process.execPath);
    expect(g.args).toHaveLength(2);
    expect(g.args[0]).toBe(join(root, 'tools', 'entitlements', 'check-catalog.mjs'));
    expect(g.args[1]).toBe('--release');
    expect(existsSync(g.args[0] as string)).toBe(true);
    expect(g.why).toMatch(/placeholder/);
    expect(g.why).toMatch(/catalog\.ts/);
  });

  it('runGates runs them in order and stops at the first that fails, naming it', () => {
    const gates: Gate[] = ['a', 'b', 'c'].map((n) => ({ name: n, cmd: 'x', args: [n], why: `${n} failed` }));
    const calls: string[] = [];
    expect(runGates(gates, root, (_c, a) => { calls.push(a[0] as string); return true; })).toBeNull();
    expect(calls).toEqual(['a', 'b', 'c']);
    calls.length = 0;
    const failed = runGates(gates, root, (_c, a) => { calls.push(a[0] as string); return a[0] !== 'b'; });
    expect(failed?.name).toBe('b');
    expect(calls).toEqual(['a', 'b']);
    expect(runGates([], root, () => { throw new Error('nothing to run'); })).toBeNull();
  });
});

describe('release/deploy.ts', () => {
  const src = text('release/deploy.ts');

  it('runs the gates first: before the secrets are read, before the build, before anything goes to wrangler, also with --dry-run', () => {
    const gate = src.indexOf('runGates(gatesFor(id, root), root)');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(src.indexOf('readSecrets(id)'));
    expect(gate).toBeLessThan(src.indexOf("release/build.ts'"));
    expect(gate).toBeLessThan(src.indexOf("'deploy'"));
    // not behind a condition: nothing between the line before it and the line itself mentions an option or an if
    const line = src.slice(src.lastIndexOf('\n', gate - 1) + 1, src.indexOf('\n', gate));
    expect(line.startsWith('const failedGate')).toBe(true);
    expect(src.slice(gate, src.indexOf('\n', src.indexOf('failedGate)', gate)))).toMatch(/process\.exit\(1\)/);
  });

  it('refuses a half set of the reminder mail secrets', () => {
    expect(src).toMatch(/secretProblems\(secrets\)/);
    expect(src.indexOf('secretProblems(secrets)')).toBeLessThan(src.indexOf("'deploy'"));
  });
});

describe('the gate stays out of the CI build', () => {
  it('no workflow, no package script and not the build mentions the catalog check', () => {
    const flows = existsSync(join(root, '.github', 'workflows')) ? readdirSync(join(root, '.github', 'workflows')) : [];
    for (const f of flows) expect(text(`.github/workflows/${f}`), f).not.toMatch(/check-catalog/);
    expect(text('package.json')).not.toMatch(/check-catalog/);
    expect(text('release/build.ts')).not.toMatch(/check-catalog|gatesFor/);
  });
});

describe('secrets', () => {
  const spec = (name: string) => SECRETS.find((s) => s.name === name);

  it('the reminder mail has its token and its sender listed: optional, not generated, said to go together', () => {
    for (const name of ['ENT_MAIL_TOKEN', 'ENT_MAIL_FROM']) {
      const s = spec(name);
      expect(s, name).toBeDefined();
      expect(s!.required).toBe(false);
      expect(s!.generate).toBeNull();
      expect(s!.why).toMatch(/reminder/);
    }
    expect(spec('ENT_MAIL_TOKEN')!.why).toMatch(/ENT_MAIL_FROM/);
    expect(spec('ENT_MAIL_FROM')!.why).toMatch(/ENT_MAIL_TOKEN/);
  });

  it('every name is listed once', () => {
    const names = SECRETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the token and the sender go together: both or neither is fine, one alone is stopped', () => {
    expect(secretProblems({})).toEqual([]);
    expect(secretProblems({ ENT_MAIL_TOKEN: 't', ENT_MAIL_FROM: 'BodyArcade <info@bodyarcade.com>' })).toEqual([]);
    expect(secretProblems({ ENT_MAIL_TOKEN: 't' })).toEqual([expect.stringContaining('go together')]);
    expect(secretProblems({ ENT_MAIL_FROM: 'info@bodyarcade.com' })).toEqual([expect.stringContaining('go together')]);
    expect(secretProblems({ TICKET_SECRET: 'x' })).toEqual([]);
  });
});
