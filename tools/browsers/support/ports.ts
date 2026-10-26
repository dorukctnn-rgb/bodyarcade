// Ports of the cross-browser run, derived from the checkout path so several worktrees can run at once (BA_BROWSERS_PORT pins them).
// The platform's e2e uses 20000-39999 and the web shell's 40000-49999; this one stays at 10000-19999.
function portBase(): number {
  const fixed = Number(process.env['BA_BROWSERS_PORT']);
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  let h = 0;
  for (const ch of process.cwd().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 10000 + (h % 5000) * 2;
}

/** The web shell as the practice build (the fixtures and the test hooks are in it): production bundle, `?social=1` and the practice session. */
export const DEMO_PORT = portBase();
/** The release build (dist/): what the Worker serves on bodyarcade.com, the real catalogue and no test hooks, with the content pages and the service worker. */
export const RELEASE_PORT = DEMO_PORT + 1;
export const DEMO_URL = `http://127.0.0.1:${DEMO_PORT}`;
export const RELEASE_URL = `http://127.0.0.1:${RELEASE_PORT}`;
