// The progress coach page, behind ?gelisim=1 (like the form coach and the Worlds page): not linked from the site until the
// whole of SPEC.md and the form coach's catalogue are built and tested together (no partial launch).
//   ?gelisim=1&lang=tr            the page
//   ?gelisim=1&trace=/tests/...   developers and tests: a recorded landmark trace instead of the camera
// Everything the person enters or captures lives in the vault on this device (core/growth/vault), sealed with AES-GCM; the
// page sends nothing anywhere (tests/e2e/growth.spec.ts checks every request).
import { askPersist, backupDue, isIosSafari, storageInfo } from '../../../core/growth/vault/persist.ts';
import { backupFileName, makeBackup, previewBackup, restoreBackup } from '../../../core/growth/vault/backup.ts';
import { openBackend, type VaultBackend } from '../../../core/growth/vault/db.ts';
import { Vault } from '../../../core/growth/vault/vault.ts';
import { detectLang, LANG_INFO, type Lang } from '../../../core/ui/i18n/index.ts';
import { DEFAULT_SETTINGS, makeHelpers, saveFile, field, numberInput, chips, type Ctx, type GrowthAccess, type Settings, type TabId } from './ctx.ts';
import { GROWTH_WORDS } from './strings.ts';
import type { PlayFacts } from './play.ts';
import { TODAY_CSS, tw } from './today-ui.ts';
import { coachNav } from '../coach-nav.ts';

