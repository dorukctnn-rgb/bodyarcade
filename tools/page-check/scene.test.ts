import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyseScene, decodePng, isBlank, type Raster } from './scene.ts';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array): number => { let c = 0xffffffff; for (const x of b) c = (crcTable[(c ^ x) & 255] as number) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A minimal PNG writer for the tests: 8-bit RGBA, the given filter on every line (0 none, 1 sub, 2 up). */
function encodePng(img: Raster, filter = 0): Uint8Array {
  const chunk = (name: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
    return out;
  };
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, img.width); hv.setUint32(4, img.height); head[8] = 8; head[9] = 6;
  const stride = img.width * 4;
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const cur = img.data[y * stride + i] as number;
      const left = i >= 4 ? (img.data[y * stride + i - 4] as number) : 0;
      const up = y > 0 ? (img.data[(y - 1) * stride + i] as number) : 0;
      raw[y * (stride + 1) + 1 + i] = (cur - (filter === 1 ? left : filter === 2 ? up : 0)) & 255;
    }
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const fill = (w: number, h: number, rgb: [number, number, number], paint?: (x: number, y: number) => [number, number, number] | null): Raster => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint?.(x, y) ?? rgb; data.set([c[0], c[1], c[2], 255], (y * w + x) * 4); }
  return { width: w, height: h, data };
};

describe('png', () => {
  it('decodes what it is given, with every line filter', () => {
    const img = fill(40, 30, [10, 20, 30], (x, y) => [x * 6, y * 8, (x * y) & 255]);
    for (const f of [0, 1, 2]) {
      const back = decodePng(encodePng(img, f));
      expect([back.width, back.height]).toEqual([40, 30]);
      expect(Array.from(back.data)).toEqual(Array.from(img.data));
    }
  });
  it('refuses what it cannot read', () => {
    expect(() => decodePng(new Uint8Array(40))).toThrow('not a PNG');
  });
});

describe('scene', () => {
  const scene = { x: 0, y: 0, w: 200, h: 120 };
  it('calls one flat colour blank, also when the HUD covers a part of it', () => {
    const r = analyseScene(fill(200, 120, [27, 18, 51]), scene, [{ x: 0, y: 0, w: 60, h: 30 }]);
    expect(r.colours).toBe(1);
    expect(r.flatColour).toBe('#181838');
    expect(isBlank(r)).toBe(true);
  });
  it('sees a gradient and a few objects as drawn', () => {
    const sky = fill(200, 120, [0, 0, 0], (_x, y) => [40 + y, 60 + y, 160]);
    expect(isBlank(analyseScene(sky, scene, []))).toBe(false);
    const bird = fill(200, 120, [27, 18, 51], (x, y) => (x > 90 && x < 112 && y > 50 && y < 70 ? [255, 80, 100] : null));
    const r = analyseScene(bird, scene, []);
    expect(r.colours).toBe(2);
    expect(r.flatShare).toBeLessThan(0.995);
    expect(isBlank(r)).toBe(false);
  });
  it('ignores the covered parts: a HUD plate alone does not make a scene', () => {
    const img = fill(200, 120, [27, 18, 51], (x, y) => (x < 60 && y < 30 ? [255, 255, 255] : null));
    expect(isBlank(analyseScene(img, scene, []))).toBe(false);
    expect(isBlank(analyseScene(img, scene, [{ x: 0, y: 0, w: 60, h: 30 }]))).toBe(true);
  });
  it('does not judge a scene it can hardly see', () => {
    expect(isBlank(analyseScene(fill(200, 120, [0, 0, 0]), { x: 0, y: 0, w: 20, h: 20 }, []))).toBe(false);
  });
});
