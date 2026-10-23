// Starts the app. A real round runs on the platform's session; in development and test builds the practice session
// stands in for any game that has no code yet (and for every game when a test asks for it). A published build has no
// practice session (the constant is false and the bundler drops it), so a game without code says it is not here yet.
import type { Catalogue } from '../../catalogue/types.ts';
import { App, type AppServices } from './app.ts';
import { createDemoSession } from './demo-session.ts';
import type { SessionFactory } from './ports.ts';
import { createRealSessionFactory, pageAudio, playableGameIds } from './session.ts';

export interface BootOptions {
  win: Window & typeof globalThis;
  catalogue: Catalogue;
  version: string;
  demo: boolean;
  /** Replaces the choice of session (tests of the shell itself). */
  sessionFactory?: SessionFactory;
}

export function boot(o: BootOptions): App {
  const hooks = o.demo ? (o.win.__BA_TEST__ ?? {}) : {};
  const query = new URLSearchParams(o.win.location.search);
  const playable = new Set(playableGameIds());

  const makeSessionFactory = (s: AppServices): SessionFactory => {
    const real = createRealSessionFactory({
      store: (id) => s.store.ns(id), i18n: s.i18n, reducedMotion: s.reducedMotion, soundOn: s.soundOn, quiet: s.quiet,
    });
    return (r) => {
      if (o.demo && (hooks.forceDemo === true || !playable.has(r.game.id))) {
        return createDemoSession(r, { timeScale: hooks.timeScale ?? 1, ...(hooks.roundSeconds !== undefined ? { roundSeconds: hooks.roundSeconds } : {}), document: o.win.document });
      }
      return playable.has(r.game.id) ? real(r) : null;
    };
  };

  const app = new App({
    win: o.win, catalogue: o.catalogue, version: o.version, demo: o.demo,
    ...(o.sessionFactory ? { sessionFactory: o.sessionFactory } : { makeSessionFactory }),
    social: o.demo && (hooks.social === true || query.get('social') === '1'),
    onPlayGesture: () => { try { pageAudio().unlock(); } catch { /* no Web Audio here: the round plays without sound */ } },
  });
  app.start();
  if (o.demo) {
    o.win.__BA__ = app;
    const plan = hooks.plan ?? query.get('plan');
    if (plan === 'pro') app.setPlanForTest('pro');
  }
  return app;
}
