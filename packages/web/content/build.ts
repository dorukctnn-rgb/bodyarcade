// Writes the content pages (the policies, the FAQ, the guides, the blog) and the files they share into site/, where the
// release build picks them up (release/assemble.ts: LEGACY_PAGES for the pages, the whole assets folder for the rest).
//
//   node packages/web/content/build.ts            write what changed
//   node packages/web/content/build.ts --check    change nothing; list what is out of date and exit 1 if anything is
//
// The pages are generated from copy/*.ts and chrome.ts, so site/*.html are build products: edit the sources, run this, and
// commit both. content.test.ts runs the check, so a page that was edited by hand or a source that was changed without a
// rebuild fails the test run.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OG_IMAGE, renderPage, type PageSpec } from './chrome.ts';
import { allPages } from './copy/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..', '..');

export interface Output {
  /** Path under site/. */
  file: string;
  content: Buffer;
  /** Text files are compared without regard to line endings (a checkout on Windows turns LF into CRLF). */
  text: boolean;
}

/** The brand files the pages show, copied from the art director's folder (design/). */
const SHARED: readonly { from: string; to: string; text: boolean }[] = [
  { from: 'packages/web/content/content.css', to: 'assets/content.css', text: true },
  { from: 'design/brand/logo.svg', to: 'assets/brand/logo.svg', text: true },
  { from: 'design/brand/logo-dark.svg', to: 'assets/brand/logo-dark.svg', text: true },
  { from: 'design/store/export/feature-graphic.png', to: `assets/brand/${OG_IMAGE.file}`, text: false },
];

export function pages(): PageSpec[] {
  return allPages();
}

export function build(root: string = REPO_ROOT): Output[] {
  const out: Output[] = pages().map((p) => ({ file: p.file, content: Buffer.from(renderPage(p), 'utf8'), text: true }));
  for (const s of SHARED) out.push({ file: s.to, content: readFileSync(join(root, s.from)), text: s.text });
  return out;
}

const normal = (b: Buffer, text: boolean): string => (text ? b.toString('utf8').replace(/\r\n/g, '\n') : b.toString('latin1'));

/** The files under site/ that are missing or differ from what the sources produce. */
export function outOfDate(root: string = REPO_ROOT, outputs: Output[] = build(root)): string[] {
  const stale: string[] = [];
  for (const o of outputs) {
    const path = join(root, 'site', o.file);
    if (!existsSync(path)) { stale.push(o.file); continue; }
    if (normal(readFileSync(path), o.text) !== normal(o.content, o.text)) stale.push(o.file);
  }
  return stale;
}

/** Writes every file that is out of date; returns their names. */
export function write(root: string = REPO_ROOT): string[] {
  const outputs = build(root);
  const stale = outOfDate(root, outputs);
  for (const o of outputs) {
    if (!stale.includes(o.file)) continue;
    const path = join(root, 'site', o.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, o.content);
  }
  return stale;
}

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (direct) {
  if (process.argv.includes('--check')) {
    const stale = outOfDate();
    for (const f of stale) console.error(`out of date: site/${f}`);
    console.log(stale.length === 0 ? 'the content pages are up to date' : `${stale.length} file(s) out of date: run node packages/web/content/build.ts`);
    process.exit(stale.length === 0 ? 0 : 1);
  }
  const changed = write();
  console.log(changed.length === 0 ? 'nothing to write: the content pages are up to date' : `wrote ${changed.length} file(s): ${changed.join(', ')}`);
}
