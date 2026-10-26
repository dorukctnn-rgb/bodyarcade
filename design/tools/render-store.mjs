// Google Play graphics, headless, English and Turkish:
//   design/store/export/<lang>/feature-graphic.png        1024 x 500, 24-bit PNG (Play feature graphic)
//   design/store/export/<lang>/feature-graphic-dark.png   the same on the night court, for promos
//   design/store/export/<lang>/phone-<n>.png              1080 x 1920 phone screenshots, n = 1..6 (store order)
//   design/store/export/<lang>/tablet7-<n>.png            1920 x 1080 7-inch tablet screenshots (16:9, landscape)
//   design/store/export/<lang>/tablet10-<n>.png           2560 x 1440 10-inch tablet screenshots (16:9, landscape)
//   design/store/export/contact-<lang>.webp, contact.webp  review sheets;  design/store/export/report.json  sizes and checks
//
// The screens inside the images are captures of the real app (packages/web of this checkout, real catalogue, real strings of
// the language) at the real CSS size of each device (design/tools/store-app.mjs); the pages design/store/{shot,tablet,feature}.html
// put the caption and the device around them. Nothing is enlarged and nothing is pasted over an image of another language.
//
//   node C:/Users/doruk/apps/_tools/e2e-slot.mjs run -- node design/tools/render-store.mjs [--lang en,tr] [--only capture,feature,phone,tablet7,tablet10,sheet] [--shots games,modes] [--devices phone]
//   (--only without capture composes from the captures of the last run: design/store/.cap, ignored by git)
import path from 'node:path';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch, sharp } from './pw.mjs';
import { startApp, captureShot, saveCapture, SHOTS, DEVICES } from './store-app.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(repo, 'design', 'store');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const langs = arg('--lang', 'en,tr').split(',');
const shotIds = arg('--shots', '').split(',').filter(Boolean);
const deviceIds = arg('--devices', '').split(',').filter(Boolean);
const only = new Set(arg('--only', 'capture,feature,phone,tablet7,tablet10,sheet').split(','));
const BG = { light: '#F4F2F8', dark: '#1A1430' };
const outOf = (lang) => path.join(root, 'export', lang);

// ---------- 1. the real app, photographed ----------
if (only.has('capture')) {
  const app = await startApp();
  const bad = [];
  try {
    for (const lang of langs) for (const device of Object.keys(DEVICES).filter((d) => !deviceIds.length || deviceIds.includes(d))) for (const shot of SHOTS.filter((x) => !shotIds.length || shotIds.includes(x.id))) {
      const r = await captureShot(app, shot, { lang, device });
      await saveCapture(r.png, { lang, device, id: shot.id });
      console.log(`capture ${lang} ${device} ${shot.id}${r.attempt > 1 ? ` (round ${r.attempt})` : ''}${r.problems.length ? `: ${r.problems.length} problem(s)` : ''}`);
      for (const p of r.problems) bad.push(`${lang} ${device} ${shot.id}: ${p}`);
    }
  } finally { await app.close(); }
  if (bad.length) { console.error(`the shell's own checks found problems on a captured screen:\n  ${bad.join('\n  ')}`); process.exit(1); }
}

