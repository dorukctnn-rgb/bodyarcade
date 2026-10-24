// Starts the app. A real round runs on the platform's session; in development and test builds the practice session
// stands in for any game that has no code yet (and for every game when a test asks for it). A published build has no
// practice session (the constant is false and the bundler drops it), so a game without code says it is not here yet.
//
// What may be bought comes from the entitlements (core/entitlements): a published build asks them where the page runs and
// draws only what can really be bought there; a development or test build has made-up offers marked as a preview. The first
// page does not wait long for the entitlements (a licence kept from the old site is checked on the way): it is drawn from
// what the device kept and drawn again when they answer.
import { bootEntitlements, type BootWindow } from '../../../core/entitlements/boot.ts';
import { createStore, type BodyArcadeStore } from '../../../core/store/store.ts';
import type { Catalogue } from '../../catalogue/types.ts';
import { App, type AppServices } from './app.ts';
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
}

/**
 * Family is sold once its six profiles exist (the entitlements keep it off the page until told). The shell has no profile
 * switcher yet, so a published page does not promise them; a preview build shows the plan so the design can be judged.
 */
export const FAMILY_ON = false;

/** How long the first page waits for the entitlements before it is drawn from what the device kept. */
export const ENTITLEMENTS_WAIT_MS = 600;

interface RealParts { port: EntitlementsPort; billing: BillingPort }

async function startEntitlements(o: BootOptions, store: BodyArcadeStore): Promise<RealParts | null> {
  try {
    const boot = await bootEntitlements({ store, window: o.win as unknown as BootWindow });
    const details = await loadPlayDetails(boot.env);
    const real = realBilling(boot, { family: FAMILY_ON, details: () => details });
    return { port: boot.port, billing: o.placeholderPlans ? withPreviewOffers(real) : real };
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

  const store = createStore();
  let billing: BillingPort;
  let entitlements: EntitlementsPort | undefined;
  let later: Promise<RealParts | null> | null = null;
  if (o.demo && hooks.billing) {
    billing = pendingBilling(hooks.billing);
  } else if (o.demo) {
    billing = practiceBilling({
      ...(hooks.trial ? { trial: { endsInMs: hooks.trial.endsInHours * 3_600_000, ...(hooks.trial.where ? { where: hooks.trial.where } : {}), ...(hooks.trial.cancelled ? { cancelled: true } : {}), ...(hooks.trial.email ? { email: hooks.trial.email } : {}) } } : {}),
    });
  } else {
    const started = startEntitlements(o, store);
    const first = await Promise.race([started, new Promise<'late'>((resolve) => { setTimeout(() => resolve('late'), ENTITLEMENTS_WAIT_MS); })]);
    if (first === 'late') { billing = pendingBilling('checking'); later = started; }
    else if (first) { billing = first.billing; entitlements = first.port; }
    else billing = pendingBilling('unavailable');
  }

  const app = new App({
    win: o.win, catalogue: o.catalogue, version: o.version, demo: o.demo, store, billing,
    ...(entitlements ? { entitlements } : {}),
    ...(o.sessionFactory ? { sessionFactory: o.sessionFactory } : { makeSessionFactory }),
    social,
    onPlayGesture: () => { try { pageAudio().unlock(); } catch { /* no Web Audio here: the round plays without sound */ } },
  });
  app.start();
  if (later) void later.then((r) => app.attach(r ? { entitlements: r.port, billing: r.billing } : { billing: pendingBilling('unavailable') }));
  if (o.demo) {
    o.win.__BA__ = app;
    const plan = hooks.plan ?? query.get('plan');
    if (plan === 'pro') app.setPlanForTest('pro');
  }
  return app;
}
