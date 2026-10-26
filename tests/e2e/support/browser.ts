// Launch options shared by playwright.config.ts and specs that need their own camera feed.
// Headless only (never a visible window). The camera is Chromium's fake device; withFakeVideo() swaps its
// picture for a file (MJPEG or Y4M) so a real person stands in front of the "camera".
import type { LaunchOptions } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Playwright's pinned headless shell, or (on a machine that has only an older one installed) the newest
// chromium_headless_shell-* folder in the browser cache. CI installs the pinned one.
function headlessShell(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright')
      : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
  let wanted = '';
  try {
    const core = dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
    const b = JSON.parse(readFileSync(join(core, 'browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
    wanted = b.browsers.find((x) => x.name === 'chromium-headless-shell')?.revision || '';
  } catch { /* fall through to the scan */ }
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => /^chromium_headless_shell-\d+$/.test(d));
  if (wanted && dirs.includes(`chromium_headless_shell-${wanted}`)) return undefined;   // Playwright finds it itself
  const newest = dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
  if (!newest) return undefined;
  const sub = process.platform === 'win32' ? ['chrome-headless-shell-win64', 'chrome-headless-shell.exe']
    : process.platform === 'darwin' ? ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'] : ['chrome-headless-shell-linux64', 'chrome-headless-shell'];
  const exe = join(cache, newest, ...sub);
  return existsSync(exe) ? exe : undefined;
}

const executablePath = headlessShell();

const BASE_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio', '--autoplay-policy=no-user-gesture-required'];

export const baseLaunchOptions: LaunchOptions = {
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: BASE_ARGS,
};

/** Launch options whose fake camera shows `file` (path from the repo root), looping. */
export function withFakeVideo(file: string): LaunchOptions {
  return { ...baseLaunchOptions, args: [...BASE_ARGS, `--use-file-for-fake-video-capture=${resolve(file)}`] };
}
