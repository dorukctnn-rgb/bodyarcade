// Starts the app. A real round runs on the platform's session; in development and test builds the practice session
// stands in for any game that has no code yet (and for every game when a test asks for it). A published build has no
// practice session (the constant is false and the bundler drops it), so a game without code says it is not here yet.
//
// What may be bought comes from the entitlements (core/entitlements): a published build asks them where the page runs and
// draws only what can really be bought there; a development or test build has made-up offers marked as a preview. The first
// page does not wait long for the entitlements (a licence kept from the old site is checked on the way): it is drawn from
// what the device kept and drawn again when they answer.
import { bootEntitlements, type BootResult, type BootWindow } from '../../../core/entitlements/boot.ts';
import { createProfileBook, watchOnline, type ProfileBook } from '../../../core/store/index.ts';
import { createStore, type StorageLike } from '../../../core/store/store.ts';
import { createI18n } from '../../../core/ui/i18n/index.ts';
import type { Catalogue } from '../../catalogue/types.ts';
import { App, autoLang, type AppServices } from './app.ts';
import { localEntitlements } from './entitlements.ts';
import { loadPlayDetails, pendingBilling, practiceBilling, realBilling, withPreviewOffers } from './billing.ts';
import { createDemoSession } from './demo-session.ts';
import { isLinkEntry, startSocial } from '../social/services.ts';
import type { SocialServices } from '../social/port.ts';
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

// ---- the switches of launch day: each is one line, and each stays false until what it names is true --------------------------------

/**
 * LAUNCH DAY, switch 1 of 2: Family is sold once its six profiles are there to use: the screen of players (who is playing, add, edit,
 * remove), the parent gate, the rules of a child's profile in every screen, and the table of the family on a game's page, all tested on
 * the ten sizes. The entitlements keep the plan off the page until it is told (realBilling's `family`), so this is the one switch:
 * change `false` to `true` on this line and nothing else (no test pins it off; the release gate of content.test.ts, BA_RELEASE=1,
 * asks for `true`).
 */
export const FAMILY_ON = false;

/**
 * LAUNCH DAY, switch 2 of 2: the paywall says that rooms play the host's Pro games only once the Room verifies the host's signed Pro
 * before a Pro game starts (builder N; BUILD-PLAN, launch-day list, "Room claim"). Until that check is on v2 the line stays out of the
 * paywall. When it is, change `false` to `true` on this line.
 */
export const ROOM_PRO_ON = false;

/** How long the first page waits for the entitlements before it is drawn from what the device kept. */
export const ENTITLEMENTS_WAIT_MS = 600;

