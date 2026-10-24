// Starts the app. A real round runs on the platform's session; in development and test builds the practice session
// stands in for any game that has no code yet (and for every game when a test asks for it). A published build has no
// practice session (the constant is false and the bundler drops it), so a game without code says it is not here yet.
//
// What may be bought comes from the entitlements (core/entitlements): a published build asks them where the page runs and
// draws only what can really be bought there; a development or test build has made-up offers marked as a preview. The first
// page does not wait long for the entitlements (a licence kept from the old site is checked on the way): it is drawn from
// what the device kept and drawn again when they answer.
import { bootEntitlements, type BootResult, type BootWindow } from '../../../core/entitlements/boot.ts';
import { createProfileBook, type ProfileBook } from '../../../core/store/index.ts';
import type { StorageLike } from '../../../core/store/store.ts';
import { createI18n } from '../../../core/ui/i18n/index.ts';
import type { Catalogue } from '../../catalogue/types.ts';
import { App, autoLang, type AppServices } from './app.ts';
import { localEntitlements } from './entitlements.ts';
import { loadPlayDetails, pendingBilling, practiceBilling, realBilling, withPreviewOffers } from './billing.ts';
import { createDemoSession } from './demo-session.ts';
import { createDemoSocial, type DemoSocialMode } from './demo-social.ts';
import type { BillingPort, EntitlementsPort, SessionFactory } from './ports.ts';
import { createRealSessionFactory, pageAudio, playableGameIds } from './session.ts';

export interface BootOptions {
  win: Window & typeof globalThis;
  catalogue: Catalogue;
  version: string;
  demo: boolean;
  /** A build made to look at the design before the Gumroad products exist: made-up offers where the real ones are missing. */
  placeholderPlans?: boolean;
  /** Replaces the choice of session (tests of the shell itself). */
  sessionFactory?: SessionFactory;
  /** Where the players of this device are kept, and the gate's questions (tests: memory, and a question whose answer is known). */
  profiles?: { storage?: StorageLike | null; random?: () => number };
}

/**
 * Family is sold once its six profiles are there to use: the screen of players (who is playing, add, edit, remove), the parent
 * gate, the rules of a child's profile in every screen, and the table of the family on a game's page, all tested on the ten sizes.
 * The entitlements keep the plan off the page until it is told (realBilling's `family`), so this is the one switch.
 */
export const FAMILY_ON = false;

/** How long the first page waits for the entitlements before it is drawn from what the device kept. */
export const ENTITLEMENTS_WAIT_MS = 600;

interface RealParts { port: EntitlementsPort; billing: BillingPort }

