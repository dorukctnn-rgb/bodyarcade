// Writes the result of a page-check run into the QA notes file, under "LAUNCH FINDINGS", so that builders see what to fix
// and what is new since the last run. The section sits between two marker lines and is replaced on every call.
//
//   node tools/page-check/notes.ts qa-out/run2-web/report.json --notes <NOTLAR-qa.md> [--commit abc1234] [--label "web, en"]
//        [--state qa-out/page-check-state.json] [--max 40] [--game-notes "text appended below the list"]
//
// The state file keeps the problems of the last call per label, so the section can say which are new and which are gone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, sizesText, type Report } from './summarize.ts';

export const START = '<!-- LAUNCH FINDINGS START (written by tools/page-check/notes.ts, do not edit by hand) -->';
export const END = '<!-- LAUNCH FINDINGS END -->';

interface State { [label: string]: { at: string; commit: string; keys: string[]; body?: string } }

/** Replaces the marked section of a notes text (or adds it before the first "## " heading after the first line). */
export function replaceSection(notes: string, body: string): string {
  const nl = notes.includes('\r\n') ? '\r\n' : '\n';
  const text = notes.replace(/\r\n/g, '\n');
  const block = `${START}\n${body.trim()}\n${END}`;
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  let out: string;
  if (a >= 0 && b > a) out = text.slice(0, a) + block + text.slice(b + END.length);
  else {
    const firstHeading = text.indexOf('\n# ');
    out = firstHeading >= 0 ? `${text.slice(0, firstHeading + 1)}${block}\n\n${text.slice(firstHeading + 1)}` : `${text}\n${block}\n`;
  }
  return nl === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

export function buildSection(report: Report, o: { label: string; commit: string; max: number; previous: State[string] | undefined; extra?: string; base?: string }): { body: string; keys: string[]; errors: number } {
  const { entries, errors, warnings } = collect(report);
  const errs = entries.filter((e) => e.severity === 'error');
  const warns = entries.filter((e) => e.severity === 'warn');
  const keys = errs.map((e) => e.key);
  const before = new Set(o.previous?.keys ?? []);
  const now = new Set(keys);
  const fresh = errs.filter((e) => o.previous && !before.has(e.key));
  const gone = [...before].filter((k) => !now.has(k));
  const lines: string[] = [];
  lines.push(`### ${o.label}`);
  lines.push('');
  lines.push(`Last run: ${report.generated.slice(0, 16).replace('T', ' ')} UTC, ${o.label}, v2 at ${o.commit || 'unknown'}: ${report.checked} screens (${report.sizes.length} sizes), ${errs.length} different error(s) on ${report.failing} screen(s), ${warns.length} warning(s)${o.previous ? `; since the run before (${o.previous.at.slice(0, 16).replace('T', ' ')}, ${o.previous.commit || '?'}): ${fresh.length} new, ${gone.length} gone` : ''}.`);
  lines.push(`Repeat: \`node tools/page-check/run.ts --groups web --jobs 4 --out qa-out/run-web\`, then \`node tools/page-check/notes.ts qa-out/run-web/report.json --notes <this file>\`. Pictures: ${o.base ?? '<run folder>'}/<page>/<size>.jpg in the worktree C:\\Users\\doruk\\apps\\_wt\\bodyarcade-v2-qa. ${errors} error hit(s), ${warnings} warning hit(s) in all.`);
  lines.push('');
  if (!errs.length) lines.push('No errors.');
  const pages = new Map<string, typeof errs>();
  for (const e of errs) pages.set(e.page, [...(pages.get(e.page) ?? []), e]);
  for (const [page, list] of pages) {
    lines.push(`- ${page}`);
    for (const e of list.slice(0, o.max)) {
      const first = e.shots[e.sizes[0] as string];
      lines.push(`  - ${fresh.includes(e) ? 'NEW ' : ''}${e.kind}: ${e.text}${e.at ? ` [element: ${e.at}]` : ''}. Sizes: ${sizesText(e, report)}${first ? `. Picture: ${o.base ? `${o.base}/` : ''}${first}` : ''}`);
    }
    if (list.length > o.max) lines.push(`  - ... ${list.length - o.max} more`);
  }
  if (gone.length) { lines.push(''); lines.push(`Gone since the run before: ${gone.length}.`); }
  if (warns.length) {
    lines.push('');
    lines.push('Warnings (not blocking, look at them):');
    const wp = new Map<string, typeof warns>();
    for (const e of warns) wp.set(e.page, [...(wp.get(e.page) ?? []), e]);
    let shown = 0;
    for (const [page, list] of wp) {
      for (const e of list.slice(0, 3)) { if (shown++ < 25) lines.push(`  - ${page} ${e.kind}: ${e.text}${e.at ? ` [element: ${e.at}]` : ''}. Sizes: ${sizesText(e, report)}`); }
    }
    if (shown > 25) lines.push(`  - ... more in FINDINGS.md of the run`);
  }
  if (o.extra) { lines.push(''); lines.push(o.extra); }
  return { body: lines.join('\n'), keys, errors: errs.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const reportPath = resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--'))) ?? 'qa-out/page-check/report.json');
  const notesPath = opt('notes');
  if (!notesPath) { console.error('usage: node tools/page-check/notes.ts <report.json> --notes <file> [--commit hash] [--label text] [--state file] [--max 40]'); process.exit(2); }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
  const label = opt('label') ?? `${report.lang}${report.dark ? ', dark' : ''}`;
  const statePath = resolve(opt('state') ?? 'qa-out/page-check-state.json');
  const state: State = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : {};
  const commit = opt('commit') ?? '';
  const base = relative(process.cwd(), dirname(reportPath)).split('\\').join('/');
  const { body, keys } = buildSection(report, { label, commit, max: Number(opt('max') ?? 40), previous: state[label], base, ...(opt('extra') ? { extra: readFileSync(resolve(opt('extra') as string), 'utf8') } : {}) });
  const notes = readFileSync(resolve(notesPath), 'utf8');
  state[label] = { at: report.generated, commit, keys, body };
  const all = Object.keys(state).sort().map((k) => state[k]?.body ?? '').filter(Boolean).join('\n\n');
  const intro = '## LAUNCH FINDINGS\n\nWhat the page checker found on every page and game of v2 at the ten screen sizes (360x780 up to 1920x1080). Builders: fix the errors of your screens, then tell me or wait for the next run. NEW marks what appeared since the run before.\n';
  writeFileSync(resolve(notesPath), replaceSection(notes, `${intro}\n${all}`));
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state));
  console.log(`notes updated: ${notesPath} (${keys.length} error(s))`);
}
