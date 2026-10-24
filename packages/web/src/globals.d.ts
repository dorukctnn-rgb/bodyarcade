// Build-time constants and the virtual catalogue module (see packages/web/vite.config.ts).
declare const __BA_VERSION__: string;
declare const __BA_DEMO__: boolean;
/** A build made to look at the design before the Gumroad products exist: made-up offers where the real ones are missing (BA_PLACEHOLDER_PLANS=1). */
declare const __BA_PLACEHOLDER_PLANS__: boolean;

declare module 'virtual:catalogue' {
  import type { Catalogue } from '../catalogue/types.ts';
  const catalogue: Catalogue;
  export default catalogue;
}

interface Window {
  /** Development and test builds only: the running app and the hooks tests use. */
  __BA__?: import('./app/app.ts').App;
  __BA_TEST__?: { timeScale?: number; roundSeconds?: number; social?: boolean | 'fresh' | 'offline'; plan?: 'free' | 'pro'; forceDemo?: boolean; keyboard?: boolean; desk?: boolean;
    /** The player is in the last days of a free trial: it ends this many hours from now. */
    trial?: { endsInHours: number; where?: 'web' | 'play'; cancelled?: boolean; email?: 'offer' | 'none' };
    /** What a published build shows while nothing can be bought: no offers, a note. */
    billing?: 'unavailable' | 'checking' };
}
