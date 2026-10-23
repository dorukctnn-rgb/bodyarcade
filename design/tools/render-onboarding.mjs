// Pre-rendered fallbacks for phones that cannot run the 3D stage, from the same scene:
//   design/onboarding/fallback/step-<n>-<theme>.webp  (1080 x 1080 stills, steps 1 to 5)
//   design/onboarding/fallback/hero-loop-<theme>.webm and .mp4 (640 x 640, 30 fps, one loop)
//   design/onboarding/fallback/hero-<theme>.avif (poster for the video)
// node design/tools/render-onboarding.mjs [--stills] [--loop]
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch, sharp } from './pw.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'design', 'onboarding', 'fallback');
await mkdir(out, { recursive: true });
const want = (k) => process.argv.length <= 2 || process.argv.includes(k);
const FFMPEG = process.env.FFMPEG || 'C:/Users/doruk/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe';

const server = await startServer(repo);
const browser = await launch();
const open = async (query, w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${server.url}/design/onboarding/render.html?${query}&w=${w}&h=${h}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
  return page;
};
const png = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
try {
  for (const theme of ['light', 'dark']) {
    if (want('--stills')) {
      const at = { 1: 1.7, 2: 2.0, 3: 1.0, 4: 1.0, 5: 1.0 };
      for (const step of [1, 2, 3, 4, 5]) {
        const page = await open(`step=${step}&theme=${theme}&regions=legs,cardio&device=phone`, 1080, 1080);
        const buf = png(await page.evaluate((t) => window.__frame(t), at[step]));
        await sharp(buf).webp({ quality: 80 }).toFile(path.join(out, `step-${step}-${theme}.webp`));
        if (step === 1) await sharp(buf).avif({ quality: 55 }).toFile(path.join(out, `hero-${theme}.avif`));
        await page.close();
        console.log(`still step ${step} ${theme}`);
      }
    }
    if (want('--loop')) {
      const tmp = path.join(out, `_frames-${theme}`);
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      const page = await open(`step=1&theme=${theme}`, 640, 640);
      const fps = 30, length = 5.2, n = Math.round(length * fps);
      for (let i = 0; i < n; i++) {
        const buf = png(await page.evaluate((t) => window.__frame(t), i / fps));
        await writeFile(path.join(tmp, `f${String(i).padStart(4, '0')}.png`), buf);
      }
      await page.close();
      const input = path.join(tmp, 'f%04d.png');
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', input, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-pix_fmt', 'yuv420p', path.join(out, `hero-loop-${theme}.webm`)]);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', input, '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, `hero-loop-${theme}.mp4`)]);
      await rm(tmp, { recursive: true, force: true });
      console.log(`loop ${theme}: ${n} frames`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
