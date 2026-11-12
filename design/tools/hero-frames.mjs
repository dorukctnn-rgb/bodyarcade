// The home page's showcase frames (packages/web/src/showcase.ts) and the game tiles (design/art/tiles), from frames of the real
// games taken with tools/gfx-shots --clean (no HUD): 2560x1440 for the 21:9 crop of a wider screen, 1280x960 for the 4:3 crop of a
// phone and for the tiles. Nothing is enlarged: every size is the shot or smaller.
//
//   node design/tools/hero-frames.mjs <shots dir> [--only=<id>]  showcase frames -> design/art/hero (--only: that frame alone)
//   node design/tools/hero-frames.mjs <shots dir> --tiles    game tiles (800x600 and 400x300) -> design/art/tiles
//
// SHOWCASE_SHOTS and TILE_SHOTS name the chosen shot of each frame and tile (gfx-shots names: <game>[-<world>]-<w>x<h>[-b<i>].png),
// for the wide crop where the 21:9 window sits in the 16:9 shot (0 = top, 1 = bottom), and for a 4:3 crop the part of the shot it is.
// The shots used on 10 Nov 2026: node tools/gfx-shots/run.ts <dir> road-run --quality=high --world=coast --sizes=2560x1440,1280x960
// --wait=9000 --burst=3:2500 --clean (the same for city and, with --suffix=-alps, the default world); squat-flap --sizes=2560x1440
// --wait=3500 --press=ArrowUp:900 --burst=6:900 --clean; pose-wall star-catch --sizes=1280x960 --wait=8000 --burst=3:2500 --clean.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sharp } from './pw.mjs';
import { FRAME_TILES } from '../art/tile-ids.mjs';

if (!sharp) throw new Error('sharp is needed (design/tools/pw.mjs SHARP_CANDIDATES)');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shots = process.argv[2];
if (!shots) throw new Error('usage: node design/tools/hero-frames.mjs <shots dir> [--tiles]');

/** Same widths as showcase.ts (SHOWCASE_WIDE, SHOWCASE_PHONE and the one WebP size of each). */
const WIDE = [1280, 1920, 2560];
const PHONE = [640, 960, 1280];
const WIDE_WEBP = 1920;
const PHONE_WEBP = 960;

export const SHOWCASE_SHOTS = {
  coast: { wide: 'road-run-coast-2560x1440-b1.png', y: 0.55, phone: { file: 'road-run-coast-1280x960-b1.png' } },
  // Squat Flap draws its feathers and set dots on the canvas (top left, top centre): both crops leave them out.
  flap: { wide: 'squat-flap-2560x1440-b4.png', y: 1, phone: { file: 'squat-flap-2560x1440-b4.png', rect: [380, 288, 1536, 1152] } },
  alps: { wide: 'road-run-alps-2560x1440-b1.png', y: 0.4, phone: { file: 'road-run-alps-1280x960-b0.png' } },
  city: { wide: 'road-run-city-2560x1440-b0.png', y: 0.35, phone: { file: 'road-run-city-1280x960-b1.png' } },
};

/**
 * The tiles that show the game itself: the four most played games, whose look was redrawn (graphics overhaul, Nov 2026). The others
 * keep the art director's dioramas (design/tools/render-tiles.mjs) until their own look is redrawn. rect: [left, top, width, height].
 */
export const TILE_SHOTS = {
  'squat-flap': { file: 'squat-flap-2560x1440-b4.png', rect: [380, 288, 1536, 1152] },
  'road-run': { file: 'road-run-alps-1280x960-b0.png' },
  'pose-wall': { file: 'pose-wall-1280x960-b0.png', rect: [128, 110, 1024, 768] },
  'star-catch': { file: 'star-catch-1280x960-b0.png', rect: [130, 60, 960, 720] },
};

/** A shot, cut to rect when there is one. */
async function shot(spec) {
  const img = sharp(path.join(shots, spec.file));
  if (!spec.rect) return img;
  const [left, top, width, height] = spec.rect;
  return sharp(await img.extract({ left, top, width, height }).png().toBuffer());
}

const avif = (img, w, h, file) => img.clone().resize(w, h, { kernel: 'lanczos3' }).avif({ quality: 56, effort: 5, chromaSubsampling: '4:2:0' }).toFile(file);
const webp = (img, w, h, file, quality = 80) => img.clone().resize(w, h, { kernel: 'lanczos3' }).webp({ quality, effort: 5 }).toFile(file);

async function frames() {
  const out = path.join(repo, 'design', 'art', 'hero');
  await mkdir(out, { recursive: true });
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  for (const [id, s] of Object.entries(SHOWCASE_SHOTS)) {
    if (only && only !== id) continue;
    const src = sharp(path.join(shots, s.wide));
    const { width, height } = await src.metadata();
    const ch = Math.round((width * 9) / 21);
    const top = Math.round((height - ch) * s.y);
    const wide = sharp(await src.extract({ left: 0, top, width, height: ch }).png().toBuffer());
    for (const w of WIDE) await avif(wide, w, Math.round((w * 9) / 21), path.join(out, `${id}-${w}.avif`));
    await webp(wide, WIDE_WEBP, Math.round((WIDE_WEBP * 9) / 21), path.join(out, `${id}-${WIDE_WEBP}.webp`));
    const phone = await shot(s.phone);
    for (const w of PHONE) await avif(phone, w, Math.round((w * 3) / 4), path.join(out, `${id}-m-${w}.avif`));
    await webp(phone, PHONE_WEBP, Math.round((PHONE_WEBP * 3) / 4), path.join(out, `${id}-m-${PHONE_WEBP}.webp`));
    console.log(`frame ${id}`);
  }
}

async function tiles() {
  const missing = FRAME_TILES.filter((id) => !(id in TILE_SHOTS));
  if (missing.length || Object.keys(TILE_SHOTS).length !== FRAME_TILES.length) throw new Error(`TILE_SHOTS and FRAME_TILES (tile-ids.mjs) differ: ${missing.join(', ')}`);
  const out = path.join(repo, 'design', 'art', 'tiles');
  for (const [id, spec] of Object.entries(TILE_SHOTS)) {
    const img = await shot(spec);
    await webp(img, 800, 600, path.join(out, `${id}.webp`), 82);
    await webp(img, 400, 300, path.join(out, `${id}-400.webp`), 80);
    console.log(`tile ${id}`);
  }
}

if (process.argv.includes('--tiles')) await tiles(); else await frames();
