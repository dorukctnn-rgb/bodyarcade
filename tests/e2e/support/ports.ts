// Ports for the e2e servers, shared by playwright.config.ts and the specs. Derived from the checkout path so
// several worktrees can run their suites at the same time; BA_E2E_PORT pins them.
function portBase(): number {
  const fixed = Number(process.env.BA_E2E_PORT);
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  let h = 0;
  for (const ch of process.cwd().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 20000 + (h % 10000) * 2;
}

export const SITE_PORT = portBase();     // static server for the live site/ folder
export const DEV_PORT = SITE_PORT + 1;   // Vite dev server for v2 pages
export const SITE_URL = `http://127.0.0.1:${SITE_PORT}`;
export const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