// ---------- 2. caption and device around each capture ----------
const compose = ['feature', 'phone', 'tablet7', 'tablet10'].filter((k) => only.has(k));
if (compose.length) {
  const server = await startServer(repo);
  const browser = await launch();
  const settle = async (page) => {
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 });
    await page.waitForTimeout(250);
  };
  const png = async (buf, file, { w, h, bg }) => {
    // 24-bit PNG without alpha, the exact size, no palette.
    let img = sharp(buf);
    const m = await img.metadata();
    if (m.width !== w || m.height !== h) img = img.resize(w, h, { kernel: 'lanczos3' });
    await img.flatten({ background: bg }).removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toFile(file);
  };
  try {
    for (const lang of langs) {
      await mkdir(outOf(lang), { recursive: true });
      const one = async (name, url, viewport, size, bg) => {
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: bg === BG.dark ? 'dark' : 'light', locale: lang === 'en' ? 'en-US' : 'tr-TR' });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
        await page.goto(`${server.url}/design/store/${url}`, { waitUntil: 'networkidle' });
        await settle(page);
        if (errors.length) throw new Error(`${lang} ${name}: ${errors.join('; ')}`);
        await png(await page.screenshot(), path.join(outOf(lang), `${name}.png`), { ...size, bg });
        console.log(`store ${lang}/${name}.png`);
        await ctx.close();
      };
      if (only.has('feature')) {
        await one('feature-graphic', `feature.html?theme=light&lang=${lang}`, { width: 1024, height: 500 }, { w: 1024, h: 500 }, BG.light);
        await one('feature-graphic-dark', `feature.html?theme=dark&lang=${lang}`, { width: 1024, height: 500 }, { w: 1024, h: 500 }, BG.dark);
      }
      if (only.has('phone')) for (let n = 1; n <= SHOTS.length; n++) await one(`phone-${n}`, `shot.html?n=${n}&lang=${lang}`, { width: 540, height: 960 }, { w: 1080, h: 1920 }, BG.light);
      if (only.has('tablet7')) for (let n = 1; n <= SHOTS.length; n++) await one(`tablet7-${n}`, `tablet.html?n=${n}&lang=${lang}&size=7`, { width: 960, height: 540 }, { w: 1920, h: 1080 }, BG.light);
      if (only.has('tablet10')) for (let n = 1; n <= SHOTS.length; n++) await one(`tablet10-${n}`, `tablet.html?n=${n}&lang=${lang}&size=10`, { width: 1280, height: 720 }, { w: 2560, h: 1440 }, BG.light);
    }
  } finally { await browser.close(); await server.close(); }
}

// ---------- 3. the Play rules, checked on every file; review sheets; report ----------
const inventory = [];
for (const lang of langs) {
  for (const [kind, names] of [
    ['feature', ['feature-graphic.png', 'feature-graphic-dark.png']],
    ['phone', Array.from({ length: SHOTS.length }, (_, i) => `phone-${i + 1}.png`)],
    ['tablet7', Array.from({ length: SHOTS.length }, (_, i) => `tablet7-${i + 1}.png`)],
    ['tablet10', Array.from({ length: SHOTS.length }, (_, i) => `tablet10-${i + 1}.png`)],
  ]) {
    for (const name of names) {
      const file = path.join(outOf(lang), name);
      const s = await stat(file).catch(() => null);
      if (!s) continue;
      const m = await sharp(file).metadata();
      inventory.push({ lang, kind, name, w: m.width, h: m.height, bytes: s.size, channels: m.channels, alpha: !!m.hasAlpha, depth: m.depth, format: m.format });
    }
  }
}
const problems = [];
for (const f of inventory) {
  const tag = `${f.lang}/${f.name}`;
  if (f.format !== 'png' || f.channels !== 3 || f.alpha || f.depth !== 'uchar') problems.push(`${tag}: not a 24-bit PNG without alpha (${f.format}, ${f.channels} channels, alpha ${f.alpha}, ${f.depth})`);
  if (f.bytes > 8 * 1024 * 1024) problems.push(`${tag}: ${f.bytes} bytes is over 8 MB`);
  if (f.kind === 'feature' && (f.w !== 1024 || f.h !== 500)) problems.push(`${tag}: the feature graphic must be 1024 x 500`);
  if (f.kind === 'phone') {
    // Play: each side 320 to 3840 px, the long side at most twice the short side; 9:16 and 1080 x 1920 or more for the large-format rule of games.
    if (Math.min(f.w, f.h) < 320 || Math.max(f.w, f.h) > 3840 || Math.max(f.w, f.h) / Math.min(f.w, f.h) > 2) problems.push(`${tag}: outside the phone screenshot limits`);
    if (f.w !== 1080 || f.h !== 1920) problems.push(`${tag}: expected 1080 x 1920`);
  }
  if (f.kind === 'tablet7' || f.kind === 'tablet10') {
    // Play, large screens: each side 1080 to 7680 px, 16:9 landscape or 9:16 portrait.
    if (Math.min(f.w, f.h) < 1080 || Math.max(f.w, f.h) > 7680 || Math.abs(f.w / f.h - 16 / 9) > 0.002) problems.push(`${tag}: outside the tablet screenshot limits (1080 to 7680 px, 16:9)`);
  }
}
for (const lang of langs) for (const kind of ['phone', 'tablet7', 'tablet10']) {
  const n = inventory.filter((f) => f.lang === lang && f.kind === kind).length;
  const min = kind === 'phone' ? 2 : 4;
  if (n < min || n > 8) problems.push(`${lang} ${kind}: ${n} screenshots (Play wants ${min} to 8)`);
}

