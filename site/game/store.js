// Local persistence (profile, runs, achievements, daily goal) and Pro licensing.
// Nothing here talks to a server except Gumroad's public license check.
const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const SET = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Gumroad's license API refuses product_permalink for these products and needs product_id.
export const GUMROAD = {
  pro: { url: 'https://dorukctn.gumroad.com/l/ithhc', permalink: 'ithhc', productId: 'tN-xTHwaZm8bOdcHHBaKbQ==', label: 'Pro', price: '$4.99 / month' },
  lifetime: { url: 'https://dorukctn.gumroad.com/l/czrhwp', permalink: 'czrhwp', productId: 'xIio9_FPmjKjWkdZLQKVxA==', label: 'Lifetime', price: '$99 once' },
};
export const DAILY_FREE_LIMIT = 5;
export const MIN_COUNTED_RUN = 15; // seconds; aborted starts don't eat a free run

const today = () => new Date().toISOString().slice(0, 10);

// ── profile & settings ──
export const profile = {
  get() { return LS('ba_profile', { name: '', weight: 70 }); },
  set(p) { SET('ba_profile', { ...profile.get(), ...p }); },
};
export const settings = {
  get() { return LS('ba_settings', { world: 'alps', diff: 'medium', sound: true, input: 'camera', skin: 'runner' }); },
  set(s) { SET('ba_settings', { ...settings.get(), ...s }); },
};

// ── daily free runs ──
export function dailyRuns() { const d = LS('ba_daily', {}); return d[today()] || 0; }
export function countRun() {
  const d = LS('ba_daily', {}); const k = today();
  d[k] = (d[k] || 0) + 1;
  for (const key of Object.keys(d)) if (key !== k) delete d[key];
  SET('ba_daily', d);
}
export function runsLeft() { return isPro() ? Infinity : Math.max(0, DAILY_FREE_LIMIT - dailyRuns()); }

// ── Pro license (Gumroad) ──
export function license() { return LS('ba_license', null); }
export function isPro() {
  const l = license();
  if (!l || !l.key || !l.verifiedAt) return false;
  const age = Date.now() - l.verifiedAt;
  return age < 30 * 86400000; // re-verified in the background; 30-day offline grace
}
export function clearLicense() { try { localStorage.removeItem('ba_license'); } catch {} }

// Verifies a key against both products. No secret involved: Gumroad's verify endpoint is public.
export async function verifyLicense(key, { increment = true } = {}) {
  key = String(key || '').trim();
  if (!/^[A-Za-z0-9-]{8,}$/.test(key)) return { ok: false, error: 'That doesn’t look like a Gumroad license key.' };
  let lastErr = 'License key not found.';
  for (const [id, p] of Object.entries(GUMROAD)) {
    try {
      const body = new URLSearchParams({ product_id: p.productId, license_key: key, increment_uses_count: increment ? 'true' : 'false' });
      const res = await fetch('https://api.gumroad.com/v2/licenses/verify', { method: 'POST', body });
      const j = await res.json().catch(() => ({}));
      if (!j.success) { lastErr = j.message || lastErr; continue; }
      const pu = j.purchase || {};
      if (pu.refunded || pu.chargebacked || pu.disputed) return { ok: false, error: 'This purchase was refunded.' };
      if (pu.subscription_ended_at || pu.subscription_cancelled_at || pu.subscription_failed_at) return { ok: false, error: 'This subscription has ended. Renew it on Gumroad to keep Pro.' };
      const l = { key, product: id, verifiedAt: Date.now(), email: pu.email ? String(pu.email).replace(/(.{2}).+(@.+)/, '$1…$2') : '' };
      SET('ba_license', l);
      return { ok: true, license: l };
    } catch (e) { lastErr = 'Couldn’t reach Gumroad. Check your connection and try again.'; return { ok: false, error: lastErr, network: true }; }
  }
  return { ok: false, error: lastErr };
}
// Silent re-check once a day; keeps the key if the network is down.
export async function refreshLicense() {
  const l = license(); if (!l || !l.key) return;
  if (Date.now() - l.verifiedAt < 86400000) return;
  const r = await verifyLicense(l.key, { increment: false });
  if (!r.ok && !r.network) clearLicense();
}

// ── runs, bests, totals ──
export function recordRun(run) {
  const list = LS('ba_runs', []);
  list.unshift(run);
  SET('ba_runs', list.slice(0, 200));
  const t = LS('ba_totals', { runs: 0, kcal: 0, cleared: 0, seconds: 0 });
  t.runs++; t.kcal += run.kcal || 0; t.cleared += run.cleared || 0; t.seconds += run.seconds || 0;
  SET('ba_totals', t);
  const b = LS('ba_best', {});
  if (!b[run.world] || run.score > b[run.world]) b[run.world] = run.score;
  SET('ba_best', b);
}
export function runs() { return LS('ba_runs', []); }
export function totals() { return LS('ba_totals', { runs: 0, kcal: 0, cleared: 0, seconds: 0 }); }
export function best(world) { const b = LS('ba_best', {}); return world ? (b[world] || 0) : Math.max(0, ...Object.values(b)); }

