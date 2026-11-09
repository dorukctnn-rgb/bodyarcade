// What the world of Squat Flap looks like, as data (colours from design/tokens, shapes from the art direction: matte,
// soft, no outlines, one flush accent). One biome per set; the classic level changes biome every 15 columns.
export interface Biome {
  id: 'ice' | 'dunes' | 'night' | 'meadow';
  /** Sky from the top of the screen to the ground. */
  sky: [string, string];
  /** Two layers of far hills, farthest first. */
  hills: [string, string];
  /** Light behind everything: the sun, the moon. */
  orb: string;
  cloud: string;
  /** The columns: body, the lit side, the shaded side, the caps. */
  pipe: { body: string; lit: string; shade: string; cap: string; capShade: string };
  ground: string;
  groundLine: string;
  /** Stars in the sky (night). */
  stars: boolean;
  /** Text and plates drawn over the scene use this ink. */
  ink: string;
  /** The painted world (scenery.ts): its time of day, light and materials. */
  paint: Paint;
}

/**
 * How a biome is painted: the time of day (sky stops and where the sun or moon stands), the light and the shadow it
 * throws, the far and middle ranges (paler with distance), the near hills with their trees, the bushes and the ground.
 * Every pair is [lit, shaded]; the light comes from the sun's side (upper right).
 */
export interface Paint {
  /** Sky from the top of the screen to the horizon, four stops. */
  sky: [string, string, string, string];
  /** Sun or moon: across the lane (share of its width), down the sky (share of the sky's height), radius (share of the lane height). */
  sun: { x: number; y: number; r: number; color: string };
  /** The air between us and the far range: what distant things fade into. */
  air: string;
  /** Rim light on ridges and crowns. */
  light: string;
  far: { shape: 'peaks' | 'mesas'; lit: string; shade: string; snow: [string, string] | null };
  mid: { shape: 'peaks' | 'dunes' | 'hills'; lit: string; shade: string; snow: [string, string] | null };
  near: { lit: string; shade: string; texture: 'snow' | 'sand' | 'grass' };
  trees: { kind: 'pine' | 'round' | 'cactus'; lit: string; shade: string; snow: boolean };
  cloud: { lit: string; shade: string; alpha: number };
  bush: [string, string];
  /** The ground's lip (snow, sand, grass): lit, middle, shade. */
  turf: [string, string, string];
  /** The soil under it, top to deep. */
  soil: [string, string, string];
  rock: [string, string];
  /** What drifts in the air: snowflakes, dust in the low sun, fireflies, pollen. */
  motes: 'snow' | 'dust' | 'fireflies' | 'pollen';
  motesColor: string;
}

