// The entry of the web shell: styles, then the app.
import './styles/app.css';
import catalogue from 'virtual:catalogue';
import { boot } from './app/boot.ts';

if (new URLSearchParams(location.search).get('form') === '1') {
  // the form coach: not linked anywhere until the whole catalogue is built and tested (takip/devir/bodyarcade-form/SPEC.md)
  void import('./form/page.ts').then(({ bootFormCoach }) => bootFormCoach());
} else if (new URLSearchParams(location.search).get('worlds') === '1') {
  void import('./worlds/page.ts').then(({ bootWorlds }) => bootWorlds());
} else void boot({ win: window, catalogue, version: __BA_VERSION__, demo: __BA_DEMO__, placeholderPlans: __BA_PLACEHOLDER_PLANS__, paddle: __BA_PADDLE__ });
