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

/** The 3D stage of the welcome tour (design/onboarding/scene.mjs, the art director's file, plain JavaScript). */
declare module '*/onboarding/scene.mjs' {
  export interface StageStats { frames: number; p50: number; p95: number; calls: number; triangles: number; tier: number }
  /** Where the labels of the space page sit, as fractions of the stage (x to the right, y downwards). */
  export interface StageLabels { players: number; distance: { x: number; y: number }; device: { x: number; y: number }; space: { x: number; y: number } }
  export interface StageOptions {
    theme?: 'light' | 'dark';
    step?: number;
    /** A picture for capture: the drawing buffer is kept and the background is opaque. */
    capture?: boolean;
    tier?: number;
    reducedMotion?: boolean;
    onLabels?: (labels: StageLabels | null) => void;
  }
  export interface Stage {
    start(): void;
    stop(): void;
    setStep(n: number, o?: { instant?: boolean; logoBand?: boolean }): void;
    setRegions(list: readonly string[]): void;
    setDevice(kind: string): void;
    setPlayers(n: number): void;
    setTier(n: number): void;
    readonly tier: number;
    renderAt(t: number): void;
    resetStats(): void;
    stats(): StageStats;
    dispose(): void;
  }
  export function createStage(canvas: HTMLCanvasElement, opts?: StageOptions): Stage;
}

interface Window {
  /** Development and test builds only: the running app and the hooks tests use. */
  __BA__?: import('./app/app.ts').App;
  __BA_TEST__?: { timeScale?: number; roundSeconds?: number; social?: boolean | 'fresh' | 'offline'; plan?: 'free' | 'pro' | 'family'; forceDemo?: boolean; keyboard?: boolean; desk?: boolean;
    /** The player is in the last days of a free trial: it ends this many hours from now. */
    trial?: { endsInHours: number; where?: 'web' | 'play'; cancelled?: boolean; email?: 'offer' | 'none' };
    /** What a published build shows while nothing can be bought: no offers, a note. */
    billing?: 'unavailable' | 'checking';
    /** The welcome tour: 'static' draws the stage once, still (pictures and tests), 'fallback' shows the pre-rendered pictures, 'first' is a first visit that is taken to the tour (a script never is, in a published build). */
    tour?: 'static' | 'fallback' | 'first' };
}
