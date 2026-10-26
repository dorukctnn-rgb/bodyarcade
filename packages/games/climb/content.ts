// What the wall of Summit Climb looks like, as data (colours from design/tokens: the BodyArcade mover in chalk strokes with a
// flush head, one flush accent). The three climbs of a round are three walls: an alpine face by day, a volcano chimney, and a
// tower in a night city.
export interface Theme {
  id: 'alps' | 'volcano' | 'city';
  /** Sky from the top to the horizon. */
  sky: [string, string];
  /** The far shapes behind the wall: two bands. */
  far: [string, string];
  /** The glow of the sun, the lava or the moon. */
  glow: string;
  /** The wall in two bands, its joints, and the shelves that stick out of it. */
  wall: [string, string];
  joint: string;
  rock: string;
  shelf: string;
  /** The holds. */
  hold: string;
  /** What lies at the top and the foot. */
  top: string;
  ground: string;
  /** Text drawn over the scene. */
  ink: string;
  stars: boolean;
}

export const THEMES: readonly Theme[] = [
  { id: 'alps', sky: ['#7FB6F2', '#E6F5FF'], far: ['#C6D8F0', '#A3BBDD'], glow: '#FFF6D0', wall: ['#6B6F8F', '#5E6283'], joint: '#4A4D6B', rock: '#3C3F5A', shelf: '#9BA0C2', hold: '#E9E4F7', top: '#FFFFFF', ground: '#4B7A5A', ink: '#1C1433', stars: false },
  { id: 'volcano', sky: ['#2A0F2E', '#B3402F'], far: ['#4A2236', '#5C2A36'], glow: '#FF9A4A', wall: ['#3F2B45', '#34223A'], joint: '#241528', rock: '#1B1020', shelf: '#7A5468', hold: '#FFC9A8', top: '#FF9A4A', ground: '#2A1620', ink: '#FFF3EA', stars: false },
  { id: 'city', sky: ['#120D26', '#40366E'], far: ['#2B2248', '#3A3060'], glow: '#FFD98A', wall: ['#3A3060', '#322857'], joint: '#241C42', rock: '#161033', shelf: '#6A5FA3', hold: '#F4F2F8', top: '#FFD98A', ground: '#1F1938', ink: '#F4F2F8', stars: true },
];

/** The wall of a climb: one after the other. */
export const themeOf = (set: number): Theme => THEMES[(Math.max(1, set) - 1) % THEMES.length] as Theme;

/** The climber: the BodyArcade mover in chalk strokes with a flush head. */
export const CLIMBER = { body: '#F4F2F8', shade: '#BFB9D6', head: '#FF4F6E', shadow: '#0E0A1C', rope: '#FFC53A' } as const;

export const MEDAL_COLORS = { gold: '#FFC53A', silver: '#D5D9E4', bronze: '#E0925A', none: '#F4F2F8', dnf: '#9C96B8' } as const;

/** Rocks: the warning colour and the stone. */
export const ROCK = { warn: '#FF4F6E', stone: '#8A839E', dark: '#4A4466', safe: '#22C383' } as const;

