// QR Code encoder (ISO/IEC 18004, model 2) for room invite links: byte mode (UTF-8), error correction L, M, Q or H,
// versions 1 to 10 (up to 174 bytes at level L, 119 at M, so an invite link of 40 characters is a 29x29 code at level M).
// Pure functions with no platform types: the same code runs in the browser, in Node and in the tests. qr.test.ts checks
// the tables against the capacities in the standard, the Reed-Solomon example of its annex and the format and version
// words, and decodes what the encoder draws with a second, independent implementation.
//
//   const qr = encodeQr(inviteLink(origin, code));            // level M unless told otherwise
//   tile.innerHTML = qrToSvg(qr, { label: 'Invite link as a QR code' });
//
// A QR code is dark modules on a light ground with a light quiet zone of four modules: show it on a white tile in every
// theme (an inverted code is not read by every scanner).

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  /** 1 to 10. */
  readonly version: number;
  /** Modules per side: 17 + 4 * version. */
  readonly size: number;
  readonly ecc: QrEcc;
  /** The data mask (0 to 7) with the lowest penalty. */
  readonly mask: number;
  /** Row-major, size * size, 1 = dark. */
  readonly modules: Uint8Array;
  dark(x: number, y: number): boolean;
}

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 10;

const ECC_FORMAT_BITS: Readonly<Record<QrEcc, number>> = { L: 1, M: 0, Q: 3, H: 2 };

// Index = version (0 is unused). Check: qr.test.ts derives every capacity of the standard from these.
const ECC_PER_BLOCK: Readonly<Record<QrEcc, readonly number[]>> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const BLOCKS: Readonly<Record<QrEcc, readonly number[]>> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;
const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

/** Modules that can hold data and error correction (everything but the function patterns), remainder bits included. */
export function rawModules(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}

/** How the codewords of a version and level are split: the number of blocks, the error correction codewords of each, all codewords. */
export function blockLayout(version: number, ecc: QrEcc): { blocks: number; eccPerBlock: number; codewords: number } {
  return { blocks: at(BLOCKS[ecc], version), eccPerBlock: at(ECC_PER_BLOCK[ecc], version), codewords: Math.floor(rawModules(version) / 8) };
}

/** Data codewords (bytes) a code of this version and level carries. */
export function dataCodewords(version: number, ecc: QrEcc): number {
  const l = blockLayout(version, ecc);
  return l.codewords - l.eccPerBlock * l.blocks;
}

/** Bytes of text that fit in this version and level (byte mode: 4 bits mode, 8 or 16 bits count, then 8 bits a byte). */
export function byteCapacity(version: number, ecc: QrEcc): number {
  return Math.floor((dataCodewords(version, ecc) * 8 - 4 - countBits(version)) / 8);
}

const countBits = (version: number): number => (version <= 9 ? 8 : 16);

// ───────── Reed-Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 ─────────

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The generator polynomial of this degree without its leading term (highest power first). */
export function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(at(out, j), root);
      if (j + 1 < degree) out[j] = at(out, j) ^ at(out, j + 1);
    }
    root = gfMul(root, 2);
  }
  return out;
}

/** The error correction codewords of `data`. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (out.shift() ?? 0);
    out.push(0);
    for (let i = 0; i < divisor.length; i++) out[i] = at(out, i) ^ gfMul(at(divisor, i), factor);
  }
  return out;
}

// ───────── words ─────────

/** The 15 format bits (level and mask, BCH protected, masked with 0x5412). */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits of versions 7 and up (Golay protected). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = version * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ───────── drawing ─────────

class Grid {
  readonly version: number;
  readonly size: number;
  readonly dark: Uint8Array;
  readonly fixed: Uint8Array;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = new Uint8Array(this.size * this.size);
    this.fixed = new Uint8Array(this.size * this.size);
  }

  /** A function module (finder, timing, alignment, format, version): its colour is fixed, data never goes there. */
  setFn(x: number, y: number, v: boolean): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.dark[y * this.size + x] = v ? 1 : 0;
    this.fixed[y * this.size + x] = 1;
  }

  isFixed(x: number, y: number): boolean { return this.fixed[y * this.size + x] === 1; }
  get(x: number, y: number): number { return at(this.dark, y * this.size + x); }
  toggle(x: number, y: number): void { this.dark[y * this.size + x] = this.get(x, y) ^ 1; }
}

function drawFunctionPatterns(g: Grid): void {
  const n = g.size;
  for (let i = 0; i < n; i++) { g.setFn(6, i, i % 2 === 0); g.setFn(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
  const pos = alignmentPositions(g.version);
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;   // the three finders
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.setFn(at(pos, i) + dx, at(pos, j) + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(g, 'L', 0);   // reserves the format modules; the real word is written once the mask is known
  if (g.version >= 7) {
    const bits = versionBits(g.version);
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.setFn(a, b, bit(bits, i)); g.setFn(b, a, bit(bits, i));
    }
  }
}

function drawFormat(g: Grid, ecc: QrEcc, mask: number): void {
  const bits = formatBits(ecc, mask);
  const n = g.size;
  for (let i = 0; i <= 5; i++) g.setFn(8, i, bit(bits, i));
  g.setFn(8, 7, bit(bits, 6)); g.setFn(8, 8, bit(bits, 7)); g.setFn(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) g.setFn(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) g.setFn(n - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) g.setFn(8, n - 15 + i, bit(bits, i));
  g.setFn(8, n - 8, true);   // the one module that is always dark
}

/** Data and error correction bits in the zigzag order of the standard: two columns at a time, from the right edge, skipping column 6. */
function drawCodewords(g: Grid, words: readonly number[]): void {
  const n = g.size;
  const total = words.length * 8;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!g.isFixed(x, y) && i < total) {
          g.dark[y * n + x] = bit(at(words, i >>> 3), 7 - (i & 7)) ? 1 : 0;
          i++;
        }
      }
    }
  }
}

