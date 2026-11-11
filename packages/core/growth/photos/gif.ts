// A small GIF89a encoder for the time-lapse export (SPEC 2.8, Pro): a fixed 216-colour cube plus 40 greys, LZW, looping.
// Runs on the device from pixels the page already holds; nothing is uploaded. Enough for a few hundred small frames.

const PALETTE: number[] = (() => {
  const p: number[] = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push(r * 51, g * 51, b * 51);
  for (let i = 0; i < 40; i++) { const v = Math.round((i + 1) * (255 / 41)); p.push(v, v, v); }
  return p;
})();

/** The palette index of one RGB colour: the cube, or a grey when the colour is close to grey. */
export function indexOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 12) { const i = Math.round((((r + g + b) / 3) * 41) / 255) - 1; return i < 0 ? 0 : i > 39 ? 215 : 216 + i; }
  return Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51);
}

class Bits {
  out: number[] = [];
  private cur = 0;
  private n = 0;
  put(code: number, size: number): void {
    this.cur |= code << this.n; this.n += size;
    while (this.n >= 8) { this.out.push(this.cur & 0xff); this.cur >>>= 8; this.n -= 8; }
  }
  flush(): void { if (this.n > 0) this.out.push(this.cur & 0xff); this.cur = 0; this.n = 0; }
}

function lzw(indices: Uint8Array, minSize = 8): number[] {
  const clear = 1 << minSize, eoi = clear + 1;
  const bits = new Bits();
  let size = minSize + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  bits.put(clear, size);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    bits.put(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { bits.put(clear, size); dict = new Map(); size = minSize + 1; next = eoi + 1; }
    prefix = k;
  }
  bits.put(prefix, size);
  bits.put(eoi, size);
  bits.flush();
  return bits.out;
}

export interface GifFrame { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** Encodes RGBA frames of one size; delay in hundredths of a second. */
export function encodeGif(frames: readonly GifFrame[], delayCs = 60): Uint8Array<ArrayBuffer> {
  if (!frames.length) throw new Error('gif:empty');
  const w = frames[0]!.width, h = frames[0]!.height;
  const out: number[] = [];
  const u16 = (v: number): void => { out.push(v & 0xff, (v >> 8) & 0xff); };
  out.push(...[...'GIF89a'].map((c) => c.charCodeAt(0)));
  u16(w); u16(h);
  out.push(0xf7, 0, 0); // global colour table, 256 entries
  for (let i = 0; i < 256; i++) out.push(PALETTE[i * 3] ?? 0, PALETTE[i * 3 + 1] ?? 0, PALETTE[i * 3 + 2] ?? 0);
  out.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0); // loop forever
  for (const f of frames) {
    if (f.width !== w || f.height !== h) throw new Error('gif:size');
    out.push(0x21, 0xf9, 0x04, 0x00); u16(delayCs); out.push(0, 0);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0);
    const idx = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < idx.length; i++, j += 4) idx[i] = indexOf(f.data[j]!, f.data[j + 1]!, f.data[j + 2]!);
    out.push(8);
    const data = lzw(idx);
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); out.push(chunk.length, ...chunk); }
    out.push(0);
  }
  out.push(0x3b);
  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  bytes.set(out);
  return bytes;
}

/** Decodes the LZW data of a GIF back to indices (tests only: proves the encoder round-trips). */
export function decodeLzw(data: readonly number[], minSize = 8, count = Infinity): number[] {
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, dict: number[][] = [];
  const reset = (): void => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = minSize + 1; };
  reset();
  const out: number[] = [];
  let pos = 0, prev: number[] | null = null;
  const read = (): number => { let v = 0; for (let i = 0; i < size; i++) { const byte = data[(pos + i) >> 3] ?? 0; v |= ((byte >> ((pos + i) & 7)) & 1) << i; } pos += size; return v; };
  while (out.length < count) {
    const code = read();
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry: number[];
    if (dict[code]) entry = dict[code]!;
    else if (prev) entry = [...prev, prev[0]!];
    else break;
    out.push(...entry);
    if (prev) { dict.push([...prev, entry[0]!]); if (dict.length >= (1 << size) && size < 12) size++; }
    prev = entry;
  }
  return out;
}
