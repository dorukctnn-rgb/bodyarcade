// What the track of Knee Sprint looks like, as data (colours from design/tokens, the night stadium of the art direction for
// template A: ink sky with floodlights, a plum track with chalk lane lines, one flush accent). The heats change the lights:
// night, dusk and a bright morning.
export interface Theme {
  id: 'night' | 'dusk' | 'morning';
  /** Sky from the top to the horizon. */
  sky: [string, string];
  /** The stands behind the track: far and near bands. */
  stands: [string, string];
  /** Floodlights and the moon, or the sun. */
  light: string;
  glow: string;
  /** The track in two bands and its edge. */
  track: [string, string];
  edge: string;
  /** What lies beside the track. */
  grass: [string, string];
  chalk: string;
  accent: string;
  /** Text drawn over the scene. */
  ink: string;
  stars: boolean;
}

export const THEMES: readonly Theme[] = [
  { id: 'night', sky: ['#120D26', '#40366E'], stands: ['#2B2248', '#3A3060'], light: '#FFF1CC', glow: '#FFD98A', track: ['#3A3060', '#34295A'], edge: '#F4F2F8', grass: ['#1F1938', '#231C40'], chalk: '#F4F2F8', accent: '#FF4F6E', ink: '#F4F2F8', stars: true },
  { id: 'dusk', sky: ['#5A52B8', '#F7B79A'], stands: ['#8C79C9', '#6F5FB3'], light: '#FFF4D6', glow: '#FFC9A8', track: ['#6F4B6B', '#64405F'], edge: '#FFF3EA', grass: ['#4B3A63', '#524069'], chalk: '#FFF3EA', accent: '#FF4F6E', ink: '#FFF3EA', stars: false },
  { id: 'morning', sky: ['#A9D8FF', '#E6F5FF'], stands: ['#9FB6D9', '#8AA3C8'], light: '#FFF1B8', glow: '#FFFFFF', track: ['#C95E5E', '#BC5252'], edge: '#FFFFFF', grass: ['#6FB07A', '#62A36E'], chalk: '#FFFFFF', accent: '#1C1433', ink: '#1C1433', stars: false },
];

/** The theme of a heat: one after the other. */
export const themeOf = (heat: number): Theme => THEMES[(Math.max(1, heat) - 1) % THEMES.length] as Theme;

/** The runners: the BodyArcade mover in chalk strokes with a flush head (the colour of the player); the computer is grey. */
export const RUNNER = {
  body: '#F4F2F8', shade: '#BFB9D6', head: '#FF4F6E', headP2: '#46B4FF', computer: '#9C96B8', computerHead: '#CFCBE0', shadow: '#0E0A1C',
} as const;

export const MEDAL_COLORS = { gold: '#FFC53A', silver: '#D5D9E4', bronze: '#E0925A', none: '#F4F2F8', dnf: '#9C96B8' } as const;

export const FONT = '"Savate", "National Park", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
