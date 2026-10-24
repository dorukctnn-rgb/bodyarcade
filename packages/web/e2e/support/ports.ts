// Ports of the shell's end-to-end servers, derived from the checkout path so several worktrees can run at once;
// BA_WEB_E2E_PORT pins them. (The platform's own end-to-end ports live in tests/e2e/support/ports.ts.)
function portBase(): number {
  const fixed = Number(process.env['BA_WEB_E2E_PORT']);
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  let h = 0;
  for (const ch of process.cwd().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 40000 + (h % 5000) * 2;
}

/** The Vite dev server of the shell (development build, fixtures, the practice session). */
export const WEB_DEV_PORT = portBase();
/** A static server of the built site (what a host serves). */
export const WEB_SITE_PORT = WEB_DEV_PORT + 1;
/** The Vite dev server with the real catalogue (playwright.real.config.ts). */
export const WEB_REAL_PORT = WEB_DEV_PORT + 2;
export const WEB_REAL_URL = `http://127.0.0.1:${WEB_REAL_PORT}`;
export const WEB_DEV_URL = `http://127.0.0.1:${WEB_DEV_PORT}`;
export const WEB_SITE_URL = `http://127.0.0.1:${WEB_SITE_PORT}`;
