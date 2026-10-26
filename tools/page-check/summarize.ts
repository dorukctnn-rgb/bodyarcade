// Turns a page-check report.json into a list a builder can work through: one entry per page and problem, with the
// screen sizes it shows at, the element, and the picture to look at.
//
//   node tools/page-check/summarize.ts [qa-out/page-check/report.json] [--md out.md] [--warnings] [--max 60]
//
// Without --warnings only errors are listed (warnings are counted). The exit code is 1 when there is any error.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { BREAKPOINTS } from '../../packages/core/ui/layout.ts';
import { fileURLToPath } from 'node:url';
import type { PageResult } from './run.ts';

export interface Report { generated: string; lang: string; dark: boolean; sizes: string[]; checked: number; failing: number; results: PageResult[] }

/**
 * A run of a few pages or sizes added to the report of an earlier run: what was checked again takes the place of the old result
 * of the same page and size, everything else stays (its picture is found by a path from the new folder to the old one).
 */
export function mergeReports(fresh: Report, old: Report, dirs: { fresh: string; old: string }): Report {
  const have = new Set(fresh.results.map((r) => `${r.target}|${r.size}`));
  const carried = old.results.filter((r) => !have.has(`${r.target}|${r.size}`)).map((r) => ({ ...r, shot: r.shot ? relative(dirs.fresh, join(dirs.old, r.shot)).split('\\').join('/') : null }));
  const sizes = BREAKPOINTS.map((b) => b.id);
  const results = [...fresh.results, ...carried].sort((a, b) => a.target.localeCompare(b.target) || sizes.indexOf(a.size) - sizes.indexOf(b.size));
  return { ...fresh, sizes, checked: results.length, failing: results.filter((r) => r.errors > 0).length, results, carried: carried.length } as Report & { carried: number };
}

export interface Entry {
  page: string;
  severity: 'error' | 'warn';
  kind: string;
  text: string;
  /** The element(s) the finding is about. */
  at: string;
  sizes: string[];
  /** The picture of each size (relative to the report folder). */
  shots: Record<string, string | null>;
  /** The same problem on another size or in another language counts once: the text with its numbers taken out. */
  key: string;
}

export function collect(report: Report): { entries: Entry[]; errors: number; warnings: number } {
  const byKey = new Map<string, Entry>();
  let errors = 0;
  let warnings = 0;
  const add = (page: string, severity: Entry['severity'], kind: string, text: string, at: string, size: string, shot: string | null): void => {
    const key = `${page}|${severity}|${kind}|${at.replace(/-?\d+(\.\d+)?/g, '#')}|${text.replace(/-?\d+(\.\d+)?/g, '#')}`;
    const e = byKey.get(key);
    if (e) { if (!e.sizes.includes(size)) { e.sizes.push(size); e.shots[size] = shot; } return; }
    byKey.set(key, { page, severity, kind, text, at, sizes: [size], shots: { [size]: shot }, key });
  };
  for (const r of report.results) {
    for (const f of r.findings) {
      add(r.target, f.severity, f.kind, f.message, f.with ? `${f.at} with ${f.with}` : f.at, r.size, r.shot);
      if (f.severity === 'error') errors++; else warnings++;
    }
    for (const m of r.messages) {
      const warn = m.startsWith('console.warn');
      add(r.target, warn ? 'warn' : 'error', warn ? 'console' : m.startsWith('uncaught') ? 'uncaught' : m.startsWith('could not check') ? 'page' : 'network', m, '', r.size, r.shot);
      if (warn) warnings++; else errors++;
    }
    for (const p of r.probe ?? []) { add(r.target, 'error', 'game', p, '', r.size, r.shot); errors++; }
    for (const p of r.probeWarn ?? []) { add(r.target, 'warn', 'game', p, '', r.size, r.shot); warnings++; }
  }
  const order = new Map(report.sizes.map((s, i) => [s, i]));
  const entries = [...byKey.values()].map((e) => ({ ...e, sizes: e.sizes.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) }));
  entries.sort((a, b) => a.page.localeCompare(b.page) || (a.severity === b.severity ? a.kind.localeCompare(b.kind) : a.severity === 'error' ? -1 : 1));
  return { entries, errors, warnings };
}

/** "all sizes" or the list. */
export const sizesText = (e: Entry, report: Report): string => (e.sizes.length === report.sizes.length ? 'all sizes' : e.sizes.join(', '));

export function renderMarkdown(report: Report, root: string, opts: { warnings: boolean; max: number }): { text: string; errors: number; warnings: number } {
  const { entries, errors, warnings } = collect(report);
  const lines: string[] = [];
  const pages = new Map<string, Entry[]>();
  for (const e of entries) {
    if (!opts.warnings && e.severity !== 'error') continue;
    pages.set(e.page, [...(pages.get(e.page) ?? []), e]);
  }
  for (const [page, list] of pages) {
    lines.push(`### ${page}`);
    for (const e of list.slice(0, opts.max)) {
      const first = e.shots[e.sizes[0] as string];
      const shot = first ? ` Picture: ${relative(process.cwd(), join(root, first)).split('\\').join('/')}` : '';
      lines.push(`- ${e.severity === 'error' ? 'ERROR' : 'warn'} ${e.kind}: ${e.text}${e.at ? ` (element: ${e.at})` : ''}. Sizes: ${sizesText(e, report)}.${shot}`);
    }
    if (list.length > opts.max) lines.push(`- ... ${list.length - opts.max} more on this page`);
  }
  const head = `${report.checked} screen(s) at ${report.sizes.length} size(s), language ${report.lang}${report.dark ? ', dark' : ''}, ${report.generated.slice(0, 16).replace('T', ' ')} UTC: ${errors} error(s), ${warnings} warning(s) on ${report.failing} screen(s) with errors.`;
  return { text: `${head}\n\n${lines.length ? lines.join('\n') : 'No errors.'}\n`, errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--md', '--max'].includes(args[i - 1] as string)));
  const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const reportPath = resolve(positional[0] ?? 'qa-out/page-check/report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
  const r = renderMarkdown(report, dirname(reportPath), { warnings: args.includes('--warnings'), max: Number(opt('max') ?? 60) });
  const md = opt('md');
  if (md) writeFileSync(resolve(md), r.text); else process.stdout.write(r.text);
  process.exit(r.errors ? 1 : 0);
}
