// Several runs of the browser matrix in one table: this laptop (Windows) and the GitHub runners (macOS, Linux) have different engine builds, and
// the question "does it work in Safari" is answered by the macOS column, "in Firefox" by every Firefox column. Each argument is label=results.json.
//   (--compact: one column per environment and engine, phone / desktop in one cell)
//   node tools/browsers/merge.ts --out table.md win=qa-out/browsers/results.json mac=ci/mac-webkit/results.json linux=ci/linux-webkit/results.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rowsOf, tableMarkdown, type JsonReport, type Outcome, type Row } from './table.ts';

/** Rows of several reports, the project names prefixed with the label of the report (win-webkit-phone, mac-webkit-phone), one row per flow. */
export function mergeRows(reports: { label: string; report: JsonReport }[]): Row[] {
  const rows = new Map<string, Row>();
  for (const { label, report } of reports) {
    for (const r of rowsOf(report)) {
      const row = rows.get(r.flow) ?? { flow: r.flow, spec: r.spec, cells: [] };
      for (const c of r.cells) row.cells.push({ ...c, project: `${label}-${c.project}` });
      rows.set(r.flow, row);
    }
  }
  return [...rows.values()];
}


const SHORT: Record<Outcome, string> = { ok: 'ok', FAIL: 'FAIL', flaky: 'flaky', skip: 'skip', 'n/a': 'n/a' };

/**
 * The same rows with one column per environment and engine (win webkit, mac webkit, linux firefox...) and the phone and the desktop in one cell
 * ("ok / FAIL": 390x844 first, 1440x900 second), for a report that has to fit on a page.
 */
export function compactMarkdown(rows: readonly Row[], title = 'Browser x flow (390x844 / 1440x900)'): string {
  const columns: string[] = [];
  const cell = (r: Row, col: string): string => {
    const get = (size: string): string => {
      const c = r.cells.find((x) => x.project === `${col}-${size}`);
      return c ? SHORT[c.outcome] : '-';
    };
    return `${get('phone')} / ${get('desktop')}`;
  };
  for (const r of rows) for (const c of r.cells) { const m = /^(.+)-(phone|desktop)$/.exec(c.project); if (m && !columns.includes(m[1] as string)) columns.push(m[1] as string); }
  const out = [`### ${title}`, '', `| flow | ${columns.join(' | ')} |`, `|---|${columns.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.flow.replace(/\|/g, '/')} | ${columns.map((c) => cell(r, c)).join(' | ')} |`);
  return out.join('\n');
}

if (process.argv[1] && /merge\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : undefined;
  const reports = args.filter((a, i) => !a.startsWith('--') && i !== outAt + 1 && a.includes('=')).map((a) => {
    const eq = a.indexOf('=');
    return { label: a.slice(0, eq), report: JSON.parse(readFileSync(resolve(a.slice(eq + 1)), 'utf8')) as JsonReport };
  });
  const rows = mergeRows(reports);
  const md = args.includes('--compact') ? compactMarkdown(rows) : tableMarkdown(rows, 'Browser matrix, all runs');
  if (out) writeFileSync(resolve(out), md);
  console.log(md);
}
