// BodyArcade app: screens, HUD, input orchestration and persistence.
// The 3D engine and the pose model are imported lazily when a run starts.
import { WORLDS, WORLD_BY_ID, WORLD_ALIASES } from './worlds.js';
import { Run, DIFFS, MOVES } from './sim.js';
import { Input } from './input.js';
import * as store from './store.js';

const VERSION = '20261007';
const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plausible = (ev, props) => { try { window.plausible && window.plausible(ev, props ? { props } : undefined); } catch {} };

// ───────────────────────── state ─────────────────────────
const st = {
  screen: 'start', world: 'alps', diff: 'medium', input: 'camera', skin: 'runner',
  engine: null, enginePromise: null, run: null, inputCtl: new Input(), tracker: null, poseModule: null,
  raf: 0, lastT: 0, paused: false, pauseReason: '', calibrated: false, sound: true, challenge: null, lastSummary: null,
  test: { enabled: false, fast: false, events: [] },
};

// ───────────────────────── tiny synth for sound effects ─────────────────────────
const sfx = (() => {
  let ctx = null;
  const ac = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; };
  const tone = (f0, f1, dur, type = 'sine', vol = 0.25, delay = 0) => {
    const c = ac(); if (!c || !st.sound) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, c.currentTime + delay); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.currentTime + delay + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + delay); g.gain.exponentialRampToValueAtTime(vol, c.currentTime + delay + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + dur);
    o.connect(g).connect(c.destination); o.start(c.currentTime + delay); o.stop(c.currentTime + delay + dur + 0.02);
  };
  const noise = (dur, vol = 0.3) => {
    const c = ac(); if (!c || !st.sound) return;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.value = vol; s.connect(f).connect(g).connect(c.destination); s.start();
  };
  return {
    unlock: () => ac(),
    jump: () => tone(300, 700, 0.18, 'sine', 0.18),
    coin: () => { tone(1200, 1200, 0.07, 'square', 0.08); tone(1600, 1600, 0.12, 'square', 0.08, 0.07); },
    pass: () => tone(520, 880, 0.12, 'triangle', 0.15),
    hit: () => { noise(0.3, 0.35); tone(140, 60, 0.3, 'sawtooth', 0.2); },
    tick: () => tone(660, 660, 0.08, 'square', 0.1),
    go: () => tone(880, 1320, 0.25, 'square', 0.12),
    done: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.35, 'triangle', 0.16, i * 0.12)); },
  };
})();

