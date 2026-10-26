// Raster brand files from the SVG sources in design/brand/icon (no hand-exported PNGs):
//   design/brand/png/play-icon-512.png        Google Play listing icon (full square, Play applies the mask)
//   design/brand/png/icon-1024.png            Expo "icon" (Android legacy and later iOS)
//   design/brand/png/adaptive-foreground-1024.png, adaptive-monochrome-1024.png
//                                             Expo android.adaptiveIcon (backgroundColor #1C1433)
//   design/brand/png/web/favicon.ico (16, 32, 48), favicon-32.png, apple-touch-icon.png (180),
//                     icon-192.png, icon-512.png, icon-maskable-512.png (PWA and the Play TWA)
//   design/brand/png/preview.png              the icon under the masks launchers use, at real sizes
// node design/tools/render-brand.mjs
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sharp } from './pw.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (f) => path.join(repo, 'design', 'brand', 'icon', f);
const out = path.join(repo, 'design', 'brand', 'png');
const web = path.join(out, 'web');
await mkdir(web, { recursive: true });

const svg = async (f) => readFile(src(f));
// Rasterise large, then resize down: librsvg at the final size gives soft round caps.
const raster = async (f, size) => sharp(await svg(f), { density: Math.max(72, Math.ceil((72 * size * 2) / 108)) })
  .resize(size * 2, size * 2).png().toBuffer().then((b) => sharp(b).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer());

const files = {
  'play-icon-512.png': ['app-icon.svg', 512],
  'icon-1024.png': ['app-icon.svg', 1024],
  'adaptive-foreground-1024.png': ['adaptive-foreground.svg', 1024],
  'adaptive-monochrome-1024.png': ['adaptive-monochrome.svg', 1024],
};
for (const [name, [f, size]] of Object.entries(files)) {
  await writeFile(path.join(out, name), await raster(f, size));
  console.log(`png ${name}`);
}
const webFiles = {
  'favicon-32.png': ['favicon.svg', 32],
  'apple-touch-icon.png': ['app-icon.svg', 180],
  'icon-192.png': ['app-icon-rounded.svg', 192],
  'icon-512.png': ['app-icon-rounded.svg', 512],
  'icon-maskable-512.png': ['app-icon.svg', 512],
};
for (const [name, [f, size]] of Object.entries(webFiles)) {
  await writeFile(path.join(web, name), await raster(f, size));
  console.log(`png web/${name}`);
}

// favicon.ico: PNG images inside an ICO container (16, 32, 48), which every browser reads.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => raster('favicon.svg', s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await writeFile(path.join(web, 'favicon.ico'), Buffer.concat([head, ...pngs]));
console.log('ico web/favicon.ico');

// Preview: the adaptive icon under circle, squircle and rounded-square masks at 48 and 192 px,
// the Play icon with its rounded mask, and the favicon at 16 and 32, on light and dark rows.
const fg = await raster('adaptive-foreground.svg', 432);
const bgColor = '#1C1433';
const masked = async (shape, size) => {
  const r = { circle: size / 2, squircle: size * 0.3, rounded: size * 0.16 }[shape];
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);
  // Launchers show the middle 72 of the 108 dp layer.
  const layer = await sharp({ create: { width: 432, height: 432, channels: 4, background: bgColor } }).composite([{ input: fg }]).png().toBuffer();
  const crop = await sharp(layer).extract({ left: 60, top: 60, width: 312, height: 312 }).resize(size, size).png().toBuffer();
  return sharp(crop).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
};
const tiles = [];
let x = 24;
for (const [shape, size] of [['circle', 192], ['squircle', 192], ['rounded', 192], ['circle', 48], ['squircle', 48], ['rounded', 48]]) {
  tiles.push({ input: await masked(shape, size), left: x, top: 24 + (192 - size) / 2 });
  x += size + 24;
}
const fav16 = await raster('favicon.svg', 16), fav32 = await raster('favicon.svg', 32);
tiles.push({ input: fav32, left: x, top: 24 + 80 }, { input: fav16, left: x + 48, top: 24 + 88 });
const W = x + 96, Hh = 240;
const row = (bg) => sharp({ create: { width: W, height: Hh, channels: 4, background: bg } }).composite(tiles).png().toBuffer();
await sharp({ create: { width: W, height: Hh * 2, channels: 4, background: '#ffffff' } })
  .composite([{ input: await row('#F4F2F8'), left: 0, top: 0 }, { input: await row('#0E0A1C'), left: 0, top: Hh }])
  .png().toFile(path.join(out, 'preview.png'));
console.log('png preview.png');
