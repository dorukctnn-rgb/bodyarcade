import { expect, test, firefox, webkit } from '@playwright/test';
import { existsSync } from 'node:fs';
import { runScenario } from './support/runner.ts';
import { SCENARIOS } from './support/scenarios.ts';
import { startStack, type Stack } from './support/stack.ts';

// A local release gate: it starts workerd, a TURN server and headless Chromium players, which a GitHub runner cannot do in time.
test.skip(!!process.env.CI, 'the live suite runs on the local release gate, not on GitHub runners');

let stack: Stack;
test.beforeAll(async () => { test.setTimeout(120_000); stack = await startStack(); });
test.afterAll(async () => { await stack?.stop(); });

const only = process.env.LIVE_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(name)) continue;
  test(name, async () => {
    const engines = { firefox, webkit } as const;
    test.skip(!!sc.engines?.some((e) => e !== 'chromium' && !existsSync(engines[e].executablePath())), 'an engine of this scenario is not installed (npx playwright install firefox webkit)');
    test.skip(!stack.turn && !!(sc.relay || sc.actions?.some((a) => a.do === 'loss' || a.do === 'blackhole')), 'needs a LAN address for the local TURN relay');
    test.setTimeout(((sc.dur ?? 25) * (sc.matches ?? 1) + 200) * 1000);
    const r = await runScenario(stack, name, sc);
    expect(r.failed, JSON.stringify({ checks: r.checks, extra: r.extra }, null, 1).slice(0, 3000)).toEqual([]);
  });
}
