// Contact sheet of images for a quick visual review: node design/tools/contact-sheet.mjs out.webp cols w h img1 img2 ...
import { sharp } from './pw.mjs';
const [out, cols, w, h, ...files] = process.argv.slice(2);
const C = +cols, W = +w, H = +h, gap = 8;
const rows = Math.ceil(files.length / C);
const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(W, H, { fit: 'contain', background: '#ffffff' }).toBuffer(), left: gap + (i % C) * (W + gap), top: gap + Math.floor(i / C) * (H + gap) })));
await sharp({ create: { width: gap + C * (W + gap), height: gap + rows * (H + gap), channels: 3, background: '#888888' } }).composite(tiles).webp({ quality: 85 }).toFile(out);
console.log(out);
