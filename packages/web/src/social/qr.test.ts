import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { qrMatrix, qrPath, qrSvg } from './qr.ts';

/** Draws the matrix the way the SVG does (a dark module is one square), with the quiet zone the white box gives. */
function render(rows: readonly (readonly boolean[])[], scale = 6, quiet = 4): { data: Uint8ClampedArray; size: number } {
  const n = rows.length;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  rows.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
      data[i] = 28; data[i + 1] = 20; data[i + 2] = 51; data[i + 3] = 255;
    }
  }));
  return { data, size };
}

describe('the QR code', () => {
  for (const text of ['https://bodyarcade.com/f/BA-7K2Q4X', 'https://bodyarcade.com/r/K7Q2MX', 'BA-7K2Q4X']) {
    it(`scans back to ${text}`, () => {
      const { data, size } = render(qrMatrix(text));
      expect(jsQR(data, size, size)?.data).toBe(text);
    });
  }

  it('the path draws exactly the dark modules', () => {
    const rows = qrMatrix('BA-7K2Q4X');
    const path = qrPath(rows);
    let dark = 0;
    for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) dark += Number(m[3]);
    expect(dark).toBe(rows.flat().filter(Boolean).length);
  });

  it('the SVG has a name for assistive technology and no script', () => {
    const svg = qrSvg('https://bodyarcade.com/r/K7Q2MX', 'QR code "room"').value;
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="QR code &quot;room&quot;"');
    expect(svg).not.toMatch(/<script|on\w+=/i);
  });
});
