// The browser app: it owns the settings, the language, the plan and the router, draws the page for each address with
// the same views the page generator uses, and handles what the player does (clicks, forms, the round).
import type { Plan, Session } from '../../../core/types/index.ts';
import { detectUiCapabilities, type UiCapabilities } from '../../../core/ui/capabilities.ts';
import { openDialog } from '../../../core/ui/dialog.ts';
import { detectLang, isLang, LANG_INFO, type I18n, type Lang } from '../../../core/ui/i18n/index.ts';
import { createLiveRegion, type LiveRegion } from '../../../core/ui/live-region.ts';
import { createNavigation, type Matched, type Navigation, type RouteChange } from '../../../core/ui/router.ts';
import { shouldShowPaywallAfterRound, STUB_PLANS, type PlansConfig } from '../../../core/ui/plans.ts';
import { applySettingsToDocument, createSettingsStore, type Settings, type SettingsStore } from '../../../core/ui/settings.ts';
import { createToaster, type Toaster } from '../../../core/ui/toast.ts';
import { createStore, type BodyArcadeStore, type StorageLike, type StoreNamespace } from '../../../core/store/store.ts';
import type { Catalogue, ShellGame } from '../../catalogue/types.ts';
import { gameById, gameBySlug } from '../../catalogue/filter.ts';
import { mappedAssets, devAssets, type AssetResolver } from '../assets.ts';
import type { ViewContext } from '../context.ts';
import { accessOf, hasPro, titleOf } from '../context.ts';
import { makeContext } from '../make-context.ts';
import { EMPTY_STATE, renderPage, SITE_ORIGIN, type PageState } from '../pages.ts';
import { INDEXED_LANGS, router, type RouteId } from '../routes.ts';
import type { GameData } from '../views/game.ts';
import type { HomeData } from '../views/home.ts';
import { confirmHtml, type ConfirmOptions } from '../views/misc.ts';
import { defaultPaywallState, selectedOffer, type KeyStatus, type PaywallState } from '../views/paywall.ts';
import type { RoundResult } from '../views/results.ts';
import { PRO_DIFFICULTIES, defaultSetup, playHref, sanitizeSetup, setupFields, setupFromForm, setupFromQuery, type SetupState } from '../views/setup.ts';
import { applyHead, readAssetMap, swap } from './dom.ts';
import { localEntitlements } from './entitlements.ts';
import { addRound, HISTORY_SCHEMA, recentBests, weekStats, type RoundRecord } from './history.ts';
import { PlayController, type PlayHost } from './play.ts';
import type { EntitlementsPort, SessionFactory } from './ports.ts';
import { SocialController, SOCIAL_ROUTES, type SocialHost } from './social.ts';
import type { SocialServices } from '../social/port.ts';
import { BESTS_SCHEMA, bestOf, buildRoundResult, withBest, type Bests } from './results.ts';

/** What a session factory needs from the app: where the store is, the words, and the player's switches. */
export interface AppServices {
  store: BodyArcadeStore;
  i18n(): I18n;
  reducedMotion(): boolean;
  soundOn(): boolean;
  quiet(): boolean;
}

export interface AppOptions {
  win: Window & typeof globalThis;
  catalogue: Catalogue;
  version: string;
  /** Development and test builds: the practice session, test hooks and the demo license key. */
  demo: boolean;
  storage?: StorageLike | null;
  entitlements?: EntitlementsPort;
  sessionFactory?: SessionFactory;
  /** Makes the session factory once the app's services exist (the real session needs the store and the words). */
  makeSessionFactory?: (s: AppServices) => SessionFactory;
  plans?: PlansConfig;
  /** Friends, lobbies and rooms: the social client and the live client behind the ports. Off (null) until the social server exists. */
  social?: SocialServices | null;
  /** The player pressed something that starts a round: the place to unlock the sound. */
  onPlayGesture?: () => void;
  /** Called when a round's page goes away, so the session factory can give back what it holds. */
  onRoundEnded?: () => void;
}

const PIP_ORDER = ['bottom-right', 'bottom-left', 'top-left', 'top-right', 'hidden'] as const;