/** Whether data mask `mask` inverts the module at (x, y). */
export function maskInverts(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.isFixed(x, y) && maskInverts(mask, x, y)) g.toggle(x, y);
}

/** The four penalty rules of the standard: runs of five or more, 2x2 blocks, finder-like 1:1:3:1:1 patterns, dark share away from half. */
function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;
  const lineScore = (get: (i: number) => number): number => {
    let s = 0;
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; } else run = 1;
    }
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 11 <= n; i++) {
      let a = true, b = true;
      for (let k = 0; k < 11; k++) { const v = get(i + k); if (v !== at(p1, k)) a = false; if (v !== at(p2, k)) b = false; }
      if (a) s += 40;
      if (b) s += 40;
    }
    return s;
  };
  for (let y = 0; y < n; y++) score += lineScore((i) => g.get(i, y));
  for (let x = 0; x < n; x++) score += lineScore((i) => g.get(x, i));
  let darkCount = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = g.get(x, y);
      darkCount += c;
      if (x + 1 < n && y + 1 < n && c === g.get(x + 1, y) && c === g.get(x, y + 1) && c === g.get(x + 1, y + 1)) score += 3;
    }
  }
  const total = n * n;
  score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// ───────── encoding ─────────

function dataWords(bytes: Uint8Array, version: number, ecc: QrEcc): number[] {
  const capacityBits = dataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number): void => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);                       // byte mode
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length));   // terminator
  push(0, (8 - (bits.length % 8)) % 8);                // to a whole byte
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let k = 0; k < 8; k++) w = (w << 1) | at(bits, i + k);
    words.push(w);
  }
  for (let pad = 0xec; words.length < capacityBits / 8; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** Splits the data into blocks, appends each block's error correction and interleaves them (data first, then error correction). */
function withEcc(data: readonly number[], version: number, ecc: QrEcc): number[] {
  const { blocks: numBlocks, eccPerBlock: eccLen, codewords: raw } = blockLayout(version, ecc);
  const shortBlocks = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    if (i < shortBlocks) dat.push(0);   // a placeholder so every block is as long as the longest; skipped below
    blocks.push(dat.concat(e));
  }
  const out: number[] = [];
  const longest = shortLen + 1;
  for (let i = 0; i < longest; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(at(blocks[j] ?? [], i));
    }
  }
  return out;
}

/**
 * Encodes `text` (UTF-8) at the smallest version of this level that holds it. Throws RangeError when it does not fit
 * version 10 (a link longer than 174 characters, or 119 at the default level).
 */
export function encodeQr(text: string, ecc: QrEcc = 'M'): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = QR_MIN_VERSION;
  while (version <= QR_MAX_VERSION && byteCapacity(version, ecc) < bytes.length) version++;
  if (version > QR_MAX_VERSION) throw new RangeError(`qr: ${bytes.length} bytes do not fit version ${QR_MAX_VERSION} at level ${ecc}`);

  const g = new Grid(version);
  drawFunctionPatterns(g);
  drawCodewords(g, withEcc(dataWords(bytes, version, ecc), version, ecc));

  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(g, mask);
    drawFormat(g, ecc, mask);
    const s = penalty(g);
    if (s < bestScore) { bestScore = s; best = mask; }
    applyMask(g, mask);   // XOR again: back to the unmasked data
  }
  applyMask(g, best);
  drawFormat(g, ecc, best);

  const { size, dark } = g;
  return { version, size, ecc, mask: best, modules: dark, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && at(dark, y * size + x) === 1 };
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface QrSvgOptions {
  /** Light modules around the code (the standard asks for 4). */
  quiet?: number;
  dark?: string;
  /** The ground colour; it is drawn under the quiet zone. */
  light?: string;
  /** Accessible name; without it the image is decorative (aria-hidden). */
  label?: string;
}

/** The code as one SVG string: a light square and one path of dark runs, drawn without anti-aliasing. */
export function qrToSvg(qr: QrCode, o: QrSvgOptions = {}): string {
  const q = Math.max(0, Math.floor(o.quiet ?? 4));
  const total = qr.size + 2 * q;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.dark(x, y)) { x++; continue; }
      let run = 1;
      while (x + run < qr.size && qr.dark(x + run, y)) run++;
      path += `M${x + q} ${y + q}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const a11y = o.label ? `role="img" aria-label="${escapeAttr(o.label)}"` : 'aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" ${a11y}>`
    + `<rect width="${total}" height="${total}" fill="${escapeAttr(o.light ?? '#ffffff')}"/>`
    + `<path d="${path}" fill="${escapeAttr(o.dark ?? '#000000')}"/></svg>`;
}
