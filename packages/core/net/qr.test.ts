import { describe, expect, it } from 'vitest';
import {
  blockLayout, byteCapacity, dataCodewords, encodeQr, formatBits, maskInverts, qrToSvg, rawModules, rsDivisor, rsRemainder, versionBits,
  QR_MAX_VERSION, type QrCode, type QrEcc,
} from './qr.ts';
import { inviteLink } from './codes.ts';

const LEVELS: QrEcc[] = ['L', 'M', 'Q', 'H'];

// The standard's tables for versions 1 to 10: codewords in all, data codewords at L, M, Q, H, and the bytes of text each holds.
const RAW_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const DATA_CODEWORDS: Record<QrEcc, number[]> = {
  L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274],
  M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216],
  Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154],
  H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122],
};
const BYTE_CAPACITY: Record<QrEcc, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
};

describe('the numbers of the standard', () => {
  it('has the codeword and capacity tables of versions 1 to 10', () => {
    for (let v = 1; v <= QR_MAX_VERSION; v++) {
      expect(Math.floor(rawModules(v) / 8), `raw codewords v${v}`).toBe(RAW_CODEWORDS[v - 1]);
      for (const l of LEVELS) {
        expect(dataCodewords(v, l), `data codewords v${v}${l}`).toBe(DATA_CODEWORDS[l][v - 1]);
        expect(byteCapacity(v, l), `bytes v${v}${l}`).toBe(BYTE_CAPACITY[l][v - 1]);
      }
    }
    expect(rawModules(1)).toBe(208);
    expect(rawModules(2) % 8).toBe(7);   // seven remainder bits
    expect(rawModules(7) % 8).toBe(0);
  });

  it('computes the Reed-Solomon example of the standard (version 1-M, "01234567")', () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });

  it('computes the format words (level and mask) and the version words', () => {
    expect(formatBits('L', 0).toString(2).padStart(15, '0')).toBe('111011111000100');
    expect(formatBits('M', 0).toString(2).padStart(15, '0')).toBe('101010000010010');
    expect(formatBits('Q', 0).toString(2).padStart(15, '0')).toBe('011010101011111');
    expect(formatBits('H', 0).toString(2).padStart(15, '0')).toBe('001011010001001');
    expect(formatBits('M', 5).toString(2).padStart(15, '0')).toBe('100000011001110');
    expect(formatBits('H', 7).toString(2).padStart(15, '0')).toBe('000100000111011');
    expect(versionBits(7)).toBe(0b000111110010010100);
    expect(versionBits(8)).toBe(0b001000010110111100);
    expect(versionBits(9)).toBe(0b001001101010011001);
    expect(versionBits(10)).toBe(0b001010010011010011);
  });

  it('has the eight data masks', () => {
    const at = (m: number, x: number, y: number): number => (maskInverts(m, x, y) ? 1 : 0);
    // a few cells worked out by hand from the formulas of the standard (x is the column, y the row)
    expect([at(0, 0, 0), at(0, 1, 0), at(0, 1, 1)]).toEqual([1, 0, 1]);
    expect([at(1, 5, 0), at(1, 5, 1)]).toEqual([1, 0]);
    expect([at(2, 3, 9), at(2, 4, 9)]).toEqual([1, 0]);
    expect([at(3, 1, 2), at(3, 1, 3)]).toEqual([1, 0]);
    expect([at(4, 0, 0), at(4, 3, 0), at(4, 0, 2)]).toEqual([1, 0, 0]);
    expect([at(5, 0, 7), at(5, 1, 1), at(5, 2, 3)]).toEqual([1, 0, 1]);
    expect([at(6, 1, 2), at(6, 1, 3)]).toEqual([1, 0]);
    expect([at(7, 0, 0), at(7, 1, 0), at(7, 3, 1)]).toEqual([1, 0, 1]);
  });
});

// ───────── an independent reader: what a scanner does, written separately from the encoder's drawing code ─────────

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function functionModules(version: number): Uint8Array {
  const n = 17 + 4 * version;
  const f = new Uint8Array(n * n);
  const mark = (x0: number, y0: number, w: number, h: number): void => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f[y * n + x] = 1; };
  mark(0, 0, 9, 9); mark(n - 8, 0, 8, 9); mark(0, n - 8, 9, 8);          // finders, separators, format
  mark(6, 0, 1, n); mark(0, 6, n, 1);                                       // timing
  const pos = ALIGNMENT[version - 1] ?? [];
  for (const a of pos) for (const b of pos) {
    if ((a === 6 && b === 6) || (a === 6 && b === pos[pos.length - 1]) || (a === pos[pos.length - 1] && b === 6)) continue;
    mark(a - 2, b - 2, 5, 5);
  }
  if (version >= 7) { mark(n - 11, 0, 3, 6); mark(0, n - 11, 6, 3); }
  return f;
}

