// Shared headless browser helpers for the design checks. Headless only, no windows.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const PW_CANDIDATES = [
  'playwright',
  'C:/Users/doruk/golfreserve-pro/app/node_modules/playwright',
];
const SHARP_CANDIDATES = ['sharp', 'C:/Users/doruk/.claude/skills/store-studio/node_modules/sharp'];
const pick = (list) => { for (const c of list) { try { return require(c); } catch { /* next */ } } throw new Error(`none of ${list.join(', ')} found`); };

export const { chromium } = pick(PW_CANDIDATES);
export const sharp = (() => { try { return pick(SHARP_CANDIDATES); } catch { return null; } })();

const SHELL = 'C:/Users/doruk/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
export async function launch() {
  const opts = { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (existsSync(SHELL)) opts.executablePath = SHELL;
  return chromium.launch(opts);
}

/** Save a Playwright PNG buffer as WebP (smaller in git); falls back to PNG without sharp. */
export async function saveShot(buf, fileNoExt, quality = 82) {
  if (sharp) {
    await sharp(buf).webp({ quality }).toFile(`${fileNoExt}.webp`);
    return `${fileNoExt}.webp`;
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${fileNoExt}.png`, buf);
  return `${fileNoExt}.png`;
}