/** The language a visitor gets when the address has no language and they never chose one: only complete translations. */
export function autoLang(preferred: readonly string[] | undefined): Lang {
  const l = detectLang(preferred);
  return INDEXED_LANGS.includes(l) ? l : 'en';
}

export class App {
  private readonly o: AppOptions;
  private readonly win: Window & typeof globalThis;
  private readonly doc: Document;
  private readonly host: HTMLElement;
  private readonly store: BodyArcadeStore;
  private readonly shell: StoreNamespace;
  private readonly settings: SettingsStore;
  private readonly entitlements: EntitlementsPort;
  private readonly live: LiveRegion;
  private readonly toaster: Toaster;
  private readonly games: readonly ShellGame[];
  private readonly assets: AssetResolver;
  private readonly plans: PlansConfig;
  private readonly factory: SessionFactory | undefined;
  private nav!: Navigation<RouteId>;
  private caps: UiCapabilities;
  private lang: Lang = 'en';
  private route: Matched<RouteId> | null = null;
  private state: PageState = { ...EMPTY_STATE };
  private bests: Bests;
  private history: RoundRecord[];
  private play: PlayController | null = null;
  private readonly social: SocialController | null;
  private plan: Plan;
  private capsTimer: ReturnType<typeof setTimeout> | null = null;
  /** The choices on each game's page, kept while the app is open. */
  private readonly setups = new Map<string, SetupState>();
  /** How many times the player moved inside the app: a close button goes back only when there is a back. */
  private moves = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor(o: AppOptions) {
    this.o = o;
    this.win = o.win;
    this.doc = o.win.document;
    this.host = this.doc.getElementById('app') as HTMLElement;
    this.games = o.catalogue.games;
    this.store = createStore({ ...(o.storage !== undefined ? { storage: o.storage } : {}) });
    this.shell = this.store.ns('shell');
    const first = !this.shell.has('settings');
    this.settings = createSettingsStore(this.shell);
    this.caps = detectUiCapabilities(this.win);
    if (first && this.caps.tv) this.settings.set({ bigText: true });
    this.entitlements = o.entitlements ?? localEntitlements({
      demo: o.demo,
      initial: this.shell.get('plan', { version: 1, parse: (r) => (r === 'pro' || r === 'family' || r === 'lifetime' || r === 'free' ? r : null) }, 'free' as Plan),
      save: (p) => this.shell.set('plan', p),
    });
    this.plan = this.entitlements.plan();
    this.plans = o.plans ?? STUB_PLANS;
    const map = readAssetMap(this.doc);
    this.assets = Object.keys(map).length > 0 ? mappedAssets(map) : devAssets;
    this.bests = this.shell.get('bests', BESTS_SCHEMA, {});
    this.history = this.shell.get('history', HISTORY_SCHEMA, []);
    this.live = createLiveRegion(this.doc as never);
    this.toaster = createToaster(this.doc as never, this.live);
    this.social = o.social ? new SocialController(this.socialHost(), o.social) : null;
    this.factory = o.sessionFactory ?? o.makeSessionFactory?.({
      store: this.store, i18n: () => this.ctx().i18n, reducedMotion: () => this.reducedMotion(), soundOn: () => this.currentSettings().sound, quiet: () => this.currentSettings().quiet,
    });
  }

  // ---- context -----------------------------------------------------------------------------------------------------

  private currentSettings(): Readonly<Settings> { return this.settings.get(); }

  private context(url: string, lang: Lang = this.lang): ViewContext {
    return makeContext({
      lang, games: this.games, url, settings: this.currentSettings(), caps: this.caps, plan: this.plan, plans: this.plans, assets: this.assets,
      flags: { social: !!this.social }, version: this.o.version, server: false,
    });
  }

  private ctx(): ViewContext { return this.context(this.urlNow()); }

  private urlNow(): string { return `${this.win.location.pathname}${this.win.location.search}`; }

