// The entry of the web shell: styles, then the app.
import './styles/app.css';
import catalogue from 'virtual:catalogue';
import { boot } from './app/boot.ts';

if (new URLSearchParams(location.search).get('form') === '1') {
  // the form coach: not linked anywhere until the whole catalogue is built and tested (takip/devir/bodyarcade-form/SPEC.md)
  void import('./form/page.ts').then(({ bootFormCoach }) => bootFormCoach());
} else if (new URLSearchParams(location.search).get('gelisim') === '1') {
  // the progress coach: not linked anywhere until it and the form coach's whole catalogue are tested together (takip/devir/bodyarcade-gelisim/SPEC.md)
  void import('./growth/access.ts').then(async ({ growthAccess }) => {
    const access = await growthAccess(window, catalogue.games.map((g: { id: string }) => g.id));
    const { bootGrowth } = await import('./growth/page.ts');
    await bootGrowth(window, { access });
  });
} else if (new URLSearchParams(location.search).get('worlds') === '1') {
  void import('./worlds/page.ts').then(({ bootWorlds }) => bootWorlds());
} else void boot({ win: window, catalogue, version: __BA_VERSION__, demo: __BA_DEMO__, placeholderPlans: __BA_PLACEHOLDER_PLANS__, paddle: __BA_PADDLE__ });