/** How long a friend link or a room link waits for the friends service before the page is drawn without it (the Friends tab then appears when it answers). */
export const SOCIAL_ENTRY_WAIT_MS = 5000;

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

  // The friends side: a development or test build can ask for the practice ports (`?social=1`, `?social=fresh` for a player with
  // no profile, `?social=offline`, and the other states of social/demo-social.ts); everywhere else the real services start in the
  // background and the Friends tab appears when the site's social service answers (see social/services.ts).
  const socialParam = o.demo ? (hooks.social === true ? '1' : typeof hooks.social === 'string' ? hooks.social : query.get('social')) : null;
  let social: SocialServices | null = null;
  if (socialParam) {
    const { createDemoSocial, DEMO_SOCIAL_MODES } = await import('./demo-social.ts');
    const mode = (DEMO_SOCIAL_MODES as readonly string[]).includes(socialParam) ? socialParam : 'ready';
    const quick = hooks.socialQuick ?? query.get('quick');
    social = createDemoSocial({ mode: mode as Parameters<typeof createDemoSocial>[0]['mode'], origin: o.win.location.origin, timeScale: hooks.timeScale ?? 1, ...(quick === 'never' || quick === 'lobby' ? { quick } : {}) });
  }

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

  // The friends services start in the background (the players above are what decides whether they are used): the owner of the
  // device is the only player with an online identity, and the few device facts of the services (the answer to the age question,
  // the players blocked in rooms) live in the owner's own namespace whoever is playing, so they get a store on that prefix.
  const url = `${o.win.location.pathname}${o.win.location.search}`;
  const linkEntry = isLinkEntry(url);
  const startServices = (): ReturnType<typeof startSocial> => startSocial({
    win: o.win,
    store: createStore({ ...(o.profiles?.storage !== undefined ? { storage: o.profiles.storage } : {}) }),
    entry: linkEntry,
    kidProfile: () => !book.online(),
    // A Pro game starts in a room only with the host's signed Pro token behind it: the page hands over the current one (none while the
    // entitlements are not read yet, and none in a build that keeps the plan in memory).
    pro: () => ent?.service.current().token ?? null,
  });
  let billing: BillingPort;
  let entitlements: EntitlementsPort | undefined;
  let later: Promise<RealParts | null> | null = null;
  const plan = o.demo ? (hooks.plan ?? query.get('plan')) : null;
  if (o.demo) {
    // Development and test builds keep the plan in memory (the page's own switch): the players follow it like the real ones follow the licence.
    practice = localEntitlements({ demo: true, initial: plan === 'pro' || plan === 'family' ? plan : 'free', isFreeGame: (id) => o.catalogue.games.find((g) => g.id === id)?.free === true });
    practice.onChange(() => book.refresh());
    entitlements = practice;
    // Tests and pictures can ask for a family on a fresh device: players added before the app starts, one of them playing.
    if (hooks.players?.length && book.list().length === 1) {
      let playing: string | null = null;
      for (const p of hooks.players) {
        const made = book.create({ name: p.name, kid: p.kid === true, ...(p.avatar ? { avatar: p.avatar as never } : {}) });
        if (made.ok && p.active === true) playing = made.profile.id;
      }
      // The page opens where it was asked to, not on the question of who is playing (a test turns the question on by its switch).
      book.setAskOnStart(false);
      if (playing) book.switchTo(playing);
    }
  }
  // A page opened under a child's profile asks the service nothing, not even whether it exists (startSocial answers null at once);
  // the services start the moment the main player plays (see below). This comes after the players that a test asks for are added
  // (a family on a fresh device, a child playing), so the page is started under the profile that plays, as it is on a real device.
  const realSocial = social ? null : startServices();
  const socialDeadline = realSocial ? new Promise<'late'>((resolve) => { setTimeout(() => resolve('late'), linkEntry ? SOCIAL_ENTRY_WAIT_MS : ENTITLEMENTS_WAIT_MS); }) : null;
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

  // The first page does not wait long for the friends service either; a visitor who came by a friend link or a room link waits for it.
  let lateSocial: Promise<SocialServices | null> | null = null;
  let lateServices: SocialServices | null = null;
  if (realSocial && socialDeadline) {
    const first = await Promise.race([realSocial, socialDeadline]);
    if (first === 'late') lateSocial = realSocial; else social = first;
  }

  const app = new App({
    win: o.win, catalogue: o.catalogue, version: o.version, demo: o.demo, profiles: book, family: FAMILY_ON, roomsPro: ROOM_PRO_ON, billing,
    // The practice session of development and test builds plays a body that is not there: its rounds are kept like a camera's.
    bodyIsSimulated: (id) => o.demo && (hooks.forceDemo === true || !playable.has(id)),
    ...(entitlements ? { entitlements } : {}),
    ...(o.sessionFactory ? { sessionFactory: o.sessionFactory } : { makeSessionFactory }),
    social,
    // Late (the first page did not wait for them) or waiting for the main player (a child plays): the pages wait or say who to ask,
    // they do not look missing.
    socialComing: !social && (lateSocial !== null || !book.online()),
    // The documents the arcade keeps in step (streak, daily challenge, plans) go through the friends client, and only for the owner.
    syncPort: () => social?.social.syncPort() ?? lateServices?.social.syncPort() ?? null,
    onPlayGesture: () => { try { pageAudio().unlock(); } catch { /* no Web Audio here: the round plays without sound */ } },
  });
  app.start();
  // The connection to the friends service follows the player: open while a profile with an online identity plays (the owner), closed
  // while a child's profile does (the owner then looks offline and gets no invitations). Nothing is made or sent for a child either way.
  const follow = (svc: SocialServices): void => { watchOnline(book, { open: () => svc.social.open(), close: () => svc.social.close() }); };
  if (realSocial) void realSocial.then((svc) => { if (svc) follow(svc); });
  // The page was opened under a child's profile: the friends services start when the main player takes over (through the parent gate).
  if (!social && !book.online()) {
    const off = book.onChange(() => {
      if (!book.online()) return;
      off();
      void startServices().then((svc) => {
        if (!svc) { app.noSocial(); return; }
        lateServices = svc;
        app.attachSocial(svc);
        follow(svc);
        if (o.demo) o.win.__BA_SOCIAL_PORTS__ = svc;
      });
    });
  }
  if (later) void later.then((r) => app.attach(r ? { entitlements: r.port, billing: r.billing } : { billing: pendingBilling('unavailable') }));
  if (lateSocial) void lateSocial.then((svc) => { if (svc) { lateServices = svc; app.attachSocial(svc); if (o.demo) o.win.__BA_SOCIAL_PORTS__ = svc; } else app.noSocial(); });
  if (o.demo) {
    o.win.__BA__ = app;
    if (social) o.win.__BA_SOCIAL_PORTS__ = social;
  }
  return app;
}