export const GROWTH_CSS = `
.gc{--gc-bg:#140F27;--gc-panel:#1C1433;--gc-panel2:#241A42;--gc-line:#31285A;--gc-text:#F4F2F8;--gc-muted:#A79FBE;--gc-ok:#22C383;--gc-tip:#FFC53A;--gc-accent:#7FD8FF;
  min-height:100vh;background:var(--gc-bg);color:var(--gc-text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  padding:16px clamp(16px,3vw,40px) 40px;box-sizing:border-box;width:100%}
.gc *{box-sizing:border-box}
.gc a{color:var(--gc-accent)}
.gc-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 20px;margin-bottom:12px}
.gc-top .gc-brand{color:var(--gc-text);font-weight:800;text-decoration:none;font-size:18px}
.gc-topnav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;width:100%}
.gc-top h1{margin:0;font-size:24px}
.gc-top p{margin:0;color:var(--gc-muted);font-size:14px;flex:1 1 320px}
.gc-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:16px;scrollbar-width:thin}
.gc-tab{font:inherit;font-weight:700;border-radius:12px;border:1px solid var(--gc-line);background:var(--gc-panel);color:var(--gc-muted);padding:10px 16px;cursor:pointer;min-height:44px;white-space:nowrap}
.gc-tab[aria-selected=true]{background:var(--gc-panel2);color:var(--gc-text);border-color:var(--gc-accent)}
.gc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
.gc-wide{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px}
.gc-card{background:var(--gc-panel);border:1px solid var(--gc-line);border-radius:16px;padding:16px;min-width:0}
.gc-card h2{margin:0 0 10px;font-size:19px}
.gc-card h3{margin:14px 0 8px;font-size:14px;color:var(--gc-muted);text-transform:uppercase;letter-spacing:.04em}
.gc-card p{margin:0 0 10px;line-height:1.45}
.gc-muted{color:var(--gc-muted);font-size:14px}
.gc-note{color:var(--gc-muted);font-size:13px;line-height:1.45;margin-top:10px}
.gc-btn{font:inherit;font-weight:700;border-radius:12px;border:1px solid var(--gc-line);background:var(--gc-panel2);color:var(--gc-text);padding:10px 14px;cursor:pointer;min-height:44px}
.gc-btn:disabled{opacity:.5;cursor:default}
.gc-btn--primary{background:#22C383;border-color:#14935F;color:#0E0A1E}
.gc-btn--danger{background:#3A1424;border-color:#8E2442;color:#FFD9E1}
.gc-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.gc-field{display:grid;gap:6px;font-size:14px;font-weight:600;min-width:0}
.gc-field input,.gc-field select{font:inherit;font-size:16px;border-radius:10px;border:1px solid var(--gc-line);background:#0F0B20;color:var(--gc-text);padding:10px 12px;min-height:44px;width:100%}
.gc-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin-bottom:12px}
.gc-chips{display:flex;flex-wrap:wrap;gap:8px}
.gc-chip{font:inherit;font-size:14px;font-weight:700;border-radius:999px;border:1px solid var(--gc-line);background:#0F0B20;color:var(--gc-muted);padding:8px 14px;cursor:pointer;min-height:40px}
.gc-chip[aria-pressed=true],.gc-chip[aria-checked=true]{background:#123B2C;border-color:var(--gc-ok);color:#D6F5E7}
.gc-q{margin:12px 0 6px;font-weight:700;font-size:15px}
.gc-pro{display:inline-block;font-size:12px;font-weight:800;border-radius:999px;padding:2px 8px;background:#3B2A6E;color:#E6DCFF;margin-left:6px;vertical-align:1px}
.gc-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#0E0A1E;border:1px solid var(--gc-accent);color:var(--gc-text);padding:12px 18px;border-radius:12px;font-weight:700;z-index:20;max-width:92vw}
.gc-stage{position:relative;background:#000;border-radius:16px;overflow:hidden;aspect-ratio:3/4;max-height:72vh;width:100%}
.gc-stage video,.gc-stage canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.gc-stage video{transform:scaleX(-1)}
.gc-buckets{position:absolute;top:10px;left:10px;right:10px;display:flex;flex-wrap:wrap;gap:6px}
.gc-bucket{background:rgba(20,15,39,.82);border-radius:999px;padding:5px 10px;font-size:13px;font-weight:800;color:var(--gc-muted)}
.gc-bucket[data-state=filled]{background:#123B2C;color:#D6F5E7}
.gc-bucket[data-state=now]{outline:2px solid var(--gc-tip);color:var(--gc-text)}
.gc-cue{position:absolute;left:10px;right:10px;bottom:10px;margin:0;background:rgba(20,15,39,.86);border-radius:14px;padding:12px 14px;font-size:clamp(18px,3vw,26px);font-weight:800;text-align:center}
.gc-cue:empty{display:none}
.gc-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.gc-shot{background:#0F0B20;border:1px solid var(--gc-line);border-radius:12px;padding:6px;display:grid;gap:6px;font-size:13px;font-weight:700;text-align:center}
.gc-shot img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;background:#000}
.gc-compare{position:relative;width:100%;aspect-ratio:3/4;max-height:70vh;background:#000;border-radius:14px;overflow:hidden}
.gc-compare canvas{position:absolute;inset:0;width:100%;height:100%}
.gc-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gc-twin{position:relative;width:100%;aspect-ratio:3/4;max-height:72vh;background:radial-gradient(circle at 50% 30%,#2A2148,#140F27 70%);border-radius:16px;overflow:hidden}
.gc-twin canvas{position:absolute;inset:0;width:100%;height:100%}
.gc-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--gc-muted);margin-top:8px}
.gc-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.gc-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.gc-list li{background:#0F0B20;border:1px solid var(--gc-line);border-radius:12px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:space-between}
.gc-list li b{font-weight:800}
.gc-big{font-size:clamp(34px,6vw,52px);font-weight:800;font-variant-numeric:tabular-nums;line-height:1}
.gc-session{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px}
.gc-meal{display:grid;gap:4px}
.gc-meal small{color:var(--gc-muted)}
.gc-lock{max-width:440px;margin:10vh auto}
.gc-body > .gc-grid + .gc-today, .gc-body > .gc-today + .gc-more{margin-top:16px}
.gc-more{font-size:15px;color:var(--gc-muted);text-transform:uppercase;letter-spacing:.05em;margin:22px 0 10px}
@media (max-width:900px){.gc-wide,.gc-session{grid-template-columns:1fr}.gc-top h1{font-size:21px}}
`;

function pickLang(win: Window): Lang {
  const q = new URLSearchParams(win.location.search).get('lang');
  const known = LANG_INFO.map((l) => l.code) as string[];
  if (q && known.includes(q)) return q as Lang;
  const seg = win.location.pathname.split('/')[1] ?? '';
  if (known.includes(seg)) return seg as Lang;
  return detectLang(win.navigator.languages);
}