if (only.has('sheet')) {
  const label = (text, w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26"><text x="0" y="19" font-family="Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">${text}</text></svg>`);
  const GAP = 18, W = 1944;
  const sheetFor = async (lang) => {
    const comp = [];
    let y = GAP;
    const put = async (list, cols, cw, text) => {
      const ch = Math.round(cw * (list[0]?.h ?? 1) / (list[0]?.w ?? 1));
      comp.push({ input: label(text, W - 2 * GAP), left: GAP, top: y });
      y += 28;
      for (const [i, f] of list.entries()) {
        const x = GAP + (i % cols) * (cw + GAP), yy = y + Math.floor(i / cols) * (ch + GAP);
        comp.push({ input: await sharp(path.join(outOf(lang), f.name)).resize(cw, ch, { kernel: 'lanczos3' }).toBuffer(), left: x, top: yy });
      }
      y += Math.ceil(list.length / cols) * (ch + GAP) + 6;
    };
    const of = (kind) => inventory.filter((f) => f.lang === lang && f.kind === kind);
    await put(of('feature'), 2, 936, `${lang.toUpperCase()}  Feature graphic 1024 x 500 (light, night)`);
    await put(of('phone'), 6, 290, `${lang.toUpperCase()}  Phone 1080 x 1920`);
    await put(of('tablet7'), 3, 616, `${lang.toUpperCase()}  7-inch tablet 1920 x 1080`);
    await put(of('tablet10'), 3, 616, `${lang.toUpperCase()}  10-inch tablet 2560 x 1440`);
    return sharp({ create: { width: W, height: y + GAP, channels: 3, background: '#8A84A0' } }).composite(comp).png().toBuffer();
  };
  const sheets = [];
  for (const lang of langs) {
    const buf = await sheetFor(lang);
    await sharp(buf).webp({ quality: 84 }).toFile(path.join(root, 'export', `contact-${lang}.webp`));
    sheets.push(buf);
    console.log(`store contact-${lang}.webp`);
  }
  if (sheets.length > 1) {
    const metas = await Promise.all(sheets.map((b) => sharp(b).metadata()));
    let y = 0;
    const comp = sheets.map((b, i) => { const c = { input: b, left: 0, top: y }; y += metas[i].height; return c; });
    await sharp({ create: { width: W, height: y, channels: 3, background: '#8A84A0' } }).composite(comp).webp({ quality: 82 }).toFile(path.join(root, 'export', 'contact.webp'));
    console.log('store contact.webp');
  }
}

await writeFile(path.join(root, 'export', 'report.json'), `${JSON.stringify({
  note: 'Written by design/tools/render-store.mjs. Play rules checked: 24-bit PNG without alpha; feature graphic 1024 x 500; phone screenshots 320 to 3840 px per side, long side at most twice the short side (here 1080 x 1920, 9:16); tablet screenshots 1080 to 7680 px per side at 16:9 (here landscape: 1920 x 1080 for 7-inch, 2560 x 1440 for 10-inch); 2 to 8 per device type (4 or more for tablets).',
  devices: Object.fromEntries(Object.entries(DEVICES).map(([k, v]) => [k, { appViewportCssPx: `${v.w} x ${v.h}`, pixelRatio: 2, label: v.label }])),
  files: inventory.map((f) => ({ file: `export/${f.lang}/${f.name}`, size: `${f.w} x ${f.h}`, bytes: f.bytes, channels: f.channels, alpha: f.alpha })),
  problems,
}, null, 2)}\n`);
console.log(`${inventory.length} files, ${(inventory.reduce((a, f) => a + f.bytes, 0) / 1048576).toFixed(1)} MB in all, ${problems.length ? `${problems.length} PROBLEM(S):\n  ${problems.join('\n  ')}` : 'every Play rule holds'}`);
process.exit(problems.length ? 1 : 0);
