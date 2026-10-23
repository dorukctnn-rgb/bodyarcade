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
}

export const BIOMES: readonly Biome[] = [
  {
    id: 'ice', sky: ['#B9B5EE', '#DAD7F7'], hills: ['#8F8AE0', '#7771CF'], orb: '#FFF1CC', cloud: '#F1F0FC',
    pipe: { body: '#E4F4FF', lit: '#F6FBFF', shade: '#BCD9EE', cap: '#FFFFFF', capShade: '#D3E7F5' },
    ground: '#2B2248', groundLine: '#FF4F6E', stars: false, ink: '#1C1433',
  },
  {
    id: 'dunes', sky: ['#F7C5AA', '#FDE7D8'], hills: ['#E39A7E', '#C97562'], orb: '#FFF4D6', cloud: '#FFF3EA',
    pipe: { body: '#F2C9A0', lit: '#FADDBB', shade: '#D9A67C', cap: '#FFE6C7', capShade: '#EBC39A' },
    ground: '#3A2430', groundLine: '#FF4F6E', stars: false, ink: '#1C1433',
  },
  {
    id: 'night', sky: ['#1A1430', '#40366E'], hills: ['#31285A', '#241C40'], orb: '#E8E4F6', cloud: '#40366E',
    pipe: { body: '#5E5677', lit: '#7A7196', shade: '#40366E', cap: '#8A82A8', capShade: '#5E5677' },
    ground: '#140F27', groundLine: '#FF4F6E', stars: true, ink: '#F4F2F8',
  },
  {
    id: 'meadow', sky: ['#A9D8FF', '#E6F5FF'], hills: ['#9FCB8E', '#6FB07A'], orb: '#FFF1B8', cloud: '#FFFFFF',
    pipe: { body: '#8FD1A3', lit: '#B2E3C0', shade: '#62AE7E', cap: '#C5EBD0', capShade: '#8FD1A3' },
    ground: '#2B3A2E', groundLine: '#FF4F6E', stars: false, ink: '#1C1433',
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

export const FONT = '"Savate", "National Park", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
