// The entry of the web shell: styles, then the app.
import './styles/app.css';
import catalogue from 'virtual:catalogue';
import { boot } from './app/boot.ts';

boot({ win: window, catalogue, version: __BA_VERSION__, demo: __BA_DEMO__ });
