// The frames of a short clip of one game in play, for the moving game tiles of the home page (design/tools/tile-clips.mjs makes
// the loops from them). Same set-up as run.ts (the web shell through Vite, the keyboard hook, headless, one browser), but the page's
// clock is Playwright's: once the round has run for --warm milliseconds the clock stops, and each frame is the game moved on by
// exactly 1/fps of a second and then photographed. A slow machine (software WebGL) gives the same smooth clip as a fast one.
//
//   node tools/gfx-shots/clip.ts <out dir> <game> [--size=1280x960] [--rect=left,top,width,height] [--warm=6000] [--seconds=4.5]
//        [--fps=30] [--press=ArrowUp:900[:offset],...] [--quality=high] [--world=<id>] [--query=a=b]
//
// --rect cuts each frame to that part of the page (CSS pixels, the same rects as the tiles in design/tools/hero-frames.mjs).
// --press presses a key every <ms> milliseconds of game time (from <offset>), in the warm-up and in the clip alike.
// --pilot=<key>:<text> presses that key whenever the game's command plate says <text> (at most once in 700 ms): Squat Flap on the
// easy level (--query=difficulty=easy) has a coach that says "Squat" when the bird is under the next gap, so the bird flies through.
// The HUD, the overlays and the camera picture are hidden (as run.ts --clean). Frames: <out>/<game>[-<world>]/f0000.jpg, ...
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { baseLaunchOptions } from '../../tests/e2e/support/browser.ts';
import { startWeb } from '../page-check/servers.ts';
import { beNice } from '../page-check/nice.ts';

beNice();

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith('--'));
const [outArg, game] = positional;
if (!outArg || !game) throw new Error('usage: node tools/gfx-shots/clip.ts <out dir> <game> [--size=WxH] [--rect=l,t,w,h] [--warm=ms] [--seconds=s] [--fps=n] [--press=Key:ms[:offset],...]');
const [w, h] = (flag('size') ?? '1280x960').split('x').map(Number) as [number, number];
const rect = flag('rect')?.split(',').map(Number) as [number, number, number, number] | undefined;
const warm = Number(flag('warm') ?? 6000);
const fps = Number(flag('fps') ?? 30);
const frames = Math.round(Number(flag('seconds') ?? 4.5) * fps);
const quality = flag('quality');
const world = flag('world');
const extra = flag('query');
const presses = (flag('press') ?? '').split(',').filter(Boolean).map((p) => {
  const [key, every, offset] = p.split(':');
  return { key: key === 'Space' ? ' ' : (key ?? ''), every: Number(every ?? 0), offset: Number(offset ?? 0) };
}).filter((p) => p.key && p.every > 0);
const [pilotKey, ...pilotWords] = (flag('pilot') ?? '').split(':');
const pilotText = pilotWords.join(':');

const dir = join(resolve(outArg), `${game}${world ? `-${world}` : ''}`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const web = await startWeb('none');
const browser = await chromium.launch(baseLaunchOptions);
try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light', locale: 'en-US', deviceScaleFactor: 1, hasTouch: w < 1000 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The fake clock runs at the speed of the real one until it is paused.
  await page.clock.install();
  await page.addInitScript((q) => { window.__BA_TEST__ = { timeScale: 1, keyboard: true, ...(q ? { quality: q as 'low' | 'medium' | 'high' } : {}) }; }, quality ?? '');
  await page.goto(`${web.url}/play/${game}/?input=keyboard&plan=pro${world ? `&world=${world}` : ''}${extra ? `&${extra}` : ''}`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-hud="statusLeft"]', { timeout: 45_000 });
  await page.waitForFunction(() => !document.querySelector('.ba-countdown') && !document.querySelector('.cal'), undefined, { timeout: 30_000 });
  await page.evaluate(() => { const s = new CSSStyleSheet(); s.replaceSync('.ba-hud, .ba-overlay, .ba-camera-host { visibility: hidden !important; }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; });
  // From here on the game's time is ours: it moves only when the clock is run.
  // A moment ahead of the page's clock: on a loaded machine the page's time moves on while the call travels.
  for (let tries = 0; ; tries += 1) {
    const now = await page.evaluate(() => Date.now());
    try { await page.clock.pauseAt(now + 1000); break; } catch (e) { if (tries >= 4) throw e; }
  }
  let t = 0;
  let lastPilot = -1000;
  const step = async (ms: number): Promise<void> => {
    // Run up to each key press due in this step, press it, run on.
    const end = t + ms;
    for (;;) {
      const due = presses.map((p) => ({ p, at: p.offset + Math.ceil((t + 0.001 - p.offset) / p.every) * p.every })).filter((d) => d.at >= t && d.at < end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      if (due.at > t) await page.clock.runFor(due.at - t);
      t = due.at;
      await page.keyboard.press(due.p.key);
      await page.clock.runFor(1);
      t += 1;
    }
    if (end > t) await page.clock.runFor(end - t);
    t = end;
    if (pilotKey && pilotText && t - lastPilot >= 700) {
      const says = await page.evaluate(() => { const c = document.querySelector('[data-hud="command"]'); return c && !c.hasAttribute('hidden') ? (c.querySelector('[data-ref="commandText"]')?.textContent ?? '') : ''; });
      if (says.trim() === pilotText) { await page.keyboard.press(pilotKey === 'Space' ? ' ' : pilotKey); lastPilot = t; }
    }
  };
  const frameMs = 1000 / fps;
  for (let done = 0; done < warm; done += 500) await step(Math.min(500, warm - done));
  for (let i = 0; i < frames; i += 1) {
    if (i > 0) {
      // Whole milliseconds that add up to i/fps of a second.
      const next = Math.round(i * frameMs) - Math.round((i - 1) * frameMs);
      await step(next);
    }
    await page.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95, ...(rect ? { clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } } : {}), timeout: 120_000 });
    if (i % 30 === 0) console.log(`${game} frame ${i}/${frames}`);
  }
  console.log(`ok ${game}${world ? ` ${world}` : ''}: ${frames} frames in ${dir}${errors.length ? ` (page errors: ${errors.slice(0, 2).join(' | ')})` : ''}`);
  await context.close();
} finally {
  await browser.close();
  await web.close();
}
