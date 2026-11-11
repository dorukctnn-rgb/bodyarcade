// The body twin's mesh file ("BAGT" v1, built by tools/growth-twin/build.mjs from the CC0 MakeHuman base mesh):
//   0 "BAGT"  4 u32 version  8 u32 header length  12 header JSON (space padded to 4)
//   then int16 x3 positions (dequantised with header.quant), uint16 x3 triangles (padded to 4), u8 x4 per vertex:
//   region a, region b, weight a, weight b (sum 255).

export type TwinBase = 'female' | 'male';
export const TWIN_REGIONS = ['torso', 'neck', 'head', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'handL', 'handR', 'thighL', 'thighR', 'calfL', 'calfR', 'footL', 'footR'] as const;
export type TwinRegion = (typeof TWIN_REGIONS)[number];

/** The tape measures the twin is shaped by (circumferences, cm). L and R are the person's own sides. */
export const TAPE_PARTS = ['neck', 'chest', 'waist', 'hips', 'thighL', 'thighR', 'calfL', 'calfR', 'upperArmL', 'upperArmR'] as const;
export type TapePart = (typeof TAPE_PARTS)[number];
export type Tape = Partial<Record<TapePart, number>>;

type V3 = [number, number, number];
export type JointName = 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'wristL' | 'wristR' | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'ankleL' | 'ankleR' | 'neckLow' | 'neckHigh';

export interface TorsoBand { part: TapePart; kind: 'torso'; region: TwinRegion; y: number; cm: number }
export interface LimbBand { part: TapePart; kind: 'limb'; region: TwinRegion; from: JointName; to: JointName; t: number; cm: number }
export type Band = TorsoBand | LimbBand;

export interface TwinHeader {
  format: 'BAGT';
  version: number;
  base: TwinBase;
  heightM: number;
  vertexCount: number;
  triangleCount: number;
  quant: { min: V3; scale: V3 };
  regions: TwinRegion[];
  joints: Record<JointName, V3>;
  bands: Band[];
  crotchY: number;
  source: string;
}

export interface TwinModel {
  header: TwinHeader;
  /** metres, y up, floor at 0, facing +z, the person's left at +x */
  positions: Float32Array;
  indices: Uint16Array;
  /** per vertex: region a, region b (indices into TWIN_REGIONS) and their weights 0..1 */
  regA: Uint8Array;
  regB: Uint8Array;
  wA: Float32Array;
}

export function decodeTwin(buf: ArrayBuffer): TwinModel {
  const dv = new DataView(buf);
  if (buf.byteLength < 16 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'BAGT') throw new Error('twin:bad-file');
  if (dv.getUint32(4, true) !== 1) throw new Error('twin:version');
  const hlen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen))) as TwinHeader;
  const n = header.vertexCount, t = header.triangleCount;
  let at = 12 + hlen;
  const q = new Int16Array(buf, at, n * 3); at += n * 6;
  const idxBytes = t * 6;
  const indices = new Uint16Array(buf.slice(at, at + idxBytes)); at += Math.ceil(idxBytes / 4) * 4;
  const reg = new Uint8Array(buf, at, n * 4);
  const positions = new Float32Array(n * 3);
  const { min, scale } = header.quant;
  for (let i = 0; i < n * 3; i++) { const k = i % 3; positions[i] = (q[i]! + 32767) * scale[k]! + min[k]!; }
  const regA = new Uint8Array(n), regB = new Uint8Array(n), wA = new Float32Array(n);
  for (let i = 0; i < n; i++) { regA[i] = reg[i * 4]!; regB[i] = reg[i * 4 + 1]!; wA[i] = reg[i * 4 + 2]! / 255; }
  return { header, positions, indices, regA, regB, wA };
}
