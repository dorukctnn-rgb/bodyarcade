// The entry of the web shell: styles, then the app.
import './styles/app.css';
import catalogue from 'virtual:catalogue';
import { boot } from './app/boot.ts';
import { router } from './routes.ts';

const q = new URLSearchParams(location.search);
// The coach pages (Kol G): /form-coach, /today and /progress (in every language) are apps of their own. The old ?form=1 and
// ?gelisim=1 addresses still open them (developers and tests). Their first paint (views/coach-boot.ts) makes way for them.
const route = router.match(`${location.pathname}${location.search}`);
const coach = q.get('form') === '1' || route?.id === 'formcoach' ? 'form' : q.get('gelisim') === '1' || route?.id === 'today' || route?.id === 'progress' ? 'growth' : null;
const lang = route && route.id !== 'home' ? route.lang : undefined;
const clearFirstPaint = (): void => { document.getElementById('app')?.replaceChildren(); };

if (coach === 'form') {
  void import('./form/page.ts').then(({ bootFormCoach }) => { clearFirstPaint(); bootFormCoach(window, lang); });
} else if (coach === 'growth') {
  // /progress opens on the progress tab, /today (and ?gelisim=1) on Today; a tab in the address wins
  if (route?.id === 'progress' && !location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}#progress`);
  void import('./growth/access.ts').then(async ({ growthBoot }) => {
    // the access and, for the Today panel and the progress page, the active player's games (kol F)
    const { access, play } = await growthBoot(window, catalogue.games);
    const { bootGrowth } = await import('./growth/page.ts');
    clearFirstPaint();
    await bootGrowth(window, { access, play, ...(lang ? { lang } : {}) });
  });
} else if (q.get('worlds') === '1') {
  void import('./worlds/page.ts').then(({ bootWorlds }) => bootWorlds());
} else void boot({ win: window, catalogue, version: __BA_VERSION__, demo: __BA_DEMO__, placeholderPlans: __BA_PLACEHOLDER_PLANS__, paddle: __BA_PADDLE__ });
