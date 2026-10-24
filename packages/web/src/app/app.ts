// The browser app: it owns the settings, the language, the plan and the router, draws the page for each address with
// the same views the page generator uses, and handles what the player does (clicks, forms, the round).
import type { Plan, Session } from '../../../core/types/index.ts';
import { detectUiCapabilities, type UiCapabilities } from '../../../core/ui/capabilities.ts';
import { openDialog } from '../../../core/ui/dialog.ts';
import { detectLang, isLang, LANG_INFO, type I18n, type Lang } from '../../../core/ui/i18n/index.ts';
import { createLiveRegion, type LiveRegion } from '../../../core/ui/live-region.ts';
import { createNavigation, type Matched, type Navigation, type RouteChange } from '../../../core/ui/router.ts';
import { shouldShowPaywallAfterRound } from '../../../core/ui/plans.ts';
import { applySettingsToDocument, createSettingsStore, type Settings, type SettingsStore } from '../../../core/ui/settings.ts';
import { createToaster, type Toaster } from '../../../core/ui/toast.ts';
import { createStore, type BodyArcadeStore, type StorageLike, type StoreNamespace } from '../../../core/store/store.ts';
import type { ProfileBook, ProfileDefaults, ProfileRules, ProfileSpace } from '../../../core/store/index.ts';
import type { Arcade, PlanStepReport, RunReport } from '../../../core/store/arcade.ts';
import type { AchievementDef } from '../../../core/store/achievements.ts';
import type { ChallengeResult } from '../../../core/store/daily-challenge.ts';
import type { HabitView } from '../../../core/store/habit.ts';
import { browserStorage } from '../../../core/store/store.ts';
import type { SyncPort } from '../../../core/store/sync-docs.ts';
import type { PlanProgress, PlanRunView, WorkoutPlan } from '../../../core/store/workout-plans.ts';
import { localized } from '../../../core/ui/i18n/localized.ts';
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
import { NO_HOME_DATA } from '../views/home.ts';
import { NO_PLANS_DATA, stepHref, type PlanPanel } from '../views/plans.ts';
import type { RoundProgress, RoundResult } from '../views/results.ts';
import { PRO_DIFFICULTIES, defaultSetup, playHref, sanitizeSetup, setupFields, setupFromForm, setupFromQuery, type SetupState } from '../views/setup.ts';
import { applyHead, readAssetMap, swap } from './dom.ts';
import { localEntitlements } from './entitlements.ts';
import { hasPlayed, makeArcade, recentBests, runInputOf, secondsByDay, weekStats } from './arcade.ts';
import { PlayController, type PlayHost } from './play.ts';
import { WelcomeController, type WelcomeHost } from './welcome.ts';
import { askParentGate, ProfilesController, type ProfilesHost } from './profiles.ts';
import { factsOf, OPEN_RULES, type PlayerFacts } from './profiles-model.ts';
import { firstDifficulty, FIRST_GAME_ID, FIRST_SECONDS, isAutomated, stepFrom, takeToTour, type TourState, type TourStep } from './welcome-model.ts';
import type { BillingPort, EntitlementsPort, SessionFactory } from './ports.ts';
import { SocialController, SOCIAL_ROUTES, type SocialHost } from './social.ts';
import type { SocialServices } from '../social/port.ts';
import { buildRoundResult, caloriesFor } from './results.ts';

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
  /** The page's own store, when there are no players (tests that build the app by hand); with `profiles` every record is the active player's. */
  store?: BodyArcadeStore;
  /** The players of this device and what each may do (core/store/profiles.ts). */
  profiles?: ProfileBook;
  /** The Family plan is sold: the players screen may offer to add players to a device that has none to add yet. */
  family?: boolean;
  entitlements?: EntitlementsPort;
  /** The offers, what the paywall may say where the page runs, and the free trial: from core/entitlements (billing.ts). */
  billing: BillingPort;
  sessionFactory?: SessionFactory;
  /** Makes the session factory once the app's services exist (the real session needs the store and the words). */
  makeSessionFactory?: (s: AppServices) => SessionFactory;
  /**
   * The social client as the arcade's document sync wants it (its loadSync and updateSync), once there is a profile; null before.
   * Whoever wires the real social client (builder UX, in boot.ts) hands it over here: the streak, the daily challenge and the plans
   * then follow the player to a second device.
   */
  syncPort?: () => SyncPort | null;
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
  private store: BodyArcadeStore;
  private shell: StoreNamespace;
  private settings: SettingsStore;
  private offSettings: (() => void) | null = null;
  /** The players of this device, and the one that is playing. */
  private readonly book: ProfileBook | null;
  private space: ProfileSpace | null;
  private readonly profiles: ProfilesController | null;
  private entitlements: EntitlementsPort;
  private billing: BillingPort;
  private offEntitlements: (() => void) | null = null;
  /** The notice of a free trial was closed for this visit: the next open shows it again. */
  private trialDismissed = false;
  private trialLoading = false;
  private readonly live: LiveRegion;
  private readonly toaster: Toaster;
  private readonly games: readonly ShellGame[];
  private readonly assets: AssetResolver;
  private readonly factory: SessionFactory | undefined;
  private nav!: Navigation<RouteId>;
  private caps: UiCapabilities;
  private lang: Lang = 'en';
  private route: Matched<RouteId> | null = null;
  private state: PageState = { ...EMPTY_STATE };
  /** Everything the player does, kept as facts: runs and bests, the habit, the challenge of the day, the workout plans. */
  private arcade: Arcade;
  /** The round that is on the stage is a game of the workout plan that is going. */
  private planRound = false;
  private restTimer: ReturnType<typeof setInterval> | null = null;
  private play: PlayController | null = null;
  /** The welcome tour that is on the screen. */
  private tour: WelcomeController | null = null;
  /** The round on the stage is the first game of the welcome tour. */
  private firstRound = false;
  /** Back during a round: the page goes forward again and asks ('restoring'); a yes goes back for real ('leaving'). */
  private backGuard: 'idle' | 'restoring' | 'leaving' = 'idle';
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
    this.book = o.profiles ?? null;
    this.space = this.book ? this.book.open() : null;
    this.store = this.space?.store ?? o.store ?? createStore({ ...(o.storage !== undefined ? { storage: o.storage } : {}) });
    this.shell = this.store.ns('shell');
    const first = !this.shell.has('settings');
    this.settings = createSettingsStore(this.shell);
    this.caps = this.detectCaps();
    if (first && this.caps.tv) this.settings.set({ bigText: true });
    if (first && this.space) this.applyDefaults(this.space.profile.defaults);
    this.syncSeated(true);
    this.profiles = this.book ? new ProfilesController(this.profilesHost()) : null;
    this.entitlements = o.entitlements ?? localEntitlements({
      demo: o.demo,
      isFreeGame: (id) => this.games.find((g) => g.id === id)?.free === true,
      initial: this.shell.get('plan', { version: 1, parse: (r) => (r === 'pro' || r === 'family' || r === 'lifetime' || r === 'free' ? r : null) }, 'free' as Plan),
      save: (p) => this.shell.set('plan', p),
    });
    this.plan = this.entitlements.plan();
    this.billing = o.billing;
    const map = readAssetMap(this.doc);
    this.assets = Object.keys(map).length > 0 ? mappedAssets(map) : devAssets;
    this.arcade = this.buildArcade();
    this.live = createLiveRegion(this.doc as never);
    this.toaster = createToaster(this.doc as never, this.live);
    this.social = o.social ? new SocialController(this.socialHost(), o.social) : null;
    // The games keep their own records in the store of whoever plays: a getter, so a round after a change of player writes to the new one.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.factory = o.sessionFactory ?? o.makeSessionFactory?.({
      get store(): BodyArcadeStore { return self.store; },
      i18n: () => this.ctx().i18n, reducedMotion: () => this.reducedMotion(), soundOn: () => this.currentSettings().sound, quiet: () => this.currentSettings().quiet,
    });
  }

  // ---- the players ----------------------------------------------------------------------------------------------------

  /** The arcade of the player that is playing: their record, their rules, their sync (only the main player syncs). */
  private buildArcade(): Arcade {
    const arcade = this.space
      ? this.space.arcade({ games: () => this.games, paid: () => this.plan !== 'free', syncPort: () => this.o.syncPort?.() ?? null })
      : makeArcade({
        store: this.store, games: () => this.games, can: (f) => this.entitlements.can?.(f) ?? false, paid: () => this.plan !== 'free',
        seated: () => this.currentSettings().seated, syncPort: () => this.o.syncPort?.() ?? null,
      });
    // A player who comes back from the live site brings the runner's record, once (only the main player's record takes it).
    const legacy = browserStorage();
    if (legacy) { try { arcade.importLegacy(legacy); } catch { /* the record starts empty */ } }
    return arcade;
  }

  /** What the rules of whoever plays allow. A device without players (a test) allows everything. */
  private rules(): ProfileRules { return this.space?.rules ?? OPEN_RULES; }

  private playerFacts(): PlayerFacts | null {
    const book = this.book;
    if (!book) return null;
    const cap = book.capacity();
    return factsOf(book.active(), { players: book.list().filter((p) => p.state === 'ready').length, capacity: { max: cap.max, used: cap.used } });
  }

  /** A new player starts from the defaults of their kind (a child: quiet, gentle, no weight), once, when they have no settings yet. */
  private applyDefaults(d: ProfileDefaults): void {
    this.settings.set({ seated: d.seated, quiet: d.quiet ?? false, ...(d.level ? { level: d.level } : {}), ...(d.weightKg === null ? { weightKg: null } : {}) });
  }

  /**
   * Sitting is the profile's own setting (the book keeps the one copy; the arcade's plans read it): the settings follow it, except
   * the first time the one-player version's choice is carried over to the main player.
   */
  private syncSeated(initial: boolean): void {
    const book = this.book;
    if (!book) return;
    const p = book.active();
    const carry = initial && (book.migration.kind === 'single' || book.migration.kind === 'fresh') && this.currentSettings().seated && !p.seated;
    if (carry) book.update(p.id, { seated: true });
    else if (this.currentSettings().seated !== p.seated) this.settings.set({ seated: p.seated });
  }

  /** The tour keeps its answers: the seat goes to the profile (its one copy), the rest to the settings. */
  private saveSettings(patch: Partial<Settings>): void {
    const { seated, ...rest } = patch;
    this.settings.set(rest);
    if (seated !== undefined) this.saveSeated(seated);
  }

  /** The settings changed the player's seat: the profile says so too. */
  private saveSeated(on: boolean): void {
    this.settings.set({ seated: on });
    const book = this.book;
    if (book) book.update(book.active().id, { seated: on });
  }

  /** A different player plays now, or the one that plays was cleared: everything the app holds of the old record is let go and built again from the new. */
  private played(space: ProfileSpace): void {
    if (!this.book) return;
    const first = !space.store.ns('shell').has('settings');
    this.space = space;
    this.store = space.store;
    this.shell = this.store.ns('shell');
    this.offSettings?.();
    this.settings = createSettingsStore(this.shell);
    if (first) this.applyDefaults(space.profile.defaults);
    this.syncSeated(false);
    this.offSettings = this.settings.subscribe(() => this.apply());
    this.arcade = this.buildArcade();
    this.setups.clear();
    this.state = { ...EMPTY_STATE };
    this.trialDismissed = false;
    this.endTour();
    this.apply();
    this.profiles?.refresh();
  }

  private profilesHost(): ProfilesHost {
    const book = this.book as ProfileBook;
    return {
      document: this.doc,
      context: () => this.ctx(),
      book,
      played: (space) => { this.played(space); },
      updated: () => { this.syncSeated(false); this.rerender(); },
      go: (href, o) => this.nav.go(href, o ?? {}),
      toast: (text, kind) => { this.toaster.show(text, kind ? { kind } : {}); },
      announce: (text) => this.live.announce(text),
      confirm: (o) => this.confirm(o),
      redraw: () => { this.rerender(); },
      now: () => Date.now(),
    };
  }

  /** The book moved by itself (another tab, the plan ended): follow it. */
  private onBookChange(e: { active: string }): void {
    if (!this.book || !this.space) return;
    if (e.active !== this.space.id) this.played(this.book.open());
    this.profiles?.refresh();
    if (this.route && this.route.id !== 'play') this.render();
  }

  // ---- context -----------------------------------------------------------------------------------------------------

  /** What this device offers. A test can say a keyboard is there (a phone-sized window in a test browser has none worth using). */
  private detectCaps(): UiCapabilities {
    const hooks = this.o.demo ? this.win.__BA_TEST__ : undefined;
    return detectUiCapabilities(this.win, hooks?.keyboard !== undefined ? { keyboard: hooks.keyboard } : {});
  }

  private currentSettings(): Readonly<Settings> { return this.settings.get(); }

  private context(url: string, lang: Lang = this.lang): ViewContext {
    const pay = this.billing.paywall();
    return makeContext({
      lang, games: this.games, url, settings: this.currentSettings(), caps: this.caps, plan: this.plan, plans: pay.plans, paywall: pay.info,
      // The notice of a trial and its reminder are about buying: a child's screens say nothing of it unless a grown-up has opened them.
      trial: this.trialDismissed || this.rules().purchase !== 'open' ? null : this.billing.trial.notice(), assets: this.assets,
      player: this.playerFacts(),
      flags: { social: !!this.social && this.rules().online, family: this.o.family === true, socialChild: !!this.social && !this.rules().online }, version: this.o.version, server: false,
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
    this.on(this.doc, 'visibilitychange', () => { if (!this.doc.hidden) void this.arcade.sync.sync(); });
    void this.arcade.sync.sync();
    this.on(this.win, 'resize', () => this.onResize());
    this.on(this.win, 'orientationchange', () => this.onResize());
    this.watchEntitlements();
    this.offSettings = this.settings.subscribe(() => this.apply());
    if (this.book) this.cleanups.push(this.book.onChange((e) => this.onBookChange(e)));
    this.social?.start();
    this.apply();
    this.nav.start();
  }

  private watchEntitlements(): void {
    this.offEntitlements?.();
    this.offEntitlements = this.entitlements.onChange((p) => { this.plan = p; this.state = { ...this.state, paywall: null }; this.rerender(); });
  }

  /**
   * The real entitlements arrive after the page started (checking a licence kept from the old site can take a moment): the
   * page was drawn from what was kept on the device, and is drawn again with the answer.
   */
  attach(o: { entitlements?: EntitlementsPort; billing: BillingPort }): void {
    if (o.entitlements) this.entitlements = o.entitlements;
    this.billing = o.billing;
    this.plan = this.entitlements.plan();
    this.watchEntitlements();
    this.state = { ...this.state, paywall: null };
    this.rerender();
  }

  private on(target: EventTarget, type: string, cb: (e: Event) => void): void {
    target.addEventListener(type, cb);
    this.cleanups.push(() => target.removeEventListener(type, cb));
  }

  stop(): void {
    this.endPlay();
    this.endTour();
    this.social?.stop();
    this.nav.stop();
    for (const c of this.cleanups.splice(0)) c();
    this.offSettings?.();
    this.offEntitlements?.();
    this.stopRestTimer();
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
    // A device with two or more players asks who is playing when the app opens (and a child whose plan ended meets the gate first).
    if (change.initial && this.book && route && route.id !== 'profiles' && route.id !== 'play' && route.id !== 'welcome' && this.book.picker().ask) {
      this.nav.go(router.href('profiles', { lang: route.lang, query: { next: this.urlNow() } }), { replace: true });
      return;
    }
    // Whatever buys something is behind a grown-up for a child.
    if (route?.id === 'pro' && this.book && !this.book.canPurchase() && !(await askParentGate({ document: this.doc, context: () => this.ctx() }, this.book.gate))) {
      this.nav.go(router.href('home', { lang: route.lang }), { replace: true });
      return;
    }
    // A first visit to the home page is taken to the tour, once (a script or a crawler never is, so the page a search engine lists is the one it gets).
    if (route?.id === 'home' && this.firstVisit(change)) {
      this.nav.go(router.href('welcome', { lang: route.lang }), { replace: true });
      return;
    }
    // The tour moves between its pages without being drawn again: its 3D stage stays and the panel follows the address.
    if (route?.id === 'welcome' && this.tour && this.route?.id === 'welcome' && route.lang === this.lang) {
      this.route = route;
      if (!change.initial && !change.replaced) this.moves += 1;
      this.tour.show(stepFrom(route.query.get('step')));
      return;
    }
    if (this.backGuard === 'restoring') { this.backGuard = 'idle'; return; }        // back at the round after the Back button: nothing changed
    if (change.popped && this.play?.isLive() && route?.id !== 'play') {
      if (this.backGuard === 'leaving') this.backGuard = 'idle';
      else { this.askToLeave(); return; }
    }
    if (!change.initial && !change.replaced) this.moves += 1;
    this.endPlay();
    this.route = route;
    if (route?.id === 'profiles') this.profiles?.enter(route);
    this.lang = route && route.lang !== 'en' ? route.lang : (route ? 'en' : this.lang);
    this.social?.enter(route);
    this.apply();
    this.render();
    if (!change.initial) this.live.announce(this.doc.title);
    if (route?.id === 'results') this.afterResults();
  }

  private bestAnyLevel(gameId: string): number | null {
    const best = this.arcade.progress(gameId).best();
    return best > 0 ? best : null;
  }

  /** What the home page knows about this player: the week and its streaks, the challenge of the day, the plans. */
  private homeData(route: Matched<RouteId> | null): HomeData {
    const today = this.arcade.today();
    const played = hasPlayed(this.arcade, this.games);
    return {
      week: played ? weekStats(secondsByDay(this.arcade, this.games), today.day, today.habit) : null,
      recent: played ? recentBests(this.arcade, this.games) : [],
      duoOnly: this.caps.local2 && route?.query.get('players') === '2',
      challenge: today.challenge,
      plans: { cards: this.arcade.plans.list(), active: today.plan },
    };
  }

  private gameData(g: ShellGame, ctx: ViewContext): GameData {
    const today = this.arcade.challenge.today();
    return { best: this.bestAnyLevel(g.id), setup: this.setupFor(g, ctx), challenge: today.challenge?.game === g.id ? { done: today.done, bonus: today.bonus } : null, family: this.book ? this.book.family(g.id) : [] };
  }

  private setupFor(g: ShellGame, ctx: ViewContext): SetupState {
    const s = this.setups.get(g.id) ?? defaultSetup(ctx, g);
    return sanitizeSetup(ctx, g, s);
  }

  private render(): void {
    const route = this.route;
    this.endPlay();
    this.endTour();
    if (route?.id === 'welcome') this.tour = new WelcomeController(this.welcomeHost(), stepFrom(route.query.get('step')));
    const ctx = this.ctx();
    if (route?.id === 'pro') {
      const gameId = route.query.get('game') ?? undefined;
      if (!this.state.paywall || this.state.paywall.gameId !== gameId) this.state = { ...this.state, paywall: defaultPaywallState(ctx, gameId) };
      if (hasPro(ctx) && !this.state.paywall?.trial) void this.loadTrial();
    }
    const game = route?.id === 'game' ? gameBySlug(this.games, route.params['slug'] ?? '') : undefined;
    const state: PageState = {
      ...this.state,
      reducedMotion: this.reducedMotion(),
      home: route?.id === 'home' || route?.id === 'region' ? this.homeData(route) : NO_HOME_DATA,
      game: game ? this.gameData(game, ctx) : this.state.game,
      plans: route?.id === 'plans' ? { cards: this.arcade.plans.list(), active: this.arcade.plans.active() } : NO_PLANS_DATA,
      social: this.social && route && SOCIAL_ROUTES.has(route.id) ? this.social.pageState(route) : null,
      welcome: this.tour?.tour() ?? null,
      profiles: route?.id === 'profiles' && this.profiles ? this.profiles.state() : null,
    };
    const page = renderPage(ctx, route, state);
    swap(this.host, page.body.value);
    const info = LANG_INFO.find((l) => l.code === this.lang);
    applyHead(this.doc, page, { tag: info?.tag ?? this.lang, canonicalHref: route ? `${SITE_ORIGIN}${this.win.location.pathname}` : null });
    if (route?.id === 'play' && page.status === 200) this.beginPlay(route);
    if (route?.id === 'welcome') void this.tour?.begin();
    if (route?.id === 'results') this.startRestTimer();
  }

  // ---- the welcome tour -------------------------------------------------------------------------------------------------

  private tourHook(): 'static' | 'fallback' | 'first' | undefined { return this.o.demo ? this.win.__BA_TEST__?.tour : undefined; }

  /** The home page, the first time this device opens it: no tour seen, no round played, no script or crawler. */
  private firstVisit(change: RouteChange<RouteId>): boolean {
    const forced = this.tourHook() === 'first';
    return takeToTour({
      initial: change.initial, atHome: true, onboardingDone: this.currentSettings().onboardingDone, rounds: this.rounds(),
      automated: !forced && isAutomated({ userAgent: this.win.navigator.userAgent, webdriver: this.win.navigator.webdriver }),
    });
  }

  private endTour(): void {
    this.tour?.dispose();
    this.tour = null;
  }

  private welcomeHost(): WelcomeHost {
    return {
      document: this.doc,
      context: () => this.ctx(),
      settings: () => this.currentSettings(),
      saveSettings: (patch) => this.saveSettings(patch),
      stepHref: (step: TourStep) => this.ctx().href('welcome', step === 1 ? {} : { query: { step: String(step) } }),
      firstGameHref: (s: TourState) => this.firstGameHref(s),
      go: (href, o) => this.nav.go(href, o ?? {}),
      cameraExplained: () => this.shell.set('cameraExplained', true),
      announce: (text) => this.live.announce(text),
      reducedMotion: () => this.reducedMotion(),
      hook: () => this.tourHook(),
      homeHref: () => this.ctx().href('home'),
    };
  }

  /** The real first game: Squat Flap on the camera, played the way the tour was answered, for thirty seconds. */
  private firstGameHref(s: TourState): string {
    const ctx = this.ctx();
    const g = gameById(this.games, FIRST_GAME_ID) ?? this.games.find((x) => x.free) ?? this.games[0];
    if (!g) return ctx.href('home');
    const base = defaultSetup(ctx, g);
    this.o.onPlayGesture?.();
    return playHref(ctx, g, sanitizeSetup(ctx, g, { ...base, players: 1, input: 'camera', difficulty: firstDifficulty(s.level), seated: s.seated, quiet: s.quiet }), { first: 1 });
  }

  /** Redraws the page after something changed (the plan, the language of the page, the device). */
  private rerender(): void {
    if (this.route?.id === 'welcome') { this.tour?.refresh(); return; }
    if (this.route && this.route.id !== 'play') this.render();
  }

  private onResize(): void {
    if (this.capsTimer) clearTimeout(this.capsTimer);
    this.capsTimer = setTimeout(() => {
      const next = this.detectCaps();
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
    this.planRound = route.query.get('plan') === '1' && this.arcade.plans.active()?.current?.game === g.id;
    this.firstRound = route.query.get('first') === '1' && g.id === FIRST_GAME_ID;
    // A Pro game without Pro and without a free round left goes to the offer, not to a round that cannot count.
    if (accessOf(ctx, g) === 'locked') {
      this.nav.go(ctx.href('pro', { query: { game: g.id } }), { replace: true });
      return;
    }
    const factory = this.factory;
    this.play = new PlayController({
      host: this.playHost(g), game: g, setup, stage,
      makeSession: (handles, s): Session | null => factory?.({ game: g, setup: s, stage: handles, ...(this.firstRound ? { first: true } : {}) }) ?? null,
      ...(this.o.onRoundEnded ? { release: this.o.onRoundEnded } : {}),
      ...(this.firstRound ? { explained: true } : {}),
    });
    void this.play.begin();
  }

  /** The Back button during a round is a way out like any other: the round is held, the page returns to it and asks. */
  private askToLeave(): void {
    const t = this.ctx().i18n;
    this.backGuard = 'restoring';
    this.win.history.forward();
    this.play?.holdForLeave();
    void this.confirm({ title: t.t('leave.title'), body: t.t('leave.body'), confirm: t.t('leave.confirm'), cancel: t.t('leave.keep'), danger: true }).then((yes) => {
      if (!yes) return;
      this.backGuard = 'leaving';
      this.win.history.back();
    });
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
      deskChosen: () => {
        if (!this.currentSettings().seated) this.settings.set({ seated: true });
        this.toaster.show(this.ctx().i18n.t('calib.desk.on'));
      },
      home: () => this.nav.go(this.ctx().href('home'), { replace: true }),
      // The practice session runs faster in tests; the waits of the calibration screen follow it.
      now: () => this.win.performance.now() * (this.o.demo ? Math.max(1, this.win.__BA_TEST__?.timeScale ?? 1) : 1),
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

  /**
   * The round is over: it goes into the record (a plan's game moves the plan on), and the results screen is built from what the
   * record says happened. Two players on one camera add their minutes to the habit and set no personal record.
   */
  private finishRound(game: ShellGame, setup: SetupState, summary: Parameters<PlayHost['finish']>[2]): void {
    const ctx = this.ctx();
    // A child's profile has no weight and no calories.
    const weightKg = this.rules().calories ? this.currentSettings().weightKg : null;
    const first = this.firstRound;
    this.firstRound = false;
    const input = runInputOf({ game: first ? { durationSec: FIRST_SECONDS } : game, setup, summary, kcal: caloriesFor(summary.metSeconds, weightKg) });
    const solo = setup.players === 1;
    const before = this.arcade.plans.active();
    let report: RunReport | null = null;
    let step: PlanStepReport | null = null;
    let shared: { play: ReturnType<Arcade['habit']['addPlay']>; habit: HabitView } | null = null;
    if (!solo) {
      shared = { play: this.arcade.habit.addPlay(summary.seconds), habit: this.arcade.habit.view() };
    } else if (this.planRound && before?.current?.game === game.id) {
      step = this.arcade.finishPlanStep(input);
      report = step?.report ?? this.arcade.recordRun(game.id, input);
    } else report = this.arcade.recordRun(game.id, input);
    this.planRound = false;
    const previous = report?.outcome.saved && report.outcome.previousBest > 0 ? report.outcome.previousBest : null;
    const progress = this.progressOf(report ? { play: report.play, challenge: report.challenge, habit: report.habit, news: report.outcome.news } : { play: shared?.play ?? null, challenge: null, habit: shared?.habit ?? this.arcade.habit.view(), news: [] });
    const plan = step?.progress && before ? this.panelOf(step.progress, before.plan, before.total) : null;
    const result: RoundResult = { ...buildRoundResult({ game, setup, summary, weightKg, i18n: ctx.i18n, previousBest: previous }), progress, plan, ...(first ? { first: true } : {}) };
    this.state = { ...this.state, result };
    this.shell.set('rounds', this.rounds() + 1);
    void this.arcade.sync.sync();
    this.nav.go(ctx.href('results'), { replace: true });
  }

  /** What the round did to the record, as the results screen tells it: only what happened. */
  private progressOf(r: { play: ReturnType<Arcade['habit']['addPlay']> | null; challenge: ChallengeResult | null; habit: HabitView; news: readonly AchievementDef[] }): RoundProgress | null {
    const activeDay = r.play?.becameActive === true;
    const weekGoalReached = activeDay && r.habit.week.met && r.habit.week.days === r.habit.week.goal;
    const challengeDone = r.challenge?.justDone === true;
    const challengeBonus = r.challenge?.justBonus === true;
    const achievements = r.news.map((a) => localized(a.name, this.lang));
    if (!activeDay && !weekGoalReached && !challengeDone && !challengeBonus && achievements.length === 0) return null;
    return { activeDay, weekGoalReached, weekDays: r.habit.week.days, weekStreak: r.habit.weekStreak, challengeDone, challengeBonus, achievements };
  }

  /** Where the plan stands after a game of it: the next game with its address and rest, or how it ended. */
  private panelOf(p: PlanProgress, plan: WorkoutPlan, total: number): PlanPanel {
    const view: PlanRunView | null = p.view;
    const ctx = this.ctx();
    const step = view?.current ?? null;
    const href = step ? stepHref(ctx, step) : null;
    return {
      plan, over: p.over, done: p.done, played: p.played, skipped: p.skipped, total, minutes: Math.max(1, Math.round(p.seconds / 60)),
      next: !p.over && view && step && href ? { game: step.game, href, number: view.number, restSec: view.restSec } : null,
    };
  }

  /** The player starts a plan: its first game opens, played the way the plan asks (its level, seated or not). */
  private startPlan(id: string): void {
    const ctx = this.ctx();
    const r = this.arcade.plans.start(id);
    if (!r.ok) {
      if (r.code === 'locked') this.nav.go(ctx.href('pro'));
      else this.toaster.show(ctx.i18n.t('plans.noGames'), { kind: 'warn' });
      return;
    }
    const href = r.view.current ? stepHref(ctx, r.view.current) : null;
    if (!href) { this.arcade.plans.abandon(); this.toaster.show(ctx.i18n.t('plans.noGames'), { kind: 'warn' }); return; }
    this.o.onPlayGesture?.();
    this.nav.go(href);
  }

  /** The player leaves out the game that is next: the plan moves on, and the panel shows the one after it (or the end). */
  private skipPlanStep(): void {
    const prev = this.state.result?.plan;
    if (!prev || prev.over) return;
    const progress = this.arcade.plans.skipStep();
    if (this.state.result) this.state = { ...this.state, result: { ...this.state.result, plan: this.panelOf(progress, prev.plan, prev.total) } };
    this.rerender();
  }

  private leavePlan(): void {
    this.arcade.plans.abandon();
    if (this.state.result) this.state = { ...this.state, result: { ...this.state.result, plan: null } };
    this.toaster.show(this.ctx().i18n.t('plan.left'));
    this.rerender();
  }

  /** The rest between two games of a plan counts down on the results screen; it only says when it is over, the player starts the next game. */
  private startRestTimer(): void {
    this.stopRestTimer();
    const note = this.doc.querySelector<HTMLElement>('[data-plan-rest]');
    if (!note) return;
    let left = Number(note.dataset['planRest']);
    const text = note.querySelector<HTMLElement>('[data-plan-rest-text]');
    const count = note.querySelector<HTMLElement>('[data-plan-count]');
    if (!Number.isFinite(left) || left <= 0 || !text || !count) return;
    const t = this.ctx().i18n;
    count.textContent = String(left);
    this.restTimer = setInterval(() => {
      left -= 1;
      if (left > 0) { count.textContent = String(left); return; }
      this.stopRestTimer();
      count.hidden = true;
      text.textContent = t.t('plan.restOver');
    }, 1000);
  }

  private stopRestTimer(): void {
    if (this.restTimer) clearInterval(this.restTimer);
    this.restTimer = null;
  }

  /** After the first good round (and then at most every three quiet days) the offer opens once, never mid-play. */
  private afterResults(): void {
    const r = this.state.result;
    if (!r) return;
    const s = this.currentSettings();
    const show = shouldShowPaywallAfterRound({
      now: Date.now(), entitlementPlan: this.plan, child: !this.rules().autoPaywall, lastShownAt: s.paywallShownAt, priorRounds: Math.max(0, this.rounds() - 1),
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
    if (this.tour?.action(action, el)) { e.preventDefault(); return; }
    if (this.profiles?.action(action, el)) { e.preventDefault(); return; }
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
      case 'plan-start':
        e.preventDefault();
        this.startPlan(el.dataset['plan'] ?? '');
        break;
      case 'plan-skip':
        e.preventDefault();
        this.skipPlanStep();
        break;
      case 'plan-leave':
        e.preventDefault();
        this.leavePlan();
        break;
      case 'trial-dismiss':
        e.preventDefault();
        this.trialDismissed = true;
        this.rerender();
        break;
      case 'trial-email':
        e.preventDefault();
        void this.leaveEmail();
        break;
      case 'trial-clear':
        e.preventDefault();
        void this.takeEmailBack();
        break;
      default:
        break;
    }
  }

  /** The chips on the home page: seated and quiet are the player's modes (kept), two players only filters the grid. */
  private toggleMode(mode: string): void {
    if (mode === 'seated') this.saveSeated(!this.currentSettings().seated);
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
    if (t instanceof this.win.HTMLInputElement && t.name.startsWith('tour-') && this.tour?.change(t)) return;
    if (t instanceof this.win.HTMLInputElement && t.name === 'askOnStart' && this.profiles?.change(t)) return;
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
    else if (form.matches('[data-form="profile"]')) { e.preventDefault(); this.profiles?.submit(form); }
    else if (form.matches('[data-form="gate"]')) { /* the gate's own window answers it */ }
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
      case 'seated': this.saveSeated(checked); break;
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
    // With players the record that is cleared is the active player's (the main player's is cleared, any other's goes with the player), asked and gated by the book's own removal.
    if (this.profiles && this.book) { await this.profiles.remove(this.book.active().id); return; }
    const t = this.ctx().i18n;
    const yes = await this.confirm({ title: t.t('settings.data.confirm.title'), body: t.t('settings.data.confirm.body'), confirm: t.t('settings.data.confirm.yes'), cancel: t.t('common.cancel'), danger: true });
    if (!yes) return;
    const plan = this.plan;
    // The licence is the player's, not a setting: it stays, so Pro does too (the words of the question promise it).
    const kept: [string, string][] = [];
    try {
      const ls = this.win.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        const v = k?.startsWith('ba2.entitlements.') ? ls.getItem(k) : null;
        if (k && v !== null) kept.push([k, v]);
      }
    } catch { /* no storage to keep from */ }
    this.store.clearAll();
    try { for (const [k, v] of kept) this.win.localStorage.setItem(k, v); } catch { /* nothing to put back into */ }
    this.settings.reset();
    this.shell.set('plan', plan);
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

  /**
   * The buy button does what the page it is on can do: Google Play inside the Android app, the Gumroad page on the web. A
   * plan that has no real address is not on the page at all, so the only offers that cannot be bought are the made-up ones of a
   * preview build, and those say so.
   */
  private buy(planId: string): void {
    const ctx = this.ctx();
    const t = ctx.i18n;
    const offer = selectedOffer(ctx, planId as PaywallState['selected']);
    if (!offer) return;
    if (ctx.paywall.mode === 'play') {
      const id = offer.checkout.play;
      if (id && this.entitlements.purchase) {
        void this.entitlements.purchase(id).then((ok) => { if (!ok) this.toaster.show(t.t('paywall.notDone'), { kind: 'warn' }); });
        return;
      }
    } else if (ctx.paywall.preview) {
      this.toaster.show(t.t('paywall.preview'), { kind: 'warn' });
      return;
    } else if (offer.checkout.web) {
      this.win.open(offer.checkout.web, '_blank', 'noopener,noreferrer');
      return;
    }
    this.toaster.show(t.t('paywall.unavailable'), { kind: 'warn' });
  }

  // ---- the free trial -----------------------------------------------------------------------------------------------

  /** The page of Pro asks what the free trial of an active membership looks like: its end and the box for the one reminder e-mail. */
  private async loadTrial(): Promise<void> {
    if (this.trialLoading) return;
    this.trialLoading = true;
    try {
      const view = await this.billing.trial.view();
      this.setPaywall({ trial: view });
    } finally {
      this.trialLoading = false;
    }
  }

  private async leaveEmail(): Promise<void> {
    const email = this.doc.querySelector<HTMLInputElement>('#tr-email')?.value ?? '';
    this.setPaywall({ emailBusy: true, emailNote: null });
    const r = await this.billing.trial.setEmail(email, this.lang);
    if (r.ok) {
      const view = await this.billing.trial.view();
      this.setPaywall({ trial: view, emailBusy: false, emailNote: { kind: 'saved' } });
      this.live.announce(this.ctx().i18n.t('trial.email.saved'));
    } else this.setPaywall({ emailBusy: false, emailNote: { kind: 'error', code: r.code } });
  }

  private async takeEmailBack(): Promise<void> {
    this.setPaywall({ emailBusy: true, emailNote: null });
    const r = await this.billing.trial.clearEmail();
    if (r.ok) {
      const view = await this.billing.trial.view();
      this.setPaywall({ trial: view, emailBusy: false, emailNote: { kind: 'cleared' } });
      this.live.announce(this.ctx().i18n.t('trial.email.cleared'));
    } else this.setPaywall({ emailBusy: false, emailNote: { kind: 'error', code: r.code } });
  }

  private async activateKey(): Promise<void> {
    const input = this.doc.querySelector<HTMLInputElement>('#pw-key');
    const key = input?.value ?? '';
    this.setPaywall({ keyOpen: true, keyStatus: 'busy' as KeyStatus });
    const r = await this.entitlements.activate(key);
    if (r.ok) {
      this.plan = r.plan;
      this.setPaywall({ keyStatus: 'ok', trial: null });
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