// ───────────────────────── helpers ─────────────────────────
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + id));
  st.screen = id;
  document.body.dataset.screen = id;
}
let toastT = 0;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function modal(html, { onClose } = {}) {
  const m = $('modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><button class="icon-btn modal-close" type="button" aria-label="Close">${ICON.close}</button>${html}</div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; onClose && onClose(); };
  m.querySelector('.modal-close').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  return { close, el: m };
}
const ICON = {
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>',
  soundOn: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3V5L6 8H3z"/><path d="M13 7.5a3.5 3.5 0 010 5M15.5 5a7 7 0 010 10"/></svg>',
  soundOff: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8v4h3l4 3V5L6 8H3z"/><path d="M13 8l4 4M17 8l-4 4"/></svg>',
  pause: '<svg viewBox="0 0 20 20" fill="currentColor"><rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/></svg>',
  daily: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 1.5"/></svg>',
};
// Move pictograms for the HUD prompt (stick figure + orange obstacle).
const FIG = {
  hurdle: '<svg viewBox="0 0 100 100"><rect x="18" y="80" width="64" height="8" rx="2" fill="#ff4f24"/><g stroke="#f3eee5" stroke-width="5" stroke-linecap="round" fill="none"><circle cx="50" cy="16" r="8" fill="#f3eee5" stroke="none"/><path d="M50 26v24M38 34h24M38 34l-6-12M62 34l6-12M42 50h16M42 50l-8 18M58 50l8 18"/></g></svg>',
  duck: '<svg viewBox="0 0 100 100"><rect x="14" y="20" width="72" height="8" rx="2" fill="#ff4f24"/><g stroke="#f3eee5" stroke-width="5" stroke-linecap="round" fill="none"><circle cx="50" cy="40" r="8" fill="#f3eee5" stroke="none"/><path d="M50 50v18M40 56h20M40 56l-8 10M60 56l8 10M42 68h16M42 68l-6 20M58 68l6 20"/></g></svg>',
  squat: '<svg viewBox="0 0 100 100"><rect x="14" y="30" width="72" height="8" rx="2" fill="#ffc93c"/><g stroke="#f3eee5" stroke-width="5" stroke-linecap="round" fill="none"><circle cx="50" cy="50" r="8" fill="#f3eee5" stroke="none"/><path d="M50 60v12M40 64h20M40 64l-10 6M60 64l10 6M42 72h16M42 72l-12 8 6 10M58 72l12 8-6 10"/></g></svg>',
  wallL: '<svg viewBox="0 0 100 100"><rect x="58" y="22" width="28" height="66" rx="3" fill="#ff4f24"/><g stroke="#f3eee5" stroke-width="5" stroke-linecap="round" fill="none"><circle cx="36" cy="18" r="8" fill="#f3eee5" stroke="none"/><path d="M40 28l8 26M30 36l18 0M30 36l-8 12M48 36l6 14M42 54h16M42 54l-4 30M58 54l2 30"/></g><path d="M22 70H8m0 0l6-6M8 70l6 6" stroke="#ffc93c" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
  wallR: '<svg viewBox="0 0 100 100"><rect x="14" y="22" width="28" height="66" rx="3" fill="#ff4f24"/><g stroke="#f3eee5" stroke-width="5" stroke-linecap="round" fill="none"><circle cx="64" cy="18" r="8" fill="#f3eee5" stroke="none"/><path d="M60 28l-8 26M70 36l-18 0M70 36l8 12M52 36l-6 14M58 54H42M58 54l4 30M42 54l-2 30"/></g><path d="M78 70h14m0 0l-6-6M92 70l-6 6" stroke="#ffc93c" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
};

// ───────────────────────── start screen ─────────────────────────
function worldSwatch(w) {
  return `<span class="sw" style="background:linear-gradient(180deg,${w.sky.top},${w.sky.mid} 55%,${w.sky.bot});--g:${w.ground}"><i></i><em style="background:${w.sky.sunGlow}"></em></span>`;
}
function renderWorlds() {
  const pro = store.isPro();
  $('worlds').innerHTML = WORLDS.map(w => {
    const locked = !w.free && !pro;
    return `<button class="world${locked ? ' locked' : ''}" type="button" role="radio" aria-checked="${w.id === st.world}" data-id="${w.id}" title="${esc(w.tagline)}">${worldSwatch(w)}<span class="tg${w.free ? '' : ' pro'}">${w.free ? 'Free' : 'Pro'}</span><span class="nm">${w.name}</span></button>`;
  }).join('');
  $('worlds').querySelectorAll('.world').forEach(b => b.onclick = () => {
    const w = WORLD_BY_ID[b.dataset.id];
    if (!w.free && !store.isPro()) { openPro(`${w.name} is a Pro world.`); return; }
    st.world = w.id; store.settings.set({ world: w.id }); renderWorlds();
  });
  const w = WORLD_BY_ID[st.world];
  $('world-tag').textContent = w ? w.tagline : '';
}
function renderDiffs() {
  const pro = store.isPro();
  $('diffs').innerHTML = Object.entries(DIFFS).map(([id, d]) => `<button type="button" role="radio" aria-checked="${id === st.diff}" data-id="${id}" class="${d.pro && !pro ? 'locked' : ''}">${d.label}</button>`).join('');
  $('diffs').querySelectorAll('button').forEach(b => b.onclick = () => {
    const d = DIFFS[b.dataset.id];
    if (d.pro && !store.isPro()) { openPro(`${d.label} difficulty is part of Pro.`); return; }
    st.diff = b.dataset.id; store.settings.set({ diff: st.diff }); renderDiffs();
  });
  $('diff-hint').textContent = DIFFS[st.diff].hint;
}
function renderRunsLeft() {
  const left = store.runsLeft();
  const el = $('runs-left');
  if (left === Infinity) el.textContent = 'Pro: unlimited runs, every world.';
  else el.innerHTML = left > 0 ? `${left} of ${store.DAILY_FREE_LIMIT} free runs left today.` : `No free runs left today. <button class="link-btn" type="button" id="b-pro-inline">Go Pro for unlimited runs</button> or come back tomorrow.`;
  const b = $('b-pro-inline'); if (b) b.onclick = () => openPro();
  $('b-pro').classList.toggle('on', store.isPro());
  $('b-pro').textContent = store.isPro() ? 'Pro ✓' : 'Pro';
}
function renderDaily() {
  const g = store.dailyGoal(), done = store.dailyDone(), streak = store.dailyStreak();
  const w = WORLD_BY_ID[g.world];
  $('daily').className = 'daily' + (done ? ' done' : '');
  $('daily').innerHTML = `<div class="daily-ico">${ICON.daily}</div><div><b>Daily goal${done ? ': done' : ''}</b><span>${esc(g.text)} in ${w.name}.</span></div><div class="streak" title="Daily streak">${streak > 0 ? streak + 'd' : ''}</div>`;
}
function renderChallenge() {
  const c = st.challenge; const el = $('challenge');
  if (!c) { el.hidden = true; return; }
  const w = WORLD_BY_ID[c.world] || WORLD_BY_ID.alps;
  el.hidden = false;
  el.innerHTML = `<b>${esc(c.name)}</b> challenged you: beat <b>${c.score.toLocaleString()}</b> in ${w.name} on ${(DIFFS[c.diff] || DIFFS.medium).label}.`;
}
function renderStart() { renderWorlds(); renderDiffs(); renderRunsLeft(); renderDaily(); renderChallenge(); $('b-sound').innerHTML = st.sound ? ICON.soundOn : ICON.soundOff; $('b-sound').setAttribute('aria-pressed', String(st.sound)); }

// ───────────────────────── Pro ─────────────────────────
function openPro(reason = '') {
  const pro = store.isPro(); const l = store.license();
  const m = modal(`
    <p class="kicker">BodyArcade Pro</p>
    <h2 class="display">${pro ? 'Pro is active' : 'Every world. Every day.'}</h2>
    ${reason ? `<p><b>${esc(reason)}</b></p>` : ''}
    ${pro ? `<p>Thanks for supporting BodyArcade. Your key ${l && l.email ? `(${esc(l.email)})` : ''} is saved in this browser.</p><p><button class="link-btn" type="button" id="b-key-remove">Remove key from this browser</button></p>` : `
    <ul><li>Unlimited runs (free is ${store.DAILY_FREE_LIMIT} a day)</li><li>All ten worlds</li><li>Hard and Insane difficulty</li><li>Every runner look</li><li>Full workout history</li></ul>
    <div class="plans">
      <div class="plan featured"><span class="pn">Pro</span><span class="pp">$4.99<small> / month</small></span><span class="small muted">Cancel anytime on Gumroad</span><a class="btn btn-play" href="${store.GUMROAD.pro.url}" target="_blank" rel="noopener" data-ev="Checkout Click" data-where="game-pro">Get Pro</a></div>
      <div class="plan"><span class="pn">Lifetime</span><span class="pp">$99<small> once</small></span><span class="small muted">One payment, no renewals</span><a class="btn btn-ghost" href="${store.GUMROAD.lifetime.url}" target="_blank" rel="noopener" data-ev="Checkout Click" data-where="game-lifetime">Buy lifetime</a></div>
    </div>
    <p class="small">After checkout, Gumroad emails you a license key. Paste it here to unlock Pro in this browser.</p>
    <div class="keyrow"><input id="i-key" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" autocomplete="off" spellcheck="false" aria-label="License key"><button id="b-key" class="btn btn-play" type="button">Activate</button></div>
    <p id="key-msg" class="key-msg"></p>`}`);
  const rm = $('b-key-remove'); if (rm) rm.onclick = () => { store.clearLicense(); m.close(); renderStart(); toast('Pro key removed.'); };
  const b = $('b-key');
  if (b) b.onclick = () => activateKey($('i-key').value, m);
  const inp = $('i-key'); if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') b.click(); };
  plausible('Pro Modal', { reason: reason || 'button' });
}
async function activateKey(key, m) {
  const msg = $('key-msg'), b = $('b-key');
  msg.className = 'key-msg'; msg.textContent = 'Checking with Gumroad…'; if (b) b.disabled = true;
  const r = await store.verifyLicense(key);
  if (b) b.disabled = false;
  if (r.ok) { msg.className = 'key-msg ok'; msg.textContent = 'Pro unlocked. Enjoy every world.'; plausible('Pro Activated'); setTimeout(() => { m && m.close(); renderStart(); }, 900); }
  else { msg.className = 'key-msg err'; msg.textContent = r.error; }
}

// ───────────────────────── achievements / history / skins ─────────────────────────
function openAchievements() {
  const u = store.unlocked();
  modal(`<p class="kicker">Achievements</p><h2 class="display">${u.length} of ${store.ACHIEVEMENTS.length}</h2><div class="ach">${store.ACHIEVEMENTS.map(a => `<div class="${u.includes(a.id) ? 'on' : ''}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>`).join('')}</div>`);
}
function openHistory() {
  const t = store.totals(); const runs = store.runs(); const pro = store.isPro();
  const shown = pro ? runs.slice(0, 60) : runs.slice(0, 7);
  const max = Math.max(1, ...shown.map(r => r.score));
  modal(`<p class="kicker">History</p><h2 class="display">Your runs</h2>
    <div class="hist-tot"><div><b>${t.runs}</b><span>runs</span></div><div><b>${Math.round(t.kcal)}</b><span>kcal est.</span></div><div><b>${Math.round(t.seconds / 60)}</b><span>minutes</span></div></div>
    ${shown.length ? `<div class="hist-chart" aria-label="Score per run">${shown.slice().reverse().map(r => `<i style="height:${Math.max(3, r.score / max * 100)}%" title="${r.score}"></i>`).join('')}</div>` : '<p class="muted">No runs yet. Your first one is 90 seconds away.</p>'}
    <ul class="hist-list">${shown.map(r => `<li><span><b>${r.score.toLocaleString()}</b> · ${esc((WORLD_BY_ID[r.world] || {}).name || r.world)} · ${esc((DIFFS[r.diff] || {}).label || '')}</span><span>${r.dist} m</span><span>${new Date(r.ts).toLocaleDateString()}</span></li>`).join('')}</ul>
    ${!pro && runs.length > 7 ? `<p class="small muted">Showing your last 7 runs. <button class="link-btn" type="button" id="b-hist-pro">Pro keeps the full history.</button></p>` : ''}`);
  const b = $('b-hist-pro'); if (b) b.onclick = () => openPro('Full history is part of Pro.');
}
const SKIN_LIST = [
  { id: 'runner', name: 'Runner', a: '#ff4f24', b: '#15130f', c: '#ffc93c', free: true }, { id: 'ninja', name: 'Ninja', a: '#1c1c22', b: '#15130f', c: '#ff4f24' },
  { id: 'knight', name: 'Knight', a: '#9aa2ad', b: '#5b616b', c: '#ffc93c' }, { id: 'astronaut', name: 'Astronaut', a: '#f0f2f5', b: '#d5d9df', c: '#ff4f24' },
  { id: 'wizard', name: 'Wizard', a: '#6b3fb5', b: '#2d1b4e', c: '#ffc93c' }, { id: 'robot', name: 'Robot', a: '#4a8ad8', b: '#2a4a74', c: '#5cdfff' },
  { id: 'demon', name: 'Demon', a: '#b8232b', b: '#3a0f12', c: '#ffb347' }, { id: 'angel', name: 'Angel', a: '#fff7e0', b: '#e8dcc0', c: '#ffd36b' },
];
function openSkins() {
  const pro = store.isPro();
  const m = modal(`<p class="kicker">Runner look</p><h2 class="display">Pick your runner</h2><p class="small muted">Looks are cosmetic. All of them come with Pro.</p>
    <div class="skins">${SKIN_LIST.map(s => `<button type="button" class="skin${s.id === st.skin ? ' on' : ''}${!s.free && !pro ? ' locked' : ''}" data-id="${s.id}" style="--a:${s.a};--b:${s.b};--c:${s.c}"><i></i><b>${s.name}</b><small>${s.free ? 'Free' : pro ? 'Pro' : 'Pro only'}</small></button>`).join('')}</div>`);
  m.el.querySelectorAll('.skin').forEach(b => b.onclick = () => {
    const s = SKIN_LIST.find(x => x.id === b.dataset.id);
    if (!s.free && !store.isPro()) { m.close(); openPro('Runner looks are part of Pro.'); return; }
    st.skin = s.id; store.settings.set({ skin: s.id }); m.close(); toast(`${s.name} it is.`);
  });
}

// ───────────────────────── engine + pose loading ─────────────────────────
function loadEngine() {
  if (!st.enginePromise) st.enginePromise = import('./engine.js?v=' + VERSION).then(mod => {
    const canvas = $('gl');
    const e = new mod.Engine(canvas, { quality: 'auto', reducedMotion: reduced });
    st.engine = e; st.engineMod = mod;
    return e;
  });
  return st.enginePromise;
}
async function loadPose() {
  if (!st.poseModule) st.poseModule = await import('./pose.js?v=' + VERSION);
  if (!st.tracker) {
    st.tracker = new st.poseModule.PoseTracker($('cam'), st.inputCtl);
    st.tracker.onFrame = drawPreview;
  }
  return st.tracker;
}

// skeleton preview on the mirrored camera canvas
const overlay = $('cam-overlay');
function drawPreview(lm, sig) {
  const c = overlay, pip = $('pip');
  const w = pip.clientWidth, h = pip.clientHeight;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d'); x.clearRect(0, 0, w, h);
  if (!lm) return;
  const P = (i) => [lm[i].x * w, lm[i].y * h]; // canvas itself is mirrored via CSS
  x.lineWidth = Math.max(2, w / 90); x.lineCap = 'round'; x.strokeStyle = sig.visible ? '#6fe39a' : '#ff5a4e';
  for (const [a, b] of st.poseModule.CONNECTIONS) { if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue; const [ax, ay] = P(a), [bx, by] = P(b); x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); }
  x.fillStyle = '#ffc93c';
  for (const i of [0, 11, 12, 23, 24, 25, 26]) { if ((lm[i].visibility ?? 1) < 0.4) continue; const [px, py] = P(i); x.beginPath(); x.arc(px, py, Math.max(3, w / 70), 0, Math.PI * 2); x.fill(); }
}

// ───────────────────────── flow: start → setup → run ─────────────────────────
function canStart() {
  if (store.runsLeft() <= 0) { openPro(`You’ve used today’s ${store.DAILY_FREE_LIMIT} free runs.`); return false; }
  return true;
}
async function startWithCamera() {
  if (!canStart()) return;
  sfx.unlock();
  st.input = 'camera'; store.settings.set({ input: 'camera' });
  plausible('Play Click', { where: 'game-camera' });
  show('setup');
  const pip = $('pip'); pip.hidden = false; pip.className = 'pip mode-setup';
  setStep('model', 'active'); setStep('camera', ''); setStep('frame', ''); setStep('still', '');
  $('setup-msg').textContent = '';
  loadEngine().catch(e => console.error(e));
  let tracker;
  try {
    const camP = loadPose().then(t => (tracker = t) && (st.test.enabled ? null : t.startCamera()));
    // model + camera in parallel
    const t = await loadPose();
    const modelP = t.load((s) => { $('setup-msg').textContent = s; });
    await camP.catch(e => { throw Object.assign(e, { stage: 'camera' }); });
    setStep('camera', 'done');
    await modelP.catch(e => { throw Object.assign(e, { stage: 'model' }); });
    setStep('model', 'done');
  } catch (e) {
    console.warn(e);
    if (e.stage === 'camera') {
      setStep('camera', 'error');
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      $('setup-msg').textContent = denied ? 'Camera blocked. Allow it in the address bar and press Back, then try again, or play with the keyboard.' : 'No camera found. You can still play with the keyboard.';
    } else {
      setStep('model', 'error');
      $('setup-msg').textContent = 'The pose model couldn’t load (check your connection). You can play with the keyboard meanwhile.';
    }
    return;
  }
  if (st.screen !== 'setup') return; // user backed out while loading
  tracker.resetCalibration(); st.calibrated = false;
  tracker.start();
  setStep('frame', 'active');
  $('setup-msg').textContent = 'Step back until your head and hips fit in the outline.';
  pip.classList.remove('ok');
  await waitForCalibration(tracker);
  if (st.screen !== 'setup') return;
  setStep('frame', 'done'); setStep('still', 'done');
  $('setup-msg').textContent = 'Calibrated. Here we go.';
  st.calibrated = true;
  await beginRun();
}
function setStep(id, cls) { const li = document.querySelector(`#setup-steps li[data-step="${id}"]`); if (li) li.className = cls; }
function waitForCalibration(tracker) {
  return new Promise((res) => {
    const pip = $('pip'); const ring = $('pip-ring-fill');
    const tick = () => {
      if (st.screen !== 'setup') return res();
      const c = tracker.calibrationStatus();
      const vis = tracker.signals.visible;
      pip.classList.toggle('ok', vis);
      $('pip-status').textContent = vis ? (c.ready ? 'Calibrated' : c.reason) : (st.inputCtl.tracking.reason || 'Looking for you…');
      ring.style.strokeDashoffset = String(289 * (1 - c.progress));
      if (vis) { setStep('frame', 'done'); setStep('still', c.ready ? 'done' : 'active'); $('setup-msg').textContent = c.ready ? 'Calibrated.' : c.reason; }
      else { setStep('frame', 'active'); setStep('still', ''); $('setup-msg').textContent = st.inputCtl.tracking.reason || 'Step back until your head and hips fit in the outline.'; }
      if (c.ready) return res();
      setTimeout(tick, 100);
    };
    tick();
  });
}
async function startWithKeys() {
  if (!canStart()) return;
  sfx.unlock();
  st.input = 'keys'; store.settings.set({ input: 'keys' });
  plausible('Play Click', { where: 'game-keyboard' });
  if (st.tracker) { st.tracker.stop(); st.tracker.stopCamera(); }
  $('pip').hidden = true;
  st.inputCtl.source = 'keys';
  show('run');
  $('countdown').hidden = false; $('countdown').innerHTML = '<b>…</b>';
  try { await loadEngine(); } catch (e) { console.error(e); toast('The 3D engine couldn’t load. Check your connection and reload.'); show('start'); return; }
  await beginRun();
}

async function beginRun() {
  const engine = await loadEngine();
  const world = WORLD_BY_ID[st.world] || WORLDS[0];
  const profile = store.profile.get();
  show('run');
  engine.resize();
  engine.setWorld(world, st.skin);
  engine.clearObstacles();
  st.run = new Run({ diff: st.diff, weight: profile.weight || 70 });
  st.inputCtl.reset();
  st.inputCtl.enabled = false;
  if (st.input === 'camera') { const pip = $('pip'); pip.hidden = false; pip.className = 'pip mode-run'; }
  $('hud-world').textContent = world.name + ' · ' + DIFFS[st.diff].label;
  $('hud-input').textContent = st.input === 'camera' ? 'Camera' : (matchMedia('(pointer: coarse)').matches ? 'Swipe to move' : 'Keyboard');
  renderHearts(3);
  $('hud-score').textContent = '0'; $('hud-combo').textContent = ''; $('hud-time').textContent = '90'; $('timefill').style.transform = 'scaleX(1)';
  $('prompt').classList.remove('show'); $('track-warn').hidden = true; $('pause').hidden = true;
  st.paused = false;
  // one idle frame so the world is visible behind the countdown
  engine.update(0.016, { moveZ: 0, runner: st.run.runnerState, obstacles: [], coins: [] });
  await countdown();
  st.inputCtl.enabled = true;
  st.lastT = performance.now();
  cancelAnimationFrame(st.raf);
  st.raf = requestAnimationFrame(frame);
  plausible('Run Start', { world: world.id, diff: st.diff, input: st.input });
}
function countdown() {
  return new Promise((res) => {
    const el = $('countdown'); el.hidden = false;
    const steps = st.test.fast ? ['Go'] : ['3', '2', '1', 'Go'];
    const stepMs = st.test.fast ? 120 : 800;
    let i = 0;
    const next = () => {
      if (st.screen !== 'run') { el.hidden = true; return res(); }
      const s = steps[i++];
      el.innerHTML = `<b class="${s === 'Go' ? 'go' : ''}">${s}</b>`;
      if (s === 'Go') sfx.go(); else sfx.tick();
      if (i < steps.length) setTimeout(next, stepMs); else setTimeout(() => { el.hidden = true; res(); }, stepMs * 0.7);
    };
    next();
  });
}
function renderHearts(n) {
  const h = $('hearts');
  h.innerHTML = [0, 1, 2].map(i => `<span class="heart${i < n ? '' : ' off'}"></span>`).join('');
}

// ───────────────────────── game loop ─────────────────────────
let lostT = 0, hudScore = -1, hudTime = -1, hudDist = -1, hudKcal = -1;
function frame(now) {
  st.raf = requestAnimationFrame(frame);
  const run = st.run, engine = st.engine, input = st.inputCtl;
  if (!run || !engine) return;
  let dt = (now - st.lastT) / 1000; st.lastT = now;
  if (dt > 0.1) dt = 0.1;

  // tracking loss → auto pause (camera runs only)
  if (st.input === 'camera' && !st.paused) {
    if (st.tracker && !st.tracker.injected && st.tracker.lastFrameT && now / 1000 - st.tracker.lastFrameT > 1.5 && input.tracking.ok) input.tracking = { ok: false, reason: 'Camera stopped sending frames' };
    if (!input.tracking.ok) { lostT += dt; if (lostT > 1.0) pause('lost'); $('track-warn').hidden = false; $('track-warn').textContent = input.tracking.reason; }
    else { lostT = 0; $('track-warn').hidden = true; }
  }
  if (st.paused) {
    if (st.pauseReason === 'lost' && input.tracking.ok) { resume(); }
    engine.update(0, { moveZ: 0, runner: run.runnerState, obstacles: run.obstacles, coins: run.coins });
    return;
  }

  input.tick(dt);
  const events = run.update(dt, input);
  for (const ev of events) {
    if (ev.type === 'spawn') engine.addObstacle(ev.ob);
    else if (ev.type === 'remove') engine.removeObstacle(ev.ob);
    else if (ev.type === 'pass') { pop(`+${ev.pts}`, 'good'); sfx.pass(); if (ev.combo >= 3) $('hud-combo').textContent = `${ev.combo}× combo`; }
    else if (ev.type === 'hit') { engine.hit(); sfx.hit(); flash(); pop('Miss', 'bad'); renderHearts(ev.hearts); $('hud-combo').textContent = ''; }
    else if (ev.type === 'coin') { sfx.coin(); }
    else if (ev.type === 'jump') { sfx.jump(); }
    else if (ev.type === 'over' || ev.type === 'complete') { endRun(ev.type === 'complete'); return; }
    if (st.test.enabled) st.test.events.push(ev.type);
  }

  // HUD
  const sc = Math.round(run.score); if (sc !== hudScore) { hudScore = sc; $('hud-score').textContent = sc.toLocaleString(); }
  const tl = Math.max(0, Math.ceil(run.duration - run.t)); if (tl !== hudTime) { hudTime = tl; $('hud-time').textContent = tl; }
  $('timefill').style.transform = `scaleX(${Math.max(0, 1 - run.t / run.duration)})`;
  const d = Math.round(run.dist); if (d !== hudDist) { hudDist = d; $('hud-dist').firstElementChild.textContent = d; }
  const k = run.kcal.toFixed(1); if (k !== hudKcal) { hudKcal = k; $('hud-kcal').firstElementChild.textContent = k; }
  const nx = run.next();
  const pr = $('prompt');
  if (nx && nx.eta < run.diff.react * 1.1) {
    if (pr.dataset.id !== String(nx.id)) { pr.dataset.id = String(nx.id); $('prompt-icon').innerHTML = FIG[nx.move]; $('prompt-verb').textContent = MOVES[nx.move].verb; }
    const f = Math.min(1, 1 - nx.eta / (run.diff.react * 1.1));
    $('ring-fill').style.strokeDashoffset = String(289 * (1 - f));
    pr.classList.add('show'); pr.classList.toggle('now', nx.eta < (nx.type === 'hurdle' ? run.diff.jumpDur * 0.75 : 0.6));
  } else { pr.classList.remove('show'); pr.dataset.id = ''; }
  if (st.input === 'camera' && st.tracker) { $('pip-status').textContent = input.tracking.ok ? 'Tracking' : input.tracking.reason; $('pip').classList.toggle('ok', input.tracking.ok); }

  engine.update(dt, { moveZ: run.moveZ, runner: run.runnerState, obstacles: run.obstacles, coins: run.coins });
}
let popT = 0;
function pop(text, cls) { const p = $('pop'); p.className = 'pop'; void p.offsetWidth; p.textContent = text; p.className = 'pop go ' + cls; }
function flash() { const f = $('flash'); f.className = 'flash bad'; setTimeout(() => f.className = 'flash', 60); }

function pause(reason = 'user') {
  if (!st.run || st.paused || st.run.phase !== 'running') return;
  st.paused = true; st.pauseReason = reason; st.run.paused = true; st.inputCtl.enabled = false;
  $('pause').hidden = false;
  $('pause-msg').textContent = reason === 'lost' ? 'The camera lost you. Step back into view and the run continues.' : reason === 'hidden' ? 'You switched away. Ready when you are.' : '';
  $('b-recal').hidden = st.input !== 'camera';
}
async function resume() {
  if (!st.paused) return;
  $('pause').hidden = true;
  const wasLost = st.pauseReason === 'lost';
  st.pauseReason = '';
  if (!st.test.fast) { $('countdown').hidden = false; $('countdown').innerHTML = `<b class="go">${wasLost ? 'Go' : 'Go'}</b>`; await new Promise(r => setTimeout(r, 700)); $('countdown').hidden = true; }
  st.paused = false; st.run.paused = false; st.inputCtl.enabled = true; st.inputCtl.reset(); st.lastT = performance.now(); lostT = 0;
}
function quitRun() {
  cancelAnimationFrame(st.raf); st.run = null; st.paused = false;
  $('pause').hidden = true; $('pip').hidden = true;
  if (st.tracker) { st.tracker.stop(); st.tracker.stopCamera(); }
  show('start'); renderStart();
}
async function recalibrate() {
  if (!st.tracker) return;
  $('pause').hidden = true;
  st.pauseReason = 'recal';
  st.tracker.resetCalibration();
  const pip = $('pip'); pip.className = 'pip mode-setup'; show('setup');
  setStep('model', 'done'); setStep('camera', 'done'); setStep('frame', 'active'); setStep('still', '');
  await waitForCalibration(st.tracker);
  if (st.screen !== 'setup') return;
  show('run'); pip.className = 'pip mode-run'; st.engine.resize();
  resume();
}

// ───────────────────────── end of run ─────────────────────────
function endRun(complete) {
  cancelAnimationFrame(st.raf);
  const run = st.run; const s = run.summary(); st.lastSummary = s;
  const world = WORLD_BY_ID[st.world];
  st.inputCtl.enabled = false;
  $('pip').hidden = true;
  if (st.tracker) st.tracker.stop();
  if (s.seconds >= store.MIN_COUNTED_RUN && !store.isPro()) store.countRun();
  const prevBest = store.best(world.id);
  const res = store.afterRun({ ...s, world: world.id, ts: Date.now(), friend: st.challenge });
  if (complete) sfx.done(); else sfx.hit();
  show('results');
  $('res-kicker').textContent = complete ? `Run complete · ${world.name}` : `Out of lives · ${world.name}`;
  $('res-score').textContent = s.score.toLocaleString();
  $('res-best').textContent = s.score > prevBest && prevBest > 0 ? 'New best' : (prevBest === 0 ? 'First run here' : '');
  $('res-dist').textContent = s.dist + ' m'; $('res-cleared').textContent = s.cleared; $('res-combo').textContent = s.bestCombo; $('res-kcal').textContent = s.kcal;
  const notes = [];
  if (st.challenge) notes.push(s.score > st.challenge.score ? `<div>You beat <b>${esc(st.challenge.name)}</b>’s ${st.challenge.score.toLocaleString()}. Send your score back.</div>` : `<div><b>${esc(st.challenge.name)}</b> still leads with ${st.challenge.score.toLocaleString()}. ${(st.challenge.score - s.score).toLocaleString()} to go.</div>`);
  if (res.daily) notes.push(`<div>Daily goal done. <b>${res.daily.streak}-day streak.</b></div>`);
  for (const id of res.news) { const a = store.ACHIEVEMENTS.find(x => x.id === id); if (a) notes.push(`<div>Achievement: <b>${esc(a.name)}</b> · ${esc(a.desc)}</div>`); }
  if (!complete && s.hits >= 3 && s.cleared < 3 && st.input === 'camera') notes.push(`<div>Tip: the ring fills as an obstacle approaches. Make your move when it turns <b>yellow</b>.</div>`);
  if (!store.isPro() && store.runsLeft() === 0) notes.push(`<div>That was your last free run today. <b>Pro</b> removes the limit.</div>`);
  $('res-notes').innerHTML = notes.join('');
  const bests = store.runs().filter(r => r.world === world.id).sort((a, b) => b.score - a.score).slice(0, 5);
  $('res-bests').innerHTML = bests.length ? `<h3>Your best in ${world.name}</h3><ol>${bests.map((r, i) => `<li><b>${i + 1}</b><span>${new Date(r.ts).toLocaleDateString()} · ${esc((DIFFS[r.diff] || {}).label || '')}</span><span>${r.dist} m</span><b>${r.score.toLocaleString()}</b></li>`).join('')}</ol>` : '';
  plausible('Run Complete', { world: world.id, diff: st.diff, complete: String(complete) });
}
async function runAgain() {
  if (!canStart()) return;
  if (st.input === 'camera' && st.tracker && st.calibrated) { st.tracker.start(); await beginRun(); }
  else if (st.input === 'camera') startWithCamera();
  else startWithKeys();
}
function share() {
  const s = st.lastSummary; if (!s) return;
  const name = store.profile.get().name || 'A friend';
  const url = store.challengeLink({ name, score: s.score, world: st.world, diff: st.diff });
  const text = `I scored ${s.score.toLocaleString()} in BodyArcade (${WORLD_BY_ID[st.world].name}). Beat it?`;
  if (navigator.share) navigator.share({ title: 'BodyArcade challenge', text, url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Challenge link copied. Send it to a friend.'));
  plausible('Challenge Share');
}

// ───────────────────────── boot ─────────────────────────
function boot() {
  const s = store.settings.get(); const p = store.profile.get();
  st.world = WORLD_BY_ID[s.world] ? s.world : 'alps'; st.diff = DIFFS[s.diff] ? s.diff : 'medium'; st.sound = s.sound !== false; st.skin = s.skin || 'runner';
  if (!store.isPro()) { if (!WORLD_BY_ID[st.world].free) st.world = 'alps'; if (DIFFS[st.diff].pro) st.diff = 'medium'; }
  $('i-name').value = p.name || ''; $('i-weight').value = p.weight || '';
  // URL: ?world= / #world= from the landing, ?c= challenge, ?license= from a receipt, ?live=1 legacy
  const q = new URLSearchParams(location.search);
  const wm = (location.hash.match(/world=([a-z]+)/i) || [])[1] || q.get('world');
  if (wm) { const id = WORLD_ALIASES[wm.toLowerCase()] || wm.toLowerCase(); if (WORLD_BY_ID[id] && (WORLD_BY_ID[id].free || store.isPro())) st.world = id; }
  st.challenge = store.readChallenge();
  if (st.challenge) { if (WORLD_BY_ID[st.challenge.world] && (WORLD_BY_ID[st.challenge.world].free || store.isPro())) st.world = st.challenge.world; if (DIFFS[st.challenge.diff] && (!DIFFS[st.challenge.diff].pro || store.isPro())) st.diff = st.challenge.diff; }
  if (q.get('live')) setTimeout(() => toast('Live races are offline for now. Solo runs and friend challenges work.', 4200), 600);
  if (q.get('pro')) history.replaceState(null, '', location.pathname); // the old ?pro=1 shortcut is gone
  renderStart();
  store.refreshLicense().then(renderStart);
  if (q.get('license')) { openPro(); setTimeout(() => { const i = $('i-key'); if (i) { i.value = q.get('license'); $('b-key').click(); } }, 50); history.replaceState(null, '', location.pathname); }

  $('b-play').onclick = startWithCamera;
  $('b-play-keys').onclick = startWithKeys;
  $('b-setup-keys').onclick = () => { if (st.tracker) { st.tracker.stop(); st.tracker.stopCamera(); } startWithKeys(); };
  $('b-setup-back').onclick = () => { if (st.tracker) { st.tracker.stop(); st.tracker.stopCamera(); } $('pip').hidden = true; show('start'); };
  $('b-pro').onclick = () => openPro();
  $('b-ach').onclick = openAchievements; $('b-hist').onclick = openHistory; $('b-skins').onclick = openSkins;
  $('b-sound').onclick = () => { st.sound = !st.sound; store.settings.set({ sound: st.sound }); renderStart(); };
  $('i-name').onchange = () => store.profile.set({ name: $('i-name').value.trim().slice(0, 20) });
  $('i-weight').onchange = () => { const w = parseFloat($('i-weight').value); if (w >= 25 && w <= 250) store.profile.set({ weight: w }); };
  $('b-pause').innerHTML = ICON.pause; $('b-pause').onclick = () => pause('user');
  $('b-resume').onclick = resume; $('b-quit').onclick = quitRun; $('b-recal').onclick = recalibrate;
  $('b-again').onclick = runAgain; $('b-change').onclick = () => { $('pip').hidden = true; if (st.tracker) st.tracker.stopCamera(); show('start'); renderStart(); }; $('b-share').onclick = share;
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-ev]'); if (a) plausible(a.dataset.ev, { where: a.dataset.where || '' }); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.screen === 'run') { if (st.paused && st.pauseReason === 'user') resume(); else pause('user'); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.screen === 'run') pause('hidden'); });
  addEventListener('resize', () => { if (st.engine) st.engine.resize(); });
  st.inputCtl.attachKeyboard();
  st.inputCtl.attachTouch($('gl'));
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  // Warm the engine after the page is idle so "Play" feels instant.
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { if (!matchMedia('(prefers-reduced-data: reduce)').matches && !(navigator.connection && navigator.connection.saveData)) loadEngine().catch(() => {}); });
}

// ───────────────────────── automated test hook (no gameplay privileges) ─────────────────────────
window.__BA_TEST__ = {
  version: VERSION,
  enable({ fast = true } = {}) { st.test.enabled = true; st.test.fast = fast; },
  state() { const r = st.run; return { screen: st.screen, paused: st.paused, input: st.input, source: st.inputCtl.source, calibrated: st.calibrated, tracking: st.inputCtl.tracking, engineLevel: st.engine ? st.engine.level : null, fps: st.engine ? st.engine.fps : null, run: r ? { ...r.summary(), phase: r.phase, t: r.t, hearts: r.hearts, obstacles: r.obstacles.map(o => ({ id: o.id, type: o.type, side: o.side, z: +o.z.toFixed(2), resolved: o.resolved, safe: o.safe })), coins: r.coins.length, x: r.x, y: r.y, crouch: r.crouch, lane: st.inputCtl.lane } : null, events: st.test.events.splice(0) }; },
  injectAction(a) { const i = st.inputCtl; i.source = 'test'; if (a === 'jump') i.triggerJump(); else if (a === 'crouch') i.setCrouch(1); else if (a === 'stand') { i.setCrouch(0); i.setLane(0); } else if (a === 'left') i.setLane(-1); else if (a === 'right') i.setLane(1); else if (a === 'center') i.setLane(0); },
  async injectPose(lm) { const t = await loadPose(); t.inject(lm); },
  poseSignals() { return st.tracker ? { ...st.tracker.signals, base: st.tracker.base, calib: st.tracker.calibrationStatus() } : null; },
  next() { return st.run ? st.run.next() : null; },
  go: { camera: startWithCamera, keys: startWithKeys, again: runAgain },
};

boot();