async function startEntitlements(o: BootOptions, book: ProfileBook, booted: (b: BootResult) => void): Promise<RealParts | null> {
  try {
    const boot = await bootEntitlements({
      // The device's part of the storage: what was bought and the list of players, nothing of any player's own record.
      store: book.device, window: o.win as unknown as BootWindow,
      // A game that is free for everyone, from the manifests: the entitlements' can('game:<id>') says yes to it for a free player.
      rules: { isFreeGame: (id) => o.catalogue.games.find((g) => g.id === id)?.free === true },
    });
    booted(boot);
    const details = await loadPlayDetails(boot.env);
    const real = realBilling(boot, { family: FAMILY_ON, details: () => details });
    return { port: { ...boot.port, can: (feature) => boot.service.can(feature) }, billing: o.placeholderPlans ? withPreviewOffers(real) : real };
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function boot(o: BootOptions): Promise<App> {
  const hooks = o.demo ? (o.win.__BA_TEST__ ?? {}) : {};
  const query = new URLSearchParams(o.win.location.search);
  const playable = new Set(playableGameIds());

  const makeSessionFactory = (s: AppServices): SessionFactory => {
    const real = createRealSessionFactory({
      store: (id) => s.store.ns(id), i18n: s.i18n, reducedMotion: s.reducedMotion, soundOn: s.soundOn,
    });
    return (r) => {
      if (o.demo && (hooks.forceDemo === true || !playable.has(r.game.id))) {
        return createDemoSession(r, { timeScale: hooks.timeScale ?? 1, ...(hooks.roundSeconds !== undefined ? { roundSeconds: hooks.roundSeconds } : {}), ...(hooks.desk ? { desk: true } : {}), document: o.win.document });
      }
      return playable.has(r.game.id) ? real(r) : null;
    };
  };

  // The friends side needs a server that does not exist yet: development and test builds can ask for the practice one
  // (`?social=1`, `?social=fresh` for a player with no profile, `?social=offline`); a published build has none.
  const socialParam = o.demo ? (hooks.social === true ? '1' : typeof hooks.social === 'string' ? hooks.social : query.get('social')) : null;
  const social = socialParam ? createDemoSocial({ mode: (socialParam === 'fresh' || socialParam === 'offline' ? socialParam : 'ready') as DemoSocialMode, origin: o.win.location.origin }) : null;

  // The players of this device, before anything else: every record the app keeps is the active player's, and what the plan allows
  // (how many players, whether one has the online identity) comes from the entitlements, which are read a moment later.
  let ent: BootResult | null = null;
  let practice: ReturnType<typeof localEntitlements> | null = null;
  const words = createI18n(autoLang(o.win.navigator.languages));
  const book = createProfileBook({
    can: (feature) => (ent ? ent.service.can(feature) : practice?.can?.(feature) ?? false),
    known: () => ent !== null || practice !== null,
    ownerName: words.t('profile.me'),
    recoveredName: (n) => words.t('profile.recovered', { n }),
    games: () => o.catalogue.games.map((g) => g.id),
    onProblem: (p) => console.warn(p),
    ...(o.profiles?.storage !== undefined ? { storage: o.profiles.storage } : {}),
    ...(o.profiles?.random ? { random: o.profiles.random } : {}),
  });
  const offTabs = ((): (() => void) => {
    const listen = (e: StorageEvent): void => { if (e.key === null || e.key === book.registryKey) book.refresh(); };
    o.win.addEventListener('storage', listen);
    return () => o.win.removeEventListener('storage', listen);
  })();
  o.win.addEventListener('pagehide', () => { offTabs(); book.dispose(); }, { once: true });

  let billing: BillingPort;
  let entitlements: EntitlementsPort | undefined;
  let later: Promise<RealParts | null> | null = null;
  const plan = o.demo ? (hooks.plan ?? query.get('plan')) : null;
  if (o.demo) {
    // Development and test builds keep the plan in memory (the page's own switch): the players follow it like the real ones follow the licence.
    practice = localEntitlements({ demo: true, initial: plan === 'pro' || plan === 'family' ? plan : 'free', isFreeGame: (id) => o.catalogue.games.find((g) => g.id === id)?.free === true });
    practice.onChange(() => book.refresh());
    entitlements = practice;
  }
  if (o.demo && hooks.billing) {
    billing = pendingBilling(hooks.billing);
  } else if (o.demo) {
    billing = practiceBilling({
      ...(hooks.trial ? { trial: { endsInMs: hooks.trial.endsInHours * 3_600_000, ...(hooks.trial.where ? { where: hooks.trial.where } : {}), ...(hooks.trial.cancelled ? { cancelled: true } : {}), ...(hooks.trial.email ? { email: hooks.trial.email } : {}) } } : {}),
    });
  } else {
    const started = startEntitlements(o, book, (b) => {
      ent = b;
      b.service.onChange(() => book.refresh());
      book.refresh();
    });
    const first = await Promise.race([started, new Promise<'late'>((resolve) => { setTimeout(() => resolve('late'), ENTITLEMENTS_WAIT_MS); })]);
    if (first === 'late') { billing = pendingBilling('checking'); later = started; }
    else if (first) { billing = first.billing; entitlements = first.port; }
    else billing = pendingBilling('unavailable');
  }

  const app = new App({
    win: o.win, catalogue: o.catalogue, version: o.version, demo: o.demo, profiles: book, family: FAMILY_ON, billing,
    ...(entitlements ? { entitlements } : {}),
    ...(o.sessionFactory ? { sessionFactory: o.sessionFactory } : { makeSessionFactory }),
    social,
    onPlayGesture: () => { try { pageAudio().unlock(); } catch { /* no Web Audio here: the round plays without sound */ } },
  });
  app.start();
  if (later) void later.then((r) => app.attach(r ? { entitlements: r.port, billing: r.billing } : { billing: pendingBilling('unavailable') }));
  if (o.demo) {
    o.win.__BA__ = app;
  }
  return app;
}
