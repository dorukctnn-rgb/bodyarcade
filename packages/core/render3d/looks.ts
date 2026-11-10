// Per-world picture settings that are not part of the theme file: how strongly the sky lights the scene, how much the
// flat fill lights are turned down when it does, the grade of the final pass, and the colours of the wind-blown grass.
// A world that is not listed gets the defaults. Pure data, no three.js objects.
import type { GradeLook } from './post.ts';
import type { ModelTone } from './models.ts';

export interface WorldLook {
  /** scene.environmentIntensity when the sky lights the scene (T1, T2). */
  envIntensity: number;
  /** Share of the hemisphere light that stays when the sky lights the scene. */
  hemiWithEnv: number;
  /** Share of the ambient light that stays when the sky lights the scene. */
  ambientWithEnv: number;
  grade?: GradeLook;
  /** Grass blades beside the road (T1, T2): root and tip colours, sRGB hex. Null: this world has no grass. */
  grass: { root: string; tip: string; height: number } | null;
  /** The modelled props' colours in this world (the models are bright; most worlds want them a little quieter). */
  modelTone: ModelTone;
}

const DEFAULT: WorldLook = { envIntensity: 0.85, hemiWithEnv: 0.45, ambientWithEnv: 0.4, grass: null, modelTone: { gain: 0.82, saturation: 0.82 } };

const LOOKS: Readonly<Record<string, Partial<WorldLook>>> = {
  alps: { grade: { lift: [0.0, 0.006, 0.016], saturation: 1.1 }, grass: { root: '#3f5a2c', tip: '#9fb862', height: 0.42 } },
  desert: { envIntensity: 0.8, grade: { lift: [0.016, 0.008, 0.0], saturation: 1.06, contrast: 1.08 } },
  forest: { envIntensity: 0.75, grade: { lift: [0.0, 0.01, 0.006], saturation: 1.12 }, grass: { root: '#2d4a24', tip: '#86a84e', height: 0.5 } },
  storm: { envIntensity: 0.7, modelTone: { gain: 0.62, saturation: 0.7 }, grade: { lift: [0.0, 0.006, 0.02], saturation: 0.95, vignette: 0.36 }, grass: { root: '#2a3a2a', tip: '#6c8452', height: 0.45 } },
  sunset: { grade: { lift: [0.02, 0.006, 0.012], saturation: 1.12, bloom: 0.42 }, grass: { root: '#4a4a26', tip: '#b8a460', height: 0.4 } },
  arctic: { envIntensity: 0.9, grade: { lift: [0.0, 0.008, 0.022], saturation: 1.02 } },
  jungle: { envIntensity: 0.75, grade: { lift: [0.0, 0.012, 0.006], saturation: 1.14 }, grass: { root: '#24421e', tip: '#6fae48', height: 0.6 } },
  city: { envIntensity: 0.35, hemiWithEnv: 0.45, ambientWithEnv: 0.45, modelTone: { gain: 0.55, saturation: 0.9 }, grade: { lift: [0.004, 0.004, 0.024], saturation: 1.1, bloom: 0.4, vignette: 0.34 } },
  volcano: { envIntensity: 0.7, grade: { lift: [0.02, 0.004, 0.0], contrast: 1.1, bloom: 0.6 } },
  coast: { envIntensity: 0.95, grade: { lift: [0.0, 0.008, 0.014], saturation: 1.1 } },
};

export function lookOf(themeId: string): WorldLook {
  const l = LOOKS[themeId];
  return l ? { ...DEFAULT, ...l } : DEFAULT;
}
