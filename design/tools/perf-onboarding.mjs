// Frame budget of the onboarding stage, headless, with the CPU throttled 4x (DevTools
// Emulation.setCPUThrottlingRate). SwiftShader renders on the CPU, so absolute numbers are
// pessimistic compared with a phone GPU; compare tiers with each other and against the
// budget in graphics-maps.md (T0 under 33 ms at a 30 fps cap, T1 and T2 under 20 ms p95).
// node design/tools/perf-onboarding.mjs
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch } from './pw.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = await startServer(repo);
const browser = await launch();
const rows = [];
try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    for (const tier of [0, 1, 2]) {
      for (const throttle of [1, 4]) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1 });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        await page.goto(`${server.url}/design/onboarding/perf.html?tier=${tier}&s=6`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 });
        const r = await page.evaluate(() => window.__perf);
        rows.push({ screen: `${w}x${h}`, dpr: w < 600 ? 2 : 1, throttle, ...r });
        console.log(`${w}x${h} tier ${tier} cpu x${throttle}: frame gap p50 ${r.rafP50.toFixed(1)} ms p95 ${r.rafP95.toFixed(1)} ms, update+render p50 ${r.cpuP50.toFixed(1)} ms p95 ${r.cpuP95.toFixed(1)} ms, ${r.calls} calls, ${r.triangles} triangles`);
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
await mkdir(path.join(repo, 'design', 'shots', 'onboarding'), { recursive: true });
await writeFile(path.join(repo, 'design', 'shots', 'onboarding', 'perf.json'), JSON.stringify(rows, null, 1));
