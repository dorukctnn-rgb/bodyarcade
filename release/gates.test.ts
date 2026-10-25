// The production gate of the deploy (the Gumroad catalog must hold no placeholder) and the secrets as a set (the reminder
// mail needs its token and its sender together). The gate stops release/deploy.ts before anything is built or uploaded;
// it is not part of the CI build, because it fails until Doruk has created the Gumroad products.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bridgeProblems, gatesFor, PREVIEW_ONLY, runGates, secretProblems, shellSignsRoomCalls, withoutComments, type Gate } from './gates.ts';
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

  it('checks the preview-only settings before the build and before anything goes to wrangler, also with --dry-run, and stops on a problem', () => {
    const at = src.indexOf('bridgeProblems(id,');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf("release/build.ts'"));
    expect(at).toBeLessThan(src.indexOf("'deploy'"));
    const stop = src.slice(src.indexOf('if (bridges.length)'), src.indexOf('\n', src.indexOf('if (bridges.length)')));
    expect(stop).toMatch(/process\.exit\(1\)/);
    // it reads all three configs and the shell's sources, not a flag
    expect(src).toMatch(/TARGETS\.preview\.config/);
    expect(src).toMatch(/TARGETS\.production\.config/);
    expect(src).toMatch(/packages\/server\/wrangler\.jsonc/);
    expect(src).toMatch(/shellSignsRoomCalls\(readShellSources\(root\)\)/);
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

  it('the entitlement key says it also guards the Pro games of a room (builder N, 25 Oct): optional, not generated here', () => {
    const s = spec('ENT_PRIV_JWK');
    expect(s).toBeDefined();
    expect(s!.required).toBe(false);
    expect(s!.generate).toBeNull();
    expect(s!.why).toMatch(/signs Pro tokens \(ES256\)/);
    expect(s!.why).toMatch(/its public half also checks the host's Pro token before a Pro game starts in a room/);
    expect(s!.why).toMatch(/without it a room never starts a Pro game, free games are not affected/);
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

describe('preview-only settings', () => {
  const NAME = 'SOCIAL_ALLOW_UNSIGNED';
  const clean = '{ "name": "bodyarcade", "vars": { "PUBLIC_ORIGIN": "https://bodyarcade.com" } }';
  const withBridge = `{
    // ${NAME}: a guest may make rooms until the shell signs
    "vars": { "PUBLIC_ORIGIN": "https://x.example", "${NAME}": "1" }
  }`;
  const onlyInAComment = `{ // ${NAME} used to be here
    /* ${NAME} */ "vars": { "PUBLIC_ORIGIN": "https://x.example" } }`;

  it('the list names SOCIAL_ALLOW_UNSIGNED with its reason', () => {
    expect(Object.keys(PREVIEW_ONLY)).toContain(NAME);
    expect(PREVIEW_ONLY[NAME]).toMatch(/signs? its room calls/);
  });

  it('withoutComments drops line, trailing and block comments and leaves strings alone (URLs, quotes, escapes)', () => {
    expect(withoutComments('{ // a\n"a": 1 }')).toBe('{ \n"a": 1 }');
    expect(withoutComments('{ "u": "https://x.example/a//b" } // tail')).toBe('{ "u": "https://x.example/a//b" } \n');
    expect(withoutComments('{ /* one\ntwo */ "a": "/* not a comment */" }')).toBe('{  "a": "/* not a comment */" }');
    expect(withoutComments('{ "q": "say \\"hi\\" // still a string" } // gone')).toBe('{ "q": "say \\"hi\\" // still a string" } \n');
    expect(withoutComments("const u = 'http://x.example'; // gone\nconst fetcher = 1;")).toBe("const u = 'http://x.example'; \nconst fetcher = 1;");
    expect(withoutComments('/* unterminated')).toBe('');
  });

  describe('production', () => {
    it('is fine when no config names one', () => {
      expect(bridgeProblems('production', { preview: clean, production: clean, server: clean }, true)).toEqual([]);
      expect(bridgeProblems('production', { preview: clean, production: clean }, false)).toEqual([]);
    });

    it('stops while the preview still sets one, and says why and what to do (a comment in the preview is fine)', () => {
      const p = bridgeProblems('production', { preview: withBridge, production: clean, server: clean }, false);
      expect(p).toHaveLength(1);
      expect(p[0]).toContain(NAME);
      expect(p[0]).toMatch(/preview/);
      expect(p[0]).toMatch(/final test/);
      expect(bridgeProblems('production', { preview: onlyInAComment, production: clean, server: clean }, false)).toEqual([]);
    });

    it('never lets production or the server config name one, not even in a comment', () => {
      const prod = bridgeProblems('production', { preview: clean, production: withBridge }, false);
      expect(prod).toHaveLength(1);
      expect(prod[0]).toMatch(/^wrangler\.prod\.jsonc names SOCIAL_ALLOW_UNSIGNED/);
      expect(bridgeProblems('production', { preview: clean, production: onlyInAComment }, false)).toHaveLength(1);
      const server = bridgeProblems('production', { preview: clean, production: clean, server: onlyInAComment }, false);
      expect(server).toHaveLength(1);
      expect(server[0]).toMatch(/^packages\/server\/wrangler\.jsonc names/);
    });

    it('reports every config that is wrong at once', () => {
      expect(bridgeProblems('production', { preview: withBridge, production: withBridge, server: withBridge }, false)).toHaveLength(3);
    });
  });

  describe('preview', () => {
    it('may carry one while the shell does not sign', () => {
      expect(bridgeProblems('preview', { preview: withBridge, production: clean }, false)).toEqual([]);
    });

    it('has to drop it once the shell signs its room calls (a comment about it is fine)', () => {
      const p = bridgeProblems('preview', { preview: withBridge, production: clean }, true);
      expect(p).toHaveLength(1);
      expect(p[0]).toMatch(/^wrangler\.jsonc still sets SOCIAL_ALLOW_UNSIGNED but the shell signs/);
      expect(bridgeProblems('preview', { preview: clean, production: clean }, true)).toEqual([]);
      expect(bridgeProblems('preview', { preview: onlyInAComment, production: clean }, true)).toEqual([]);
    });
  });

  describe('does the shell sign its room calls', () => {
    const wired = `import { createLiveRoomPort } from './live-room.ts';
      const rooms = createLiveRoomPort({ origin, identity: () => social.roomIdentity(), fetcher: social.fetcher });`;
    it('yes: a source of the web app calls createLiveRoomPort and hands it a fetcher', () => {
      expect(shellSignsRoomCalls({ 'packages/web/src/app/boot.ts': wired })).toBe(true);
      expect(shellSignsRoomCalls({ 'a.ts': 'x', 'packages/web/src/boot.ts': wired })).toBe(true);
    });
    it('no: nothing calls it yet, the call has no fetcher, or only a test or a comment does', () => {
      expect(shellSignsRoomCalls({})).toBe(false);
      expect(shellSignsRoomCalls({ 'packages/web/src/app/boot.ts': 'const x = 1;' })).toBe(false);
      expect(shellSignsRoomCalls({ 'packages/web/src/app/boot.ts': 'const rooms = createLiveRoomPort({ origin, identity });' })).toBe(false);
      expect(shellSignsRoomCalls({ 'packages/web/src/app/live-room.test.ts': wired })).toBe(false);
      expect(shellSignsRoomCalls({ 'packages/web/src/app/x.spec.ts': wired })).toBe(false);
      expect(shellSignsRoomCalls({ 'packages/web/src/app/boot.ts': `// createLiveRoomPort({ fetcher }) comes later\nconst x = 1;` })).toBe(false);
      // the definition itself (with its `fetcher` option) is not a call
      expect(shellSignsRoomCalls({ 'packages/web/src/app/live-room.ts': 'export function createLiveRoomPort(deps: LiveRoomDeps) { return deps.fetcher; }' })).toBe(false);
    });
    it('a URL string before the call does not hide it (a // inside a string is not a comment)', () => {
      expect(shellSignsRoomCalls({ 'packages/web/src/boot.ts': `const o = 'https://x.example'; const r = createLiveRoomPort({ origin: o, fetcher: f });` })).toBe(true);
    });
  });
});

describe('the preview-only settings stay out of the CI build', () => {
  it('neither the build nor a workflow runs the check (CI builds with the preview line still in place; the unit test of the configs is what runs there)', () => {
    const flows = existsSync(join(root, '.github', 'workflows')) ? readdirSync(join(root, '.github', 'workflows')) : [];
    for (const f of flows) expect(text(`.github/workflows/${f}`), f).not.toMatch(/bridgeProblems|release\/deploy/);
    expect(text('release/build.ts')).not.toMatch(/bridgeProblems/);
  });
});
