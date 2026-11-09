// The entry of the web shell: styles, then the app.
import './styles/app.css';
import catalogue from 'virtual:catalogue';
import { boot } from './app/boot.ts';

if (new URLSearchParams(location.search).get('worlds') === '1') {
  void import('./worlds/page.ts').then(({ bootWorlds }) => bootWorlds());
} else void boot({ win: window, catalogue, version: __BA_VERSION__, demo: __BA_DEMO__, placeholderPlans: __BA_PLACEHOLDER_PLANS__, paddle: __BA_PADDLE__ });