export const BIOMES: readonly Biome[] = [
  {
    id: 'ice', sky: ['#B9B5EE', '#DAD7F7'], hills: ['#8F8AE0', '#7771CF'], orb: '#FFF1CC', cloud: '#F1F0FC',
    pipe: { body: '#E4F4FF', lit: '#F6FBFF', shade: '#BCD9EE', cap: '#FFFFFF', capShade: '#D3E7F5' },
    ground: '#2B2248', groundLine: '#FF4F6E', stars: false, ink: '#1C1433',
    paint: {
      sky: ['#6F6BCF', '#A29DEA', '#D8CFF4', '#FFDCCF'], sun: { x: 0.8, y: 0.34, r: 0.052, color: '#FFF4E0' }, air: '#E6DDF6', light: '#FFF1E6',
      far: { shape: 'peaks', lit: '#B2A9E8', shade: '#8B82D3', snow: ['#FBF8FF', '#CFC8F1'] },
      mid: { shape: 'peaks', lit: '#8F86DC', shade: '#5A51AE', snow: ['#FFFFFF', '#C2BAEC'] },
      near: { lit: '#ECEAFC', shade: '#B4ADE6', texture: 'snow' },
      trees: { kind: 'pine', lit: '#4A5C9E', shade: '#2D3772', snow: true },
      cloud: { lit: '#FFF8F4', shade: '#CFC6EE', alpha: 0.96 },
      bush: ['#D9D5F6', '#9F98DA'], turf: ['#FFFFFF', '#E3E0FA', '#ABA4E2'], soil: ['#5B5099', '#3F3672', '#2B2248'], rock: ['#9C94D6', '#554C93'],
      motes: 'snow', motesColor: '#FFFFFF',
    },
  },
  {
    id: 'dunes', sky: ['#F7C5AA', '#FDE7D8'], hills: ['#E39A7E', '#C97562'], orb: '#FFF4D6', cloud: '#FFF3EA',
    pipe: { body: '#F2C9A0', lit: '#FADDBB', shade: '#D9A67C', cap: '#FFE6C7', capShade: '#EBC39A' },
    ground: '#3A2430', groundLine: '#FF4F6E', stars: false, ink: '#1C1433',
    paint: {
      sky: ['#4E3F86', '#B5689A', '#F29A78', '#FFD79A'], sun: { x: 0.74, y: 0.66, r: 0.085, color: '#FFEDC2' }, air: '#F7B98E', light: '#FFE2B0',
      far: { shape: 'mesas', lit: '#DE8F78', shade: '#A4627A', snow: null },
      mid: { shape: 'dunes', lit: '#EE9F6E', shade: '#A6545E', snow: null },
      near: { lit: '#F6C48E', shade: '#C97A62', texture: 'sand' },
      trees: { kind: 'cactus', lit: '#7C8A52', shade: '#4B5836', snow: false },
      cloud: { lit: '#FFE3C8', shade: '#D98C8E', alpha: 0.92 },
      bush: ['#B9925E', '#7E5A44'], turf: ['#FFDFAE', '#F0BC84', '#C98A62'], soil: ['#9E5E4E', '#6C3B3F', '#3A2430'], rock: ['#D09278', '#7C4A46'],
      motes: 'dust', motesColor: '#FFE7B8',
    },
  },
  {
    id: 'night', sky: ['#1A1430', '#40366E'], hills: ['#31285A', '#241C40'], orb: '#E8E4F6', cloud: '#40366E',
    pipe: { body: '#5E5677', lit: '#7A7196', shade: '#40366E', cap: '#8A82A8', capShade: '#5E5677' },
    ground: '#140F27', groundLine: '#FF4F6E', stars: true, ink: '#F4F2F8',
    paint: {
      sky: ['#0B0920', '#16133C', '#2B2563', '#58468C'], sun: { x: 0.77, y: 0.24, r: 0.048, color: '#F1EEFF' }, air: '#3B3170', light: '#B9B2F0',
      far: { shape: 'peaks', lit: '#3E3676', shade: '#2C2559', snow: ['#A9A1E0', '#5E569E'] },
      mid: { shape: 'peaks', lit: '#2F285F', shade: '#1F1A45', snow: ['#8C84CC', '#423B7E'] },
      near: { lit: '#26204E', shade: '#171332', texture: 'grass' },
      trees: { kind: 'pine', lit: '#1C1838', shade: '#100D24', snow: false },
      cloud: { lit: '#4A417E', shade: '#2A2456', alpha: 0.7 },
      bush: ['#2A2452', '#151129'], turf: ['#3E3676', '#2A2452', '#1B163A'], soil: ['#1E1939', '#15112A', '#0C0918'], rock: ['#4A4282', '#1F1A3C'],
      motes: 'fireflies', motesColor: '#FFE58A',
    },
  },
  {
    id: 'meadow', sky: ['#A9D8FF', '#E6F5FF'], hills: ['#9FCB8E', '#6FB07A'], orb: '#FFF1B8', cloud: '#FFFFFF',
    pipe: { body: '#8FD1A3', lit: '#B2E3C0', shade: '#62AE7E', cap: '#C5EBD0', capShade: '#8FD1A3' },
    ground: '#2B3A2E', groundLine: '#FF4F6E', stars: false, ink: '#1C1433',
    paint: {
      sky: ['#3F93EA', '#7DBDF6', '#BFE2FB', '#EEF8FF'], sun: { x: 0.82, y: 0.18, r: 0.05, color: '#FFFBE6' }, air: '#D7ECFA', light: '#FFFCE8',
      far: { shape: 'peaks', lit: '#97BADF', shade: '#7091C4', snow: ['#FAFDFF', '#C4D6EE'] },
      mid: { shape: 'hills', lit: '#8CC48B', shade: '#5B9873', snow: null },
      near: { lit: '#86CC6E', shade: '#4E9A57', texture: 'grass' },
      trees: { kind: 'round', lit: '#5AAA50', shade: '#2E6E3E', snow: false },
      cloud: { lit: '#FFFFFF', shade: '#C6DDF2', alpha: 1 },
      bush: ['#6DBA5E', '#357A43'], turf: ['#A4E37E', '#64B85A', '#3B8545'], soil: ['#7D5B3F', '#5A3F2C', '#33251B'], rock: ['#C2B8A4', '#71675A'],
      motes: 'pollen', motesColor: '#FFFBD6',
    },
  },
];

/** The biome of a moment: by set, and for the classic level by the columns passed. */
export function biomeAt(setNo: number, classic: boolean, passes: number): Biome {
  const i = classic ? Math.floor(passes / 15) : Math.max(0, setNo - 1);
  return BIOMES[i % BIOMES.length] as Biome;
}

/** The bird: the Mover's colours in a bird (design/art: flush body, sun beak, ink wing). */
export const BIRD = {
  body: '#FF4F6E', belly: '#FFB3C0', beak: '#FFC53A', wing: '#1C1433', wingLit: '#3A3060', eye: '#FFFFFF', pupil: '#1C1433', cheek: '#E03556',
} as const;

/** Player colours of the second lane's bird (Player 2 is sky). */
export const BIRD_P2 = { ...BIRD, body: '#46B4FF', belly: '#BFE3FF', cheek: '#2B8DD6' } as const;

