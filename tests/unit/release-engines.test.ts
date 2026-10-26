// The engines of the release checks (BUILD-PLAN: the final test runs Chromium, WebKit and Firefox at phone and desktop sizes):
// tests/release/playwright.config.ts and support.ts pick the engine from BA_RELEASE_ENGINE and keep each engine's evidence apart.
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['BA_RELEASE_ENGINE', 'BA_RELEASE_OUT'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

async function load(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  const support = await import('../release/support.ts');
  const config = (await import('../release/playwright.config.ts')).default;
  return { support, config };
}

afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.resetModules();
});

describe('release checks, engines', () => {
  it('Chromium by default: every check, the evidence in tests/release/out', async () => {
    const { support, config } = await load({});
    expect(support.ENGINE).toBe('chromium');
    expect(config.use?.browserName).toBe('chromium');
    expect(config.testIgnore).toEqual([]);
    expect(support.OUT).toBe(join(support.ROOT, 'tests', 'release', 'out'));
    expect(config.use?.launchOptions?.args ?? []).toContain('--use-fake-device-for-media-stream');
  });

  for (const engine of ['webkit', 'firefox'] as const) {
    it(`${engine}: the page checks on that engine, the HTTP, CSP and live checks left to Chromium, the evidence in out/${engine}`, async () => {
      const { support, config } = await load({ BA_RELEASE_ENGINE: engine });
      expect(support.ENGINE).toBe(engine);
      expect(config.use?.browserName).toBe(engine);
      expect(config.testIgnore).toEqual(['**/urls.spec.ts', '**/csp.spec.ts', '**/live.spec.ts']);
      expect(support.OUT).toBe(join(support.ROOT, 'tests', 'release', 'out', engine));
      expect(config.outputDir).toBe(`out/${engine}/test-results`);
      expect(config.use?.launchOptions).toEqual({ headless: true });   // Chromium's flags mean nothing to the other engines
      expect(config.use?.headless).toBe(true);
    });
  }

  it('BA_RELEASE_OUT still moves the evidence (a local stack keeps its own)', async () => {
    const { support } = await load({ BA_RELEASE_ENGINE: 'webkit', BA_RELEASE_OUT: join(process.cwd(), 'tests', 'release', 'out', 'local-webkit') });
    expect(support.OUT).toBe(join(process.cwd(), 'tests', 'release', 'out', 'local-webkit'));
  });

  it('every engine reads the pages in English, whatever the language of the machine (the app moves an English address to it)', async () => {
    for (const engine of ['chromium', 'webkit', 'firefox'] as const) {
      const { config } = await load({ BA_RELEASE_ENGINE: engine });
      expect(config.use?.locale, engine).toBe('en-US');
    }
  });

  it('a misspelt engine stops the run instead of quietly testing Chromium', async () => {
    await expect(load({ BA_RELEASE_ENGINE: 'safari' })).rejects.toThrow(/chromium, webkit or firefox/);
  });
});