function read(qr: QrCode): { text: string; ecc: QrEcc; mask: number; version: number } {
  const n = qr.size;
  const version = (n - 17) / 4;
  const d = (x: number, y: number): number => (qr.dark(x, y) ? 1 : 0);
  const first: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const second: [number, number][] = [];
  for (let i = 0; i < 8; i++) second.push([n - 1 - i, 8]);
  for (let i = 8; i < 15; i++) second.push([8, n - 15 + i]);
  const word = (cells: [number, number][]): number => cells.reduce((acc, [x, y], i) => acc | (d(x, y) << i), 0);
  const f = word(first);
  expect(word(second), 'the two copies of the format word agree').toBe(f);
  const data = (f ^ 0x5412) >> 10;
  const ecc = ({ 1: 'L', 0: 'M', 3: 'Q', 2: 'H' } as Record<number, QrEcc>)[data >> 3] as QrEcc;
  const mask = data & 7;
  expect(formatBits(ecc, mask), 'the format word is a valid codeword').toBe(f);

  const fn = functionModules(version);
  const bits: number[] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (fn[y * n + x] !== 1) bits.push(d(x, y) ^ ((MASKS[mask] as (x: number, y: number) => boolean)(x, y) ? 1 : 0));
      }
    }
  }
  const lay = blockLayout(version, ecc);
  const words: number[] = [];
  for (let i = 0; i < lay.codewords; i++) { let w = 0; for (let k = 0; k < 8; k++) w = (w << 1) | (bits[i * 8 + k] ?? 0); words.push(w); }

  // undo the interleaving: data codewords round by round (the longer blocks last), then the error correction codewords
  const shortBlocks = lay.blocks - (lay.codewords % lay.blocks);
  const shortLen = Math.floor(lay.codewords / lay.blocks);
  const blocks: { data: number[]; ecc: number[] }[] = Array.from({ length: lay.blocks }, () => ({ data: [], ecc: [] }));
  let p = 0;
  for (let i = 0; i < shortLen - lay.eccPerBlock + 1; i++) {
    for (let j = 0; j < lay.blocks; j++) {
      if (i === shortLen - lay.eccPerBlock && j < shortBlocks) continue;
      (blocks[j] as { data: number[] }).data.push(words[p++] as number);
    }
  }
  for (let i = 0; i < lay.eccPerBlock; i++) for (let j = 0; j < lay.blocks; j++) (blocks[j] as { ecc: number[] }).ecc.push(words[p++] as number);
  expect(p, 'every codeword was placed').toBe(lay.codewords);
  const div = rsDivisor(lay.eccPerBlock);
  blocks.forEach((b, i) => expect(rsRemainder(b.data, div), `error correction of block ${i}`).toEqual(b.ecc));

  const all = blocks.flatMap((b) => b.data);
  const stream = all.map((w) => w.toString(2).padStart(8, '0')).join('');
  expect(stream.slice(0, 4), 'byte mode').toBe('0100');
  const cb = version <= 9 ? 8 : 16;
  const len = parseInt(stream.slice(4, 4 + cb), 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(stream.slice(4 + cb + i * 8, 4 + cb + i * 8 + 8), 2);
  return { text: new TextDecoder().decode(bytes), ecc, mask, version };
}

