// A real QR code for a link (friend link, room link), drawn as one SVG path. The matrix comes from qrcode-generator
// (MIT, no dependencies); the unit test decodes the drawing with jsQR to prove that it scans.
import qrcode from 'qrcode-generator';
import { raw, type SafeHtml } from '../../../core/ui/html.ts';

/** The modules of the code, row by row (true is dark). Error correction M, the smallest version that holds the text. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** The path of the dark modules, one rectangle per run in a row. */
export function qrPath(rows: readonly (readonly boolean[])[]): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x += 1; continue; }
      let len = 1;
      while (row[x + len]) len += 1;
      d += `M${x} ${y}h${len}v1h-${len}z`;
      x += len;
    }
  });
  return d;
}

/** The SVG. The box around it (.ba-qr) is white and adds the quiet zone, so the code scans on a dark page too. */
export function qrSvg(text: string, label: string): SafeHtml {
  const rows = qrMatrix(text);
  const n = rows.length;
  const esc = label.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  return raw(`<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="${esc}" shape-rendering="crispEdges" focusable="false"><path d="${qrPath(rows)}" fill="#1C1433"/></svg>`);
}
