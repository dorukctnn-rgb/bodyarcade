// Build-time constants and the virtual catalogue module (see packages/web/vite.config.ts).
declare const __BA_VERSION__: string;
declare const __BA_DEMO__: boolean;

declare module 'virtual:catalogue' {
  import type { Catalogue } from '../catalogue/types.ts';
  const catalogue: Catalogue;
  export default catalogue;
}

interface Window {
  /** Development and test builds only: the running app and the hooks tests use. */
  __BA__?: import('./app/app.ts').App;
  __BA_TEST__?: { timeScale?: number; roundSeconds?: number; social?: boolean | 'fresh' | 'offline'; plan?: 'free' | 'pro'; forceDemo?: boolean; keyboard?: boolean };
}
