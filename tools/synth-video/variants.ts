// The ways a clip can be filmed: who the person is (a skin of the CC0 character, a height), where the camera stands and how
// wide its lens is, how bright the room is, and how the picture is cut. Every variant is a complete scene; a clip is
// rendered in as many of them as the report needs.
export interface Variant {
  id: string;
  about: string;
  /** Picture size in pixels (default 640 x 360). */
  picture?: { width: number; height: number };
  /** Skin of the character (file under assets/kenney-protagonists/Skins); `skin2` for the second person. */
  skin: string;
  skin2?: string;
  /** Body height in metres; the second person is `personHeight2` of it (default 0.94). */
  personHeight: number;
  personHeight2?: number;
  /** Lens (vertical field of view, degrees) and the share of the picture height the person takes. */
  fovY: number;
  frame: number;
  camHeight?: number;
  /** The person's place across the picture (metres, + = toward the image right) and turn (degrees). */
  x?: number;
  yaw?: number;
  /** Room (0xrrggbb) and light. */
  wall: number;
  floor: number;
  background: number;
  hemi: number;
  sun: number;
  sunColor: number;
  sunPos: [number, number, number];
}

const NEUTRAL = { wall: 0xcfc8bb, floor: 0x6d6258, background: 0xb9b2a6, hemi: 1.1, sun: 1.6, sunColor: 0xffffff, sunPos: [2, 4, 3] as [number, number, number] };

export const VARIANTS: Variant[] = [
  { id: 'default', about: 'Average height, a laptop lens, bright neutral room, the person fills 82 % of the picture.', skin: 'skaterMaleA.png', personHeight: 1.75, fovY: 50, frame: 0.82, ...NEUTRAL },
  { id: 'tall-far', about: 'A tall person far from a wide lens (the room is big, the person takes 62 % of the height), warm light.', skin: 'criminalMaleA.png', personHeight: 1.92, fovY: 62, frame: 0.62, ...NEUTRAL, sunColor: 0xffe2b8, sunPos: [-3, 4, 3] },
  { id: 'short-near', about: 'A short person close to a narrow lens (fills 92 % of the height).', skin: 'skaterFemaleA.png', personHeight: 1.58, fovY: 42, frame: 0.92, ...NEUTRAL },
  { id: 'dim', about: 'A dim room: weak light, dark walls.', skin: 'cyborgFemaleA.png', personHeight: 1.68, fovY: 50, frame: 0.8, wall: 0x3a3a44, floor: 0x24242b, background: 0x2a2a32, hemi: 0.42, sun: 0.55, sunColor: 0xffe0c0, sunPos: [2, 3, 3] },
  { id: 'backlit', about: 'A window behind the person: bright background, the person in shade.', skin: 'skaterMaleA.png', personHeight: 1.8, fovY: 50, frame: 0.8, wall: 0xf4f2ea, floor: 0xb8b0a0, background: 0xf8f6ee, hemi: 0.75, sun: 1.5, sunColor: 0xffffff, sunPos: [0, 4, -4] },
  { id: 'off-centre', about: 'Standing to the side of the picture and turned 25 degrees.', skin: 'criminalMaleA.png', personHeight: 1.72, fovY: 50, frame: 0.8, x: 0.55, yaw: 25, ...NEUTRAL },
  { id: 'phone', about: 'A phone held upright: a 9:16 picture, the person fills 70 % of the height.', picture: { width: 360, height: 640 }, skin: 'skaterFemaleA.png', personHeight: 1.66, fovY: 58, frame: 0.7, ...NEUTRAL },
  { id: 'desk', about: 'A webcam on a desk: head and trunk only, the camera at chest height looking up a little.', skin: 'cyborgFemaleA.png', personHeight: 1.7, fovY: 55, frame: 0.8, ...NEUTRAL },
];

export const variantById = (id: string): Variant | undefined => VARIANTS.find((v) => v.id === id);