describe('encodeQr', () => {
  it('draws the fixed patterns in the right places', () => {
    const qr = encodeQr('BODY', 'M');
    expect([qr.version, qr.size]).toEqual([1, 21]);
    for (const [ox, oy] of [[0, 0], [14, 0], [0, 14]] as const) {
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        expect(qr.dark(ox + dx, oy + dy), `finder ${ox},${oy} at ${dx},${dy}`).toBe(ring !== 2);
      }
    }
    for (let i = 8; i < 13; i++) { expect(qr.dark(i, 6)).toBe(i % 2 === 0); expect(qr.dark(6, i)).toBe(i % 2 === 0); }
    expect(qr.dark(8, 21 - 8), 'the dark module').toBe(true);
    for (let i = 0; i < 8; i++) { expect(qr.dark(7, i)).toBe(false); expect(qr.dark(i, 7)).toBe(false); }   // separators
    // version 2 has one alignment pattern centred on (18, 18)
    const v2 = encodeQr('x'.repeat(20), 'M');
    expect(v2.version).toBe(2);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(v2.dark(18 + dx, 18 + dy)).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    // version 7 carries its version word twice
    const v7 = encodeQr('y'.repeat(110), 'M');
    expect(v7.version).toBe(7);
    let a = 0, b = 0;
    for (let i = 0; i < 18; i++) { a |= (v7.dark(v7.size - 11 + (i % 3), Math.floor(i / 3)) ? 1 : 0) << i; b |= (v7.dark(Math.floor(i / 3), v7.size - 11 + (i % 3)) ? 1 : 0) << i; }
    expect([a, b]).toEqual([versionBits(7), versionBits(7)]);
  });

  it('picks the smallest version that holds the text', () => {
    for (const l of LEVELS) {
      for (let v = 1; v <= QR_MAX_VERSION; v++) {
        const cap = BYTE_CAPACITY[l][v - 1] as number;
        expect(encodeQr('a'.repeat(cap), l).version, `${cap} bytes at ${l}`).toBe(v);
        if (v < QR_MAX_VERSION) expect(encodeQr('a'.repeat(cap + 1), l).version, `${cap + 1} bytes at ${l}`).toBe(v + 1);
      }
    }
    expect(() => encodeQr('a'.repeat(272), 'L')).toThrow(RangeError);
    expect(() => encodeQr('a'.repeat(120), 'H')).toThrow(RangeError);
    expect(encodeQr('').version).toBe(1);
  });

  it('an invite link is a 29 x 29 code at level M', () => {
    const qr = encodeQr(inviteLink('https://bodyarcade.com', 'K7P2QX'));
    expect([qr.version, qr.size, qr.ecc]).toEqual([3, 29, 'M']);
    expect(read(qr).text).toBe('https://bodyarcade.com/r/K7P2QX');
  });

  it('reads back as the same text, with valid error correction, for every version and level', () => {
    let seed = 12345;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (const l of LEVELS) {
      for (let v = 1; v <= QR_MAX_VERSION; v++) {
        const cap = BYTE_CAPACITY[l][v - 1] as number;
        for (const len of new Set([cap, Math.max(0, cap - 1), Math.floor(cap / 2)])) {
          let text = '';
          for (let i = 0; i < len; i++) text += String.fromCharCode(32 + Math.floor(rnd() * 95));
          const qr = encodeQr(text, l);
          const got = read(qr);
          expect(got.text, `v${v}${l} ${len} bytes`).toBe(text);
          expect([got.ecc, got.version, got.mask]).toEqual([l, qr.version, qr.mask]);
        }
      }
    }
  });

  it('carries UTF-8 text', () => {
    for (const text of ['Türkçe: şişli çocuk ığ', 'Zoë and Søren', '日本語のテキスト', 'a\u{1F600}b']) {
      expect(read(encodeQr(text, 'Q')).text).toBe(text);
    }
  });

  it('chooses the mask with the lowest penalty and is deterministic', () => {
    const a = encodeQr('https://bodyarcade.com/r/AAAAAA');
    const b = encodeQr('https://bodyarcade.com/r/AAAAAA');
    expect(Array.from(a.modules)).toEqual(Array.from(b.modules));
    expect(a.mask).toBeGreaterThanOrEqual(0);
    expect(a.mask).toBeLessThan(8);
    // a long run of one letter would be a poor code under mask 0 alone: the encoder must still read back
    expect(read(encodeQr('A'.repeat(60), 'L')).text).toBe('A'.repeat(60));
  });
});

describe('qrToSvg', () => {
  it('draws every dark module once, inside a quiet zone, with an accessible name', () => {
    const qr = encodeQr('https://bodyarcade.com/r/K7P2QX');
    const svg = qrToSvg(qr, { label: 'Invite "link" <QR>' });
    expect(svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Invite &quot;link&quot; &lt;QR&gt;"');
    const runs = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)];
    let darkModules = 0;
    for (const m of runs) {
      const [x, y, w] = [Number(m[1]) - 4, Number(m[2]) - 4, Number(m[3])];
      for (let i = 0; i < w; i++) { expect(qr.dark(x + i, y)).toBe(true); darkModules++; }
    }
    expect(darkModules).toBe(qr.modules.reduce((s, v) => s + v, 0));
    expect(qrToSvg(qr)).toContain('aria-hidden="true"');
    expect(qrToSvg(qr, { quiet: 2, dark: '#101010', light: '#fafafa' })).toContain(`viewBox="0 0 ${qr.size + 4} ${qr.size + 4}"`);
  });
});