  private reducedMotion(): boolean {
    const m = this.currentSettings().motion;
    return m === 'reduce' || (m === 'system' && !!this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  private apply(): void {
    const s = this.currentSettings();
    const info = LANG_INFO.find((l) => l.code === this.lang);
    applySettingsToDocument(this.doc, s, this.lang, info?.tag ?? this.lang, this.reducedMotion());
  }

  // ---- start -------------------------------------------------------------------------------------------------------

  start(): void {
    this.nav = createNavigation<RouteId>({ win: this.win as never, router, onRoute: (c) => this.onRoute(c), onError: (e) => console.error(e) });
    this.on(this.doc, 'click', (e) => this.onClick(e as MouseEvent));
    this.on(this.doc, 'change', (e) => this.onChange(e));
    this.on(this.doc, 'input', (e) => this.onInput(e));
    this.on(this.doc, 'submit', (e) => this.onSubmit(e));
    this.on(this.win, 'offline', () => this.toaster.show(this.ctx().i18n.t('toast.offline'), { kind: 'warn' }));
    this.on(this.win, 'resize', () => this.onResize());
    this.on(this.win, 'orientationchange', () => this.onResize());
    this.cleanups.push(this.entitlements.onChange((p) => { this.plan = p; this.rerender(); }));
    this.cleanups.push(this.settings.subscribe(() => this.apply()));
    this.social?.start();
    this.apply();
    this.nav.start();
  }

  private on(target: EventTarget, type: string, cb: (e: Event) => void): void {
    target.addEventListener(type, cb);
    this.cleanups.push(() => target.removeEventListener(type, cb));
  }

  stop(): void {
    this.endPlay();
    this.social?.stop();
    this.nav.stop();
    for (const c of this.cleanups.splice(0)) c();
    this.live.dispose();
    this.toaster.dispose();
  }

  // ---- routes ------------------------------------------------------------------------------------------------------

  private preferredLang(): Lang {
    const l = this.currentSettings().lang;
    return l === 'auto' ? autoLang(this.win.navigator.languages) : l;
  }

  private async onRoute(change: RouteChange<RouteId>): Promise<void> {
    const route = change.route;
    // An address without a language prefix is English; a visitor who prefers another complete language is moved to it
    // once, on arrival, and a language in the address always wins.
    if (change.initial && (!route || route.lang === 'en')) {
      const want = this.preferredLang();
      if (want !== 'en' && INDEXED_LANGS.includes(want)) {
        this.nav.go(router.withLang(this.urlNow(), want), { replace: true });
        return;
      }
    }
    if (!change.initial && !change.replaced) this.moves += 1;
    this.endPlay();
    this.route = route;
    this.lang = route && route.lang !== 'en' ? route.lang : (route ? 'en' : this.lang);
    this.social?.enter(route);
    this.apply();
    this.render();
    if (!change.initial) this.live.announce(this.doc.title);
    if (route?.id === 'results') this.afterResults();
  }

  private bestAnyLevel(gameId: string): number | null {
    const by = this.bests[gameId];
    if (!by) return null;
    const v = Object.values(by);
    return v.length ? Math.max(...v) : null;
  }

  /** What the home page knows about this player's weeks. */
  private homeData(route: Matched<RouteId> | null): HomeData {
    const today = this.store.day();
    const week = this.history.length > 0 ? weekStats(this.history, today) : null;
    return {
      week,
      recent: week ? recentBests(this.history, (g) => this.bestAnyLevel(g)) : [],
      duoOnly: this.caps.local2 && route?.query.get('players') === '2',
    };
  }

  private gameData(g: ShellGame, ctx: ViewContext): GameData {
    return { best: this.bestAnyLevel(g.id), setup: this.setupFor(g, ctx) };
  }

  private setupFor(g: ShellGame, ctx: ViewContext): SetupState {
    const s = this.setups.get(g.id) ?? defaultSetup(ctx, g);
    return sanitizeSetup(ctx, g, s);
  }

  private render(): void {
    const route = this.route;
    this.endPlay();
    const ctx = this.ctx();
    if (route?.id === 'pro') {
      const gameId = route.query.get('game') ?? undefined;
      if (!this.state.paywall || this.state.paywall.gameId !== gameId) this.state = { ...this.state, paywall: defaultPaywallState(ctx, gameId) };
    }
    const game = route?.id === 'game' ? gameBySlug(this.games, route.params['slug'] ?? '') : undefined;
    const state: PageState = {
      ...this.state,
      reducedMotion: this.reducedMotion(),
      home: this.homeData(route),
      game: game ? this.gameData(game, ctx) : this.state.game,
      social: this.social && route && SOCIAL_ROUTES.has(route.id) ? this.social.pageState(route) : null,
    };
    const page = renderPage(ctx, route, state);
    swap(this.host, page.body.value);
    const info = LANG_INFO.find((l) => l.code === this.lang);
    applyHead(this.doc, page, { tag: info?.tag ?? this.lang, canonicalHref: route ? `${SITE_ORIGIN}${this.win.location.pathname}` : null });
    if (route?.id === 'play' && page.status === 200) this.beginPlay(route);
  }

  /** Redraws the page after something changed (the plan, the language of the page, the device). */
  private rerender(): void { if (this.route && this.route.id !== 'play') this.render(); }

  private onResize(): void {
    if (this.capsTimer) clearTimeout(this.capsTimer);
    this.capsTimer = setTimeout(() => {
      const next = detectUiCapabilities(this.win);
      const changed = next.local2 !== this.caps.local2 || next.deviceClass !== this.caps.deviceClass || next.landscape !== this.caps.landscape;
      this.caps = next;
      if (changed) this.rerender();
    }, 150);
  }

  // ---- playing -----------------------------------------------------------------------------------------------------

  private beginPlay(route: Matched<RouteId>): void {
    const g = gameBySlug(this.games, route.params['slug'] ?? '');
    const stage = this.doc.querySelector<HTMLElement>('[data-stage]');
    if (!g || !stage) return;
    const ctx = this.ctx();
    const setup = setupFromQuery(ctx, g, route.query);
    // A Pro game without Pro and without a free round left goes to the offer, not to a round that cannot count.
    if (accessOf(ctx, g) === 'locked') {
      this.nav.go(ctx.href('pro', { query: { game: g.id } }), { replace: true });
      return;
    }
    const factory = this.factory;
    this.play = new PlayController({
      host: this.playHost(g), game: g, setup, stage,
      makeSession: (handles, s): Session | null => factory?.({ game: g, setup: s, stage: handles }) ?? null,
      ...(this.o.onRoundEnded ? { release: this.o.onRoundEnded } : {}),
    });
    void this.play.begin();
  }

  private endPlay(): void {
    if (!this.play) return;
    this.play.dispose();
    this.play = null;
  }

  private playHost(g: ShellGame): PlayHost {
    return {
      document: this.doc,
      context: () => this.ctx(),
      announce: (t, a) => this.live.announce(t, a),
      toast: (t) => this.toaster.show(t),
      confirmLeave: () => this.confirm({ title: this.ctx().i18n.t('leave.title'), body: this.ctx().i18n.t('leave.body'), confirm: this.ctx().i18n.t('leave.confirm'), cancel: this.ctx().i18n.t('leave.keep'), danger: true }),
      leave: () => this.nav.go(this.ctx().href('game', { params: { slug: g.seo.slug } }), { replace: true }),
      finish: (game, setup, summary) => this.finishRound(game, setup, summary),
      pipCorner: () => this.currentSettings().pipCorner,
      cyclePip: () => {
        const cur = this.currentSettings().pipCorner;
        const next = PIP_ORDER[(PIP_ORDER.indexOf(cur) + 1) % PIP_ORDER.length] ?? 'bottom-right';
        this.settings.set({ pipCorner: next });
        return next;
      },
      cameraExplained: () => this.shell.get('cameraExplained', { version: 1, parse: (r) => (typeof r === 'boolean' ? r : null) }, false),
      setCameraExplained: () => this.shell.set('cameraExplained', true),
      usedFreeRound: (game) => {
        if (!game.free && !hasPro(this.ctx()) && !this.currentSettings().playedOnce.includes(game.id)) {
          this.settings.set({ playedOnce: [...this.currentSettings().playedOnce, game.id] });
        }
      },
      setupChanged: (s) => {
        const c = this.ctx();
        this.setups.set(g.id, s);
        this.win.history.replaceState(this.win.history.state, '', playHref(c, g, s));
      },
    };
  }

  // ---- friends and rooms --------------------------------------------------------------------------------------------

  private socialHost(): SocialHost {
    return {
      document: this.doc,
      context: () => this.ctx(),
      go: (href, o) => this.nav.go(href, o),
      toast: (text, kind) => this.toaster.show(text, kind ? { kind } : {}),
      announce: (text) => this.live.announce(text),
      rerender: () => this.rerender(),
      share: (text, o) => this.shareText(text, o),
    };
  }

  /** A link goes to the system share sheet on a touch device that has one; everything else is copied. */
  private async shareText(text: string, o: { link: boolean }): Promise<boolean> {
    const nav = this.win.navigator;
    if (o.link && this.caps.touch && typeof nav.share === 'function') {
      try { await nav.share({ url: text }); return true; } catch (e) { if ((e as { name?: string }).name === 'AbortError') return false; }
    }
    try { await nav.clipboard.writeText(text); return true; } catch { /* no clipboard permission: the older way below */ }
    try {
      const box = this.doc.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.className = 'ba-visually-hidden';
      this.doc.body.append(box);
      box.select();
      const ok = this.doc.execCommand('copy');
      box.remove();
      return ok;
    } catch { return false; }
  }

  private rounds(): number { return this.shell.get('rounds', { version: 1, parse: (r) => (typeof r === 'number' && r >= 0 ? r : null) }, 0); }

  private finishRound(game: ShellGame, setup: SetupState, summary: Parameters<PlayHost['finish']>[2]): void {
    const ctx = this.ctx();
    const previous = bestOf(this.bests, game.id, setup.difficulty);
    const result = buildRoundResult({ game, setup, summary, weightKg: this.currentSettings().weightKg, i18n: ctx.i18n, previousBest: previous });
    if (setup.players === 1) {
      this.bests = withBest(this.bests, game.id, setup.difficulty, summary.score);
      this.shell.set('bests', this.bests);
    }
    const now = Date.now();
    this.history = addRound(this.history, { day: this.store.day(), game: game.id, score: summary.score, seconds: Math.round(summary.seconds), at: now });
    this.shell.set('history', this.history);
    this.state = { ...this.state, result };
    this.shell.set('rounds', this.rounds() + 1);
    this.nav.go(ctx.href('results'), { replace: true });
  }

  /** After the first good round (and then at most every three quiet days) the offer opens once, never mid-play. */
  private afterResults(): void {
    const r = this.state.result;
    if (!r) return;
    const s = this.currentSettings();
    const show = shouldShowPaywallAfterRound({
      now: Date.now(), entitlementPlan: this.plan, child: false, lastShownAt: s.paywallShownAt, priorRounds: Math.max(0, this.rounds() - 1),
      round: { activeSeconds: r.seconds, completed: true, live: false },
      good: r.personalBest || (r.quality ?? 0) >= 0.8,
    });
    if (!show) return;
    this.settings.set({ paywallShownAt: Date.now() });
    setTimeout(() => { if (this.route?.id === 'results') this.nav.go(this.ctx().href('pro', { query: { from: 'results' } })); }, 900);
  }

  private confirm(o: ConfirmOptions): Promise<boolean> {
    const d = openDialog({ html: confirmHtml(o), labelledBy: 'confirm-title', describedBy: 'confirm-body' });
    return d.closed.then((r) => r === 'yes');
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset['action'] ?? '';
    if (this.play?.action(action)) { e.preventDefault(); return; }
    if (this.social?.click(action, el)) { e.preventDefault(); return; }
    switch (action) {
      case 'mode':
        this.toggleMode(el.dataset['mode'] ?? '');
        break;
      case 'close-paywall':
        e.preventDefault();
        if (this.moves > 0) this.win.history.back();
        else this.nav.go(this.ctx().href('home'), { replace: true });
        break;
      case 'lang': {
        const l = el.dataset['lang'];
        if (l && isLang(l)) { e.preventDefault(); this.chooseLang(l); }
        break;
      }
      case 'clear-data':
        e.preventDefault();
        void this.clearData();
        break;
      case 'buy':
        e.preventDefault();
        this.buy(el.dataset['plan'] ?? '');
        break;
      case 'activate-key':
        e.preventDefault();
        void this.activateKey();
        break;
      case 'restore':
        e.preventDefault();
        void this.restore();
        break;
      default:
        break;
    }
  }

  /** The chips on the home page: seated and quiet are the player's modes (kept), two players only filters the grid. */
  private toggleMode(mode: string): void {
    if (mode === 'seated') this.settings.set({ seated: !this.currentSettings().seated });
    else if (mode === 'quiet') this.settings.set({ quiet: !this.currentSettings().quiet });
    else if (mode === 'duo') {
      const u = new URL(this.win.location.href);
      if (u.searchParams.get('players') === '2') u.searchParams.delete('players'); else u.searchParams.set('players', '2');
      this.win.history.replaceState(this.win.history.state, '', `${u.pathname}${u.search}`);
      this.route = router.match(this.urlNow());
    } else return;
    this.render();
    const chip = this.doc.querySelector<HTMLElement>(`[data-action="mode"][data-mode="${CSS.escape(mode)}"]`);
    chip?.focus({ preventScroll: true });
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement | null;
    if (!t) return;
    if (this.social?.change(t)) return;
    if (t.closest('[data-form="settings"]')) this.onSettingChanged(t);
    else if (t.closest('[data-form="setup"]')) this.onSetupChanged(t.closest('form') as HTMLFormElement);
    else if (t.closest('[data-form="paywall"]') && (t as HTMLInputElement).name === 'plan') this.setPaywall({ selected: t.value as PaywallState['selected'] });
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement | null;
    if (t && this.social?.input(t)) return;
    if (t?.name === 'weightKg' && t.closest('[data-form="settings"]')) this.onSettingChanged(t);
  }

  private onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement | null;
    if (!form) return;
    if (form.matches('[data-form="friend-add"], [data-form="room-say"], [data-form="lobby"]')) { e.preventDefault(); this.social?.submit(form); }
    else if (form.matches('[data-form="setup"]')) { e.preventDefault(); this.startRound(form); }
    else if (form.matches('[data-form="settings"], [data-form="paywall"]')) e.preventDefault();
  }

  private gameOfForm(form: HTMLFormElement): ShellGame | undefined {
    return gameById(this.games, form.dataset['game'] ?? '');
  }

  /** A choice on the game's page: the fields are drawn again from the new state; a Pro choice goes to the offer instead. */
  private onSetupChanged(form: HTMLFormElement): void {
    const g = this.gameOfForm(form);
    if (!g) return;
    const ctx = this.ctx();
    const prev = this.setupFor(g, ctx);
    const wanted = setupFromForm(ctx, g, new FormData(form), prev);
    const locked = PRO_DIFFICULTIES.includes(wanted.difficulty) && !hasPro(ctx);
    const next = locked ? prev : sanitizeSetup(ctx, g, wanted);
    this.setups.set(g.id, next);
    const fields = form.querySelector<HTMLElement>('[data-setup-fields]');
    if (fields) {
      const open = fields.querySelector<HTMLDetailsElement>('details.k-more')?.open ?? false;
      swap(fields, setupFields(ctx, g, next).value);
      if (open) { const d = fields.querySelector<HTMLDetailsElement>('details.k-more'); if (d) d.open = true; }
    }
    if (locked) this.nav.go(ctx.href('pro', { query: { game: g.id } }));
  }

  private startRound(form: HTMLFormElement): void {
    const g = this.gameOfForm(form);
    if (!g) return;
    const ctx = this.ctx();
    const next = sanitizeSetup(ctx, g, setupFromForm(ctx, g, new FormData(form), this.setupFor(g, ctx)));
    this.setups.set(g.id, next);
    this.o.onPlayGesture?.();
    this.nav.go(playHref(ctx, g, next));
  }

  private onSettingChanged(t: HTMLInputElement | HTMLSelectElement): void {
    const s = this.settings;
    const ctx = this.ctx();
    const checked = (t as HTMLInputElement).checked;
    switch (t.name) {
      case 'seated': s.set({ seated: checked }); break;
      case 'quiet': s.set({ quiet: checked }); break;
      case 'skeleton': s.set({ skeleton: checked }); break;
      case 'sound': s.set({ sound: checked }); break;
      case 'bigText': s.set({ bigText: checked }); break;
      case 'motion': s.set({ motion: checked ? 'reduce' : 'full' }); break;
      case 'theme': s.set({ theme: t.value as Settings['theme'] }); break;
      case 'pipCorner': s.set({ pipCorner: t.value as Settings['pipCorner'] }); break;
      case 'weightKg': {
        const v = t.value.trim() === '' ? null : Number.parseFloat(t.value.replace(',', '.'));
        if (v === null || (Number.isFinite(v) && v >= 25 && v <= 300)) s.set({ weightKg: v });
        return;
      }
      case 'lang': {
        s.set({ lang: t.value as Settings['lang'] });
        const target: Lang = t.value === 'auto' ? autoLang(this.win.navigator.languages) : (t.value as Lang);
        this.nav.go(router.withLang(this.urlNow(), target), { replace: true });
        return;
      }
      default: return;
    }
    this.live.announce(ctx.i18n.t('settings.saved'));
  }

  private chooseLang(l: Lang): void {
    this.settings.set({ lang: l });
    this.nav.go(router.withLang(this.urlNow(), l), { replace: true });
  }

  private async clearData(): Promise<void> {
    const t = this.ctx().i18n;
    const yes = await this.confirm({ title: t.t('settings.data.confirm.title'), body: t.t('settings.data.confirm.body'), confirm: t.t('settings.data.confirm.yes'), cancel: t.t('common.cancel'), danger: true });
    if (!yes) return;
    const plan = this.plan;
    this.store.clearAll();
    this.settings.reset();
    this.shell.set('plan', plan);
    this.bests = {};
    this.history = [];
    this.setups.clear();
    this.state = { ...EMPTY_STATE };
    this.apply();
    this.rerender();
    this.toaster.show(this.ctx().i18n.t('settings.data.cleared'));
  }

  // ---- buying ------------------------------------------------------------------------------------------------------

  /** Updates the offer's state and draws it again where it is shown. */
  private setPaywall(patch: Partial<PaywallState>): void {
    const ctx = this.ctx();
    const st: PaywallState = { ...(this.state.paywall ?? defaultPaywallState(ctx)), ...patch };
    this.state = { ...this.state, paywall: st };
    if (this.route?.id === 'pro') this.render();
  }

  private buy(planId: string): void {
    const ctx = this.ctx();
    const offer = selectedOffer(ctx, planId as PaywallState['selected']);
    if (!offer) return;
    if (ctx.caps.platform === 'android-app') {
      const id = offer.checkout.play;
      if (id && this.entitlements.purchase) { void this.entitlements.purchase(id); return; }
    } else if (offer.checkout.web) {
      this.win.open(offer.checkout.web, '_blank', 'noopener,noreferrer');
      return;
    }
    this.toaster.show(ctx.i18n.t('paywall.unavailable'), { kind: 'warn' });
  }

  private async activateKey(): Promise<void> {
    const input = this.doc.querySelector<HTMLInputElement>('#pw-key');
    const key = input?.value ?? '';
    this.setPaywall({ keyOpen: true, keyStatus: 'busy' as KeyStatus });
    const r = await this.entitlements.activate(key);
    if (r.ok) {
      this.plan = r.plan;
      this.setPaywall({ keyStatus: 'ok' });
      this.live.announce(this.ctx().i18n.t('paywall.key.ok'));
    } else this.setPaywall({ keyOpen: true, keyStatus: r.code });
  }

  private async restore(): Promise<void> {
    const ok = (await this.entitlements.restore?.()) ?? false;
    const t = this.ctx().i18n;
    this.toaster.show(ok ? t.t('paywall.active') : t.t('paywall.unavailable'), ok ? {} : { kind: 'warn' });
  }

  /** For tests and tools: where the app is and what it holds. Development and test builds only. */
  debug(): { route: Matched<RouteId> | null; lang: Lang; plan: Plan; titleOf: (id: string) => string; result: RoundResult | null; playProblems: string[]; moves: number } {
    return {
      route: this.route, lang: this.lang, plan: this.plan, result: this.state.result, playProblems: this.play?.problems() ?? [], moves: this.moves,
      titleOf: (id) => { const g = gameById(this.games, id); return g ? titleOf(this.ctx(), g) : ''; },
    };
  }

  /** For tests: sets the plan the way a completed purchase would. */
  setPlanForTest(p: Plan): void {
    if (!this.o.demo) return;
    (this.entitlements as ReturnType<typeof localEntitlements>).set?.(p);
  }
}