// ── achievements ──
export const ACHIEVEMENTS = [
  { id: 'first-run', name: 'First steps', desc: 'Finish your first run' },
  { id: 'clean-run', name: 'Clean run', desc: 'Finish a 90-second run without a hit' },
  { id: 'combo-10', name: 'Ten in a row', desc: 'Clear 10 obstacles without a miss' },
  { id: 'combo-25', name: 'Untouchable', desc: 'Clear 25 obstacles without a miss' },
  { id: 'runs-10', name: 'Regular', desc: 'Finish 10 runs' },
  { id: 'runs-50', name: 'Dedicated', desc: 'Finish 50 runs' },
  { id: 'kcal-100', name: 'Hundred', desc: 'Burn 100 calories in total (estimate)' },
  { id: 'kcal-1000', name: 'Thousand', desc: 'Burn 1,000 calories in total (estimate)' },
  { id: 'coins-50', name: 'Collector', desc: 'Pick up 50 coins in one run' },
  { id: 'daily-3', name: 'Three days', desc: 'Hit the daily goal 3 days running' },
  { id: 'daily-7', name: 'One week', desc: 'Hit the daily goal 7 days running' },
  { id: 'all-free', name: 'Grand tour', desc: 'Run Alps, Desert and Forest' },
  { id: 'all-worlds', name: 'World tour', desc: 'Run all ten worlds' },
  { id: 'hard-finish', name: 'Hard finish', desc: 'Finish a run on Hard or Insane' },
  { id: 'beat-friend', name: 'Rival', desc: 'Beat a friend’s challenge score' },
];
export function unlocked() { return LS('ba_achievements', []); }
export function unlock(id) {
  const u = unlocked(); if (u.includes(id)) return false;
  u.push(id); SET('ba_achievements', u); return true;
}

// ── daily goal (date-seeded, client only) ──
function seedRand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function dailyGoal() {
  const d = new Date(); const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const r = seedRand(seed);
  const worlds = ['alps', 'desert', 'forest'];
  const kinds = [
    { kind: 'score', target: 1500 + Math.floor(r() * 5) * 250, text: (t) => `Score ${t.toLocaleString()} in one run` },
    { kind: 'cleared', target: 12 + Math.floor(r() * 6) * 2, text: (t) => `Clear ${t} obstacles in one run` },
    { kind: 'coins', target: 20 + Math.floor(r() * 4) * 5, text: (t) => `Collect ${t} coins in one run` },
  ];
  const k = kinds[Math.floor(r() * kinds.length)];
  return { seed, world: worlds[Math.floor(r() * worlds.length)], kind: k.kind, target: k.target, text: k.text(k.target) };
}
export function dailyDone() { const g = dailyGoal(); return LS('ba_daily_done', 0) === g.seed; }
export function dailyStreak() { return LS('ba_daily_streak', { n: 0, last: 0 }).n; }
export function markDaily() {
  const g = dailyGoal(); if (LS('ba_daily_done', 0) === g.seed) return dailyStreak();
  const st = LS('ba_daily_streak', { n: 0, last: 0 });
  const y = new Date(); y.setDate(y.getDate() - 1);
  const ySeed = y.getFullYear() * 10000 + (y.getMonth() + 1) * 100 + y.getDate();
  st.n = st.last === ySeed ? st.n + 1 : 1; st.last = g.seed;
  SET('ba_daily_streak', st); SET('ba_daily_done', g.seed);
  return st.n;
}

// ── friend challenge links (no server; the score rides in the URL) ──
const b64e = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '');
const b64d = (s) => { try { return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch { return null; } };
export function challengeLink({ name, score, world, diff }) {
  return location.origin + '/bodyarcade?c=' + b64e({ n: String(name || 'A friend').slice(0, 20), s: score | 0, w: world, d: diff });
}
export function readChallenge() {
  const m = location.search.match(/[?&]c=([^&]+)/); if (!m) return null;
  const d = b64d(decodeURIComponent(m[1]));
  return d && d.s ? { name: d.n, score: d.s, world: d.w, diff: d.d } : null;
}

// ── world progress ──
export function worldsPlayed() { return LS('ba_worlds', []); }
export function markWorld(id) { const w = worldsPlayed(); if (!w.includes(id)) { w.push(id); SET('ba_worlds', w); } return w; }

// Evaluate everything after a run; returns newly unlocked achievement ids and daily info.
export function afterRun(run) {
  recordRun(run);
  const t = totals();
  const w = markWorld(run.world);
  const news = [];
  const u = (id, cond = true) => { if (cond && unlock(id)) news.push(id); };
  u('first-run');
  u('clean-run', run.complete && run.hits === 0);
  u('combo-10', run.bestCombo >= 10);
  u('combo-25', run.bestCombo >= 25);
  u('runs-10', t.runs >= 10); u('runs-50', t.runs >= 50);
  u('kcal-100', t.kcal >= 100); u('kcal-1000', t.kcal >= 1000);
  u('coins-50', run.coins >= 50);
  u('all-free', ['alps', 'desert', 'forest'].every(x => w.includes(x)));
  u('all-worlds', w.length >= 10);
  u('hard-finish', run.complete && (run.diff === 'hard' || run.diff === 'insane'));
  u('beat-friend', run.friend && run.score > run.friend.score);
  let daily = null;
  const g = dailyGoal();
  if (run.world === g.world && !dailyDone()) {
    const val = g.kind === 'score' ? run.score : g.kind === 'cleared' ? run.cleared : run.coins;
    if (val >= g.target) { const streak = markDaily(); daily = { streak }; u('daily-3', streak >= 3); u('daily-7', streak >= 7); }
  }
  return { news, daily };
}