export interface BootGrowthOptions {
  access?: GrowthAccess;
  /** tests: a backend (memory) instead of IndexedDB */
  backend?: VaultBackend;
  /** tests: PBKDF2 iterations (the default is 600 000) */
  iterations?: number;
  /** the games' side for the Today panel and the progress page (the arcade and the catalogue); without it they show the program only */
  play?: PlayFacts | null;
  /** the page's language when its address says it (/tr/today); otherwise ?lang= or the browser's */
  lang?: Lang;
}

export async function bootGrowth(win: Window = window, o: BootGrowthOptions = {}): Promise<() => void> {
  const doc = win.document;
  const params = new URLSearchParams(win.location.search);
  const lang = o.lang ?? pickLang(win);
  const W = GROWTH_WORDS[lang];
  const tag = LANG_INFO.find((l) => l.code === lang)?.tag ?? 'en';
  doc.documentElement.lang = tag;
  doc.title = `${W.title} · BodyArcade`;
  const style = doc.createElement('style'); style.textContent = GROWTH_CSS + TODAY_CSS; doc.head.append(style);
  const access: GrowthAccess = o.access ?? { can: () => false, profileId: 'me' };
  const backend = o.backend ?? await openBackend(access.profileId);
  const vault = await Vault.open(backend, o.iterations !== undefined ? { iterations: o.iterations } : {});
  const helpers = makeHelpers(doc, W);
  const root = helpers.el('main', 'gc');
  doc.body.append(root);
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let tab: TabId = (['home', 'progress', 'quests', 'photos', 'twin', 'program', 'food', 'settings'] as TabId[]).find((t) => win.location.hash === `#${t}`) ?? 'home';
  let disposeTab: (() => void) | null = null;
  let toastTimer = 0;

  const ctx: Ctx = {
    win, doc, lang, tag, W, vault, access, ...helpers,
    get settings() { return settings; },
    async saveSettings(patch) { settings = { ...settings, ...patch }; await vault.putJson('settings', 'settings', settings); },
    toast(text) {
      doc.querySelector('.gc-toast')?.remove();
      const t = helpers.el('div', 'gc-toast', text); t.setAttribute('role', 'status'); root.append(t);
      win.clearTimeout(toastTimer); toastTimer = win.setTimeout(() => t.remove(), 3200);
    },
    date: (ms) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)),
    refresh: () => render(),
    go: (t) => { tab = t; win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}#${t}`); render(); },
    minor: () => settings.birthYear !== null && new Date().getFullYear() - settings.birthYear < 18,
    traceUrl: (() => { const t = params.get('trace'); return t && t.startsWith('/') ? t : null; })(),
    play: o.play ?? null,
  } as Ctx;

  async function loadSettings(): Promise<void> {
    settings = { ...DEFAULT_SETTINGS, ...((await vault.getJson<Settings>('settings', 'settings')) ?? {}) };
    if (!settings.units || !(['metric', 'imperial'] as const).includes(settings.units)) settings.units = 'metric';
    if (settings.birthYear === null && lang === 'en' && /-US$/i.test(win.navigator.language)) settings.units = 'imperial';
  }

  // ---- lock: 5 minutes in the background locks a PIN vault ----
  let hiddenAt = 0;
  const onVis = (): void => {
    if (doc.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (vault.hasPin && hiddenAt && Date.now() - hiddenAt > 5 * 60_000) { vault.lock(); }
  };
  doc.addEventListener('visibilitychange', onVis);
  vault.onLock = () => render();

  function lockScreen(): HTMLElement {
    const c = helpers.el('section', 'gc-card gc-lock');
    c.dataset.lock = '';
    const pin = helpers.el('input'); pin.type = 'password'; pin.inputMode = 'numeric'; pin.autocomplete = 'current-password'; pin.setAttribute('aria-label', W.pinTitle);
    const msg = helpers.el('p', 'gc-muted'); msg.setAttribute('role', 'status');
    const go = helpers.btn(W.unlock, 'gc-btn gc-btn--primary', async () => {
      go.disabled = true;
      const ok = await vault.unlock(pin.value);
      go.disabled = false;
      if (!ok) { msg.textContent = W.pinWrong; pin.select(); return; }
      await loadSettings(); render();
    });
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    const row = helpers.el('div', 'gc-row'); row.append(go);
    c.append(helpers.el('h2', '', W.pinTitle), field(helpers, W.pinTitle, pin), row, msg, helpers.el('p', 'gc-note', W.pinForgot));
    return c;
  }

  function setupCard(): HTMLElement {
    const c = helpers.el('section', 'gc-card');
    c.dataset.setup = '';
    const year = numberInput(helpers, settings.birthYear, { min: 1900, max: new Date().getFullYear(), step: 1 });
    year.dataset.birthYear = '';
    const go = helpers.btn(W.continue, 'gc-btn gc-btn--primary', async () => {
      const y = Number(year.value);
      if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear()) { year.focus(); return; }
      await ctx.saveSettings({ birthYear: y, setupDone: true });
      render();
    });
    const skip = helpers.btn(W.skip, 'gc-btn', async () => { await ctx.saveSettings({ setupDone: true }); render(); });
    const row = helpers.el('div', 'gc-row'); row.append(go, skip);
    c.append(helpers.el('h2', '', W.setupTitle), field(helpers, W.birthYear, year), row);
    return c;
  }

  async function homeTab(host: HTMLElement): Promise<() => void> {
    // what needs saying first (the setup, the backup, the iPhone and private-window notes), then the Today panel (kol F),
    // then the shortcuts to the other tabs
    const grid = helpers.el('div', 'gc-grid');
    host.append(grid);
    if (!settings.setupDone) grid.append(setupCard());
    if (ctx.minor()) grid.append(Object.assign(helpers.el('section', 'gc-card'), { textContent: W.minorNote }));
    const info = await storageInfo(win.navigator.storage as never);
    if (backupDue({ lastBackupAt: settings.lastBackupAt, photosSinceBackup: settings.photosSinceBackup, persisted: info.persisted, now: Date.now(), firstPhotoAt: settings.firstPhotoAt })) {
      const c = helpers.el('section', 'gc-card'); c.dataset.backupDue = '';
      c.append(helpers.el('p', '', W.backupDue), helpers.btn(W.backup, 'gc-btn', () => ctx.go('settings')));
      grid.append(c);
    }
    if (isIosSafari(win.navigator.userAgent, win.navigator.maxTouchPoints) && settings.firstPhotoAt === null && !ctx.minor()) grid.append(Object.assign(helpers.el('section', 'gc-card gc-muted'), { textContent: W.iosCard }));
    if (!backend.persistent) grid.append(Object.assign(helpers.el('section', 'gc-card gc-muted'), { textContent: W.privateTab }));
    if (!grid.childElementCount) grid.remove();
    const panel = await (await import('./today-view.ts')).todayPanel(ctx, host);
    const more = helpers.el('div', 'gc-grid'); more.dataset.shortcuts = '';
    host.append(Object.assign(helpers.el('h2', 'gc-more'), { textContent: tw(ctx)('shortcuts') }), more);
    const sessions = (await vault.all<{ at: number }>('sessions')).map((s) => s.value.at).sort((a, b) => b - a);
    const measures = (await vault.all<{ at: number }>('measures')).map((s) => s.value.at).sort((a, b) => b - a);
    const card = (title: string, line: string, to: TabId): HTMLElement => {
      const c = helpers.el('section', 'gc-card');
      c.append(helpers.el('h2', '', title), helpers.el('p', 'gc-muted', line), helpers.btn(title, 'gc-btn', () => ctx.go(to)));
      return c;
    };
    if (!ctx.minor()) more.append(card(W.homePhotos, sessions[0] ? ctx.t('lastOn', { date: ctx.date(sessions[0]) }) : W.none, 'photos'));
    more.append(card(W.homeTwin, measures[0] ? ctx.t('lastOn', { date: ctx.date(measures[0]) }) : W.none, 'twin'));
    const { programSummary } = await import('./program-view.ts');
    more.append(card(W.homeProgram, await programSummary(ctx), 'program'));
    more.append(card(W.homeFood, W.foodSetup, 'food'));
    return panel;
  }

  async function settingsTab(host: HTMLElement): Promise<() => void> {
    const grid = helpers.el('div', 'gc-grid'); host.append(grid);
    // PIN
    const lockCard = helpers.el('section', 'gc-card');
    const pin = helpers.el('input'); pin.type = 'password'; pin.inputMode = 'numeric'; pin.autocomplete = 'new-password'; pin.dataset.newPin = '';
    const state = helpers.el('p', 'gc-muted', vault.hasPin ? W.pinOn : W.pinOff);
    const row = helpers.el('div', 'gc-row');
    row.append(helpers.btn(vault.hasPin ? W.pinChange : W.pinSet, 'gc-btn gc-btn--primary', async () => {
      try { await vault.setPin(pin.value); ctx.toast(W.pinOn); render(); } catch { pin.focus(); ctx.toast(W.pinNew); }
    }));
    if (vault.hasPin) {
      row.append(helpers.btn(W.pinRemove, 'gc-btn', async () => { if (await vault.removePin(pin.value)) { ctx.toast(W.pinOff); render(); } else ctx.toast(W.pinWrong); }));
      row.append(helpers.btn(W.lock, 'gc-btn', () => vault.lock()));
    }
    lockCard.append(helpers.el('h2', '', W.pinSet), state, field(helpers, W.pinNew, pin), row, helpers.el('p', 'gc-note', `${W.autoLock} ${W.pinForgot}`));
    grid.append(lockCard);
    // numbers and units
    const prefs = helpers.el('section', 'gc-card');
    prefs.append(helpers.el('h2', '', W.hideNumbers), helpers.el('p', 'gc-muted', W.hideNumbersNote),
      chips(helpers, [['on', W.yes], ['off', W.no]] as const, [settings.hideNumbers ? 'on' : 'off'], false, (v) => { void ctx.saveSettings({ hideNumbers: v[0] === 'on' }); }, 'hide'),
      helpers.el('h3', '', W.units),
      chips(helpers, [['metric', W.metric], ['imperial', W.imperial]] as const, [settings.units], false, (v) => { void ctx.saveSettings({ units: v[0] as Settings['units'] }); }, 'units'));
    grid.append(prefs);
    // storage, backup, restore, delete
    const store = helpers.el('section', 'gc-card');
    const info = await storageInfo(win.navigator.storage as never);
    store.append(helpers.el('h2', '', W.storage),
      helpers.el('p', 'gc-muted', ctx.t('used', { mb: info.usage === null ? '?' : (info.usage / 1e6).toFixed(1) })),
      helpers.el('p', 'gc-muted', info.persisted ? W.persistOn : W.persistOff),
      helpers.el('p', 'gc-muted', ctx.t('lastBackup', { date: settings.lastBackupAt ? ctx.date(settings.lastBackupAt) : W.never })));
    const pass = helpers.el('input'); pass.type = 'password'; pass.autocomplete = 'new-password'; pass.dataset.backupPass = '';
    const file = helpers.el('input'); file.type = 'file'; file.accept = '.bagelisim,application/zip'; file.dataset.restoreFile = '';
    const out = helpers.el('p', 'gc-muted'); out.setAttribute('role', 'status'); out.dataset.backupStatus = '';
    const b1 = helpers.btn(W.backup, 'gc-btn gc-btn--primary', async () => {
      b1.disabled = true;
      try {
        const bytes = await makeBackup(vault, pass.value, o.iterations !== undefined ? { iterations: o.iterations } : {});
        await saveFile(win, bytes, backupFileName(new Date()), 'application/zip');
        await ctx.saveSettings({ lastBackupAt: Date.now(), photosSinceBackup: 0 });
        out.textContent = W.backupDone;
      } catch { out.textContent = W.backupPass; pass.focus(); }
      b1.disabled = false;
    });
    const b2 = helpers.btn(W.restore, 'gc-btn', async () => {
      const f = file.files?.[0];
      if (!f) { file.click(); return; }
      b2.disabled = true;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        previewBackup(bytes);
        const r = await restoreBackup(vault, bytes, pass.value);
        await loadSettings();
        out.textContent = ctx.t('restoreDone', { n: r.records });
      } catch (e) {
        const code = (e as Error).message;
        out.textContent = code === 'backup:wrong-password' ? W.wrongPass : W.damaged;
      }
      b2.disabled = false;
    });
    const r2 = helpers.el('div', 'gc-row'); r2.append(b1, b2);
    store.append(field(helpers, W.backupPass, pass), field(helpers, W.backupFile, file), r2, out, helpers.el('p', 'gc-note', W.restoreWarn));
    // delete everything: two steps
    const del = helpers.btn(W.deleteAll, 'gc-btn gc-btn--danger', () => {
      const box = helpers.el('div', 'gc-card');
      box.dataset.deleteConfirm = '';
      box.append(helpers.el('p', '', W.deleteConfirm));
      const yes = helpers.btn(W.deleteYes, 'gc-btn gc-btn--danger', async () => { await vault.wipe(); settings = { ...DEFAULT_SETTINGS }; ctx.toast(W.deleted); render(); });
      const no = helpers.btn(W.cancel, 'gc-btn', () => box.remove());
      const r = helpers.el('div', 'gc-row'); r.append(yes, no); box.append(r);
      store.append(box);
    });
    store.append(del);
    grid.append(store);
    return () => undefined;
  }

  async function render(): Promise<void> {
    disposeTab?.(); disposeTab = null;
    // a toast shown just before a re-render (saved, PIN on, everything deleted) outlives it: it is fixed on screen anyway
    const toast = root.querySelector('.gc-toast');
    root.replaceChildren(...(toast ? [toast] : []));
    const top = helpers.el('header', 'gc-top');
    // the site's places (Kol G): games, Today, the form coach, progress and duels; Today is lit on its tab, progress on the others
    const cn = coachNav(doc, lang, tab === 'home' ? 'today' : 'progress');
    cn.brand.className = 'gc-brand';
    const bar = helpers.el('div', 'gc-topnav'); bar.append(cn.brand, cn.nav);
    top.append(bar, helpers.el('h1', '', W.title), helpers.el('p', '', W.privacy));
    root.append(top);
    if (vault.state === 'locked') { root.append(lockScreen()); return; }
    if (tab === 'photos' && ctx.minor()) tab = 'home';
    const tabs = helpers.el('nav', 'gc-tabs'); tabs.setAttribute('role', 'tablist');
    const T = tw(ctx);
    const names: [TabId, string][] = [['home', W.tabHome], ['progress', T('tabProgress')], ['quests', T('tabQuests')], ['program', W.tabProgram], ['food', W.tabFood], ['photos', W.tabPhotos], ['twin', W.tabTwin], ['settings', W.tabSettings]];
    for (const [id, name] of names) {
      if (id === 'photos' && ctx.minor()) continue;
      const b = helpers.btn(name, 'gc-tab', () => ctx.go(id)); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === tab)); b.dataset.tab = id;
      tabs.append(b);
    }
    root.append(tabs);
    if (tab === 'photos' && ctx.minor()) tab = 'home';
    const host = helpers.el('div', 'gc-body'); host.dataset.view = tab; root.append(host);
    if (tab === 'home') disposeTab = await homeTab(host);
    else if (tab === 'settings') disposeTab = await settingsTab(host);
    else if (tab === 'photos') disposeTab = await (await import('./photos-view.ts')).photosTab(ctx, host);
    else if (tab === 'twin') disposeTab = await (await import('./twin-tab.ts')).twinTab(ctx, host);
    else if (tab === 'program') disposeTab = await (await import('./program-view.ts')).programTab(ctx, host);
    else if (tab === 'food') disposeTab = await (await import('./food-view.ts')).foodTab(ctx, host);
    else if (tab === 'progress') disposeTab = await (await import('./progress-view.ts')).progressTab(ctx, host);
    else if (tab === 'quests') disposeTab = await (await import('./quests-view.ts')).questsTab(ctx, host);
    root.dataset.ready = tab;
  }

  if (vault.state === 'open') await loadSettings();
  void askPersist; // asked on the first saved photo (photos-view.ts)
  await render();
  (win as unknown as { __growth?: unknown }).__growth = { vault, ctx: () => ctx, render: () => render() };
  const dispose = (): void => { disposeTab?.(); doc.removeEventListener('visibilitychange', onVis); root.remove(); style.remove(); };
  win.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
