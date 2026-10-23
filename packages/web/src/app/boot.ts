// Starts the app. In development and test builds it adds the practice session and the test hooks; a published build
// has neither (the constant is false and the bundler drops them), so a real round needs a real session factory.
import type { Catalogue } from '../../catalogue/types.ts';
import { App } from './app.ts';
import { createDemoSession } from './demo-session.ts';
import type { SessionFactory } from './ports.ts';

export interface BootOptions {
  win: Window & typeof globalThis;
  catalogue: Catalogue;
  version: string;
  demo: boolean;
  sessionFactory?: SessionFactory;
}

export function boot(o: BootOptions): App {
  const hooks = o.demo ? (o.win.__BA_TEST__ ?? {}) : {};
  const query = new URLSearchParams(o.win.location.search);
  const factory: SessionFactory | undefined = o.sessionFactory ?? (o.demo
    ? (r) => createDemoSession(r, { timeScale: hooks.timeScale ?? 1, ...(hooks.roundSeconds !== undefined ? { roundSeconds: hooks.roundSeconds } : {}), document: o.win.document })
    : undefined);
  const app = new App({
    win: o.win, catalogue: o.catalogue, version: o.version, demo: o.demo,
    ...(factory ? { sessionFactory: factory } : {}),
    social: o.demo && (hooks.social === true || query.get('social') === '1'),
  });
  app.start();
  if (o.demo) {
    o.win.__BA__ = app;
    const plan = hooks.plan ?? query.get('plan');
    if (plan === 'pro') app.setPlanForTest('pro');
  }
  return app;
}
