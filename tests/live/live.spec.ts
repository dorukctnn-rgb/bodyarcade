import { expect, test } from '@playwright/test';
import { runScenario } from './support/runner.ts';
import { SCENARIOS } from './support/scenarios.ts';
import { startStack, type Stack } from './support/stack.ts';

let stack: Stack;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { test.setTimeout(120_000); stack = await startStack(); });
test.afterAll(async () => { await stack?.stop(); });

const only = process.env.LIVE_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(name)) continue;
  test(name, async () => {
    test.skip(!stack.turn && !!(sc.relay || sc.actions?.some((a) => a.do === 'loss' || a.do === 'blackhole')), 'needs a LAN address for the local TURN relay');
    test.setTimeout(((sc.dur ?? 25) * (sc.matches ?? 1) + 200) * 1000);
    const r = await runScenario(stack, name, sc);
    expect(r.failed, JSON.stringify({ checks: r.checks, extra: r.extra }, null, 1).slice(0, 3000)).toEqual([]);
  });
}
