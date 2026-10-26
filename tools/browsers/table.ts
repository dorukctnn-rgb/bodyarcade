// Turns the JSON of Playwright's reporter into the table of the browser matrix: one row per flow, one column per browser and size,
// and under it the failures with what they said and the pictures to look at. Pure functions (table.test.ts), used by run.ts.
export interface JsonResult { status: string; duration: number; error?: { message?: string }; errors?: { message?: string }[]; attachments?: { name: string; path?: string; contentType?: string }[]; retry: number }
export interface JsonTest { projectName: string; status: string; annotations?: { type: string; description?: string }[]; results: JsonResult[] }
export interface JsonSpec { title: string; ok: boolean; file?: string; tests: JsonTest[] }
export interface JsonSuite { title: string; file?: string; specs?: JsonSpec[]; suites?: JsonSuite[] }
export interface JsonReport { suites: JsonSuite[] }

export type Outcome = 'ok' | 'FAIL' | 'flaky' | 'skip' | 'n/a';

export interface Cell {
  project: string;
  outcome: Outcome;
  seconds: number;
  /** The first lines of what went wrong. */
  message: string;
  /** Pictures: the ones the flow saved (annotation `shot`) and the one Playwright took when it failed. */
  shots: string[];
  /** Other things the flow noted (phases of a camera round, which stage the tour drew). */
  notes: string[];
}

export interface Row { flow: string; spec: string; cells: Cell[] }

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
export const clean = (s: string): string => s.replace(ANSI, '').replace(/\r/g, '');

/**
 * Failures that are the test tool's limit on an engine and say nothing about the app: Playwright cannot grant the camera permission in
 * Firefox ("Unknown permission: camera") nor the clipboard permissions in WebKit ("Unknown permission: clipboard-write"), so a spec
 * written for Chromium that begins by granting them stops there.
 */
const NOT_APPLICABLE: RegExp[] = [/Unknown permission: camera/, /Unknown permission: clipboard-(?:write|read)/];

function outcomeOf(t: JsonTest): Outcome {
  if (t.status === 'skipped') return 'skip';
  if (t.status === 'flaky') return 'flaky';
  if (t.status === 'expected') return 'ok';
  const r = t.results[t.results.length - 1];
  const text = clean(r?.error?.message ?? r?.errors?.[0]?.message ?? '');
  return NOT_APPLICABLE.some((x) => x.test(text)) ? 'n/a' : 'FAIL';
}

/**
 * The message of the last result (of a flaky test: of the first one that failed, the one that passed has none), without colour codes
 * and without the call log, shortened.
 */
export function messageOf(t: JsonTest, max = 420): string {
  const r = t.status === 'flaky' ? t.results.find((x) => x.status !== 'passed' && x.status !== 'skipped') ?? t.results[0] : t.results[t.results.length - 1];
  const raw = r?.error?.message ?? r?.errors?.[0]?.message ?? '';
  const lines = clean(raw).split('\n').map((l) => l.trim()).filter(Boolean);
  const cut = lines.findIndex((l) => /^(Call log|at |Error Context)/.test(l));
  const head = (cut >= 0 ? lines.slice(0, cut) : lines).join(' | ');
  return head.length > max ? `${head.slice(0, max - 1)}...` : head;
}

export function rowsOf(report: JsonReport): Row[] {
  const rows = new Map<string, Row>();
  const walk = (s: JsonSuite, path: string[]): void => {
    const here = s.file && !path.length ? [] : [...path, s.title].filter((x) => x && !/\.spec\.ts$/.test(x));
    for (const spec of s.specs ?? []) {
      const flow = [...here, spec.title].join(' > ');
      const key = `${s.file ?? ''}|${flow}`;
      const row = rows.get(key) ?? { flow, spec: (spec.file ?? s.file ?? '').replace(/\\/g, '/'), cells: [] };
      for (const t of spec.tests) {
        const last = t.results[t.results.length - 1];
        const shots = (t.annotations ?? []).filter((a) => a.type === 'shot').map((a) => a.description ?? '');
        for (const a of last?.attachments ?? []) if (/screenshot/i.test(a.name) && a.path) shots.push(a.path.replace(/\\/g, '/'));
        row.cells.push({
          project: t.projectName, outcome: outcomeOf(t), seconds: Math.round((t.results.reduce((n, r) => n + r.duration, 0)) / 100) / 10,
          message: outcomeOf(t) === 'FAIL' || outcomeOf(t) === 'flaky' ? messageOf(t) : '',
          shots, notes: (t.annotations ?? []).filter((a) => a.type !== 'shot').map((a) => `${a.type}: ${a.description ?? ''}`),
        });
      }
      rows.set(key, row);
    }
    for (const c of s.suites ?? []) walk(c, here);
  };
  for (const s of report.suites) walk(s, []);
  return [...rows.values()];
}

export function projectsOf(rows: readonly Row[]): string[] {
  const seen: string[] = [];
  for (const r of rows) for (const c of r.cells) if (!seen.includes(c.project)) seen.push(c.project);
  const order = (p: string): number => (/webkit/.test(p) ? 0 : /firefox/.test(p) ? 1 : 2) * 10 + (/phone/.test(p) ? 0 : 1);
  return seen.sort((a, b) => order(a) - order(b));
}

/** The table as Markdown: flows down, projects across. */
export function tableMarkdown(rows: readonly Row[], title = 'Browser matrix'): string {
  const projects = projectsOf(rows);
  const out: string[] = [`### ${title}`, '', `| flow | ${projects.join(' | ')} |`, `|---|${projects.map(() => '---').join('|')}|`];
  for (const r of rows) {
    out.push(`| ${r.flow.replace(/\|/g, '/')} | ${projects.map((p) => { const c = r.cells.find((x) => x.project === p); return c ? c.outcome : '-'; }).join(' | ')} |`);
  }
  const total = rows.flatMap((r) => r.cells);
  const count = (o: Outcome): number => total.filter((c) => c.outcome === o).length;
  out.push('', `${total.length} runs: ${count('ok')} ok, ${count('FAIL')} failed, ${count('flaky')} flaky, ${count('skip')} skipped${count('n/a') ? `, ${count('n/a')} not applicable (the tool cannot do it on that engine)` : ''}.`);
  const bad = rows.flatMap((r) => r.cells.filter((c) => c.outcome === 'FAIL' || c.outcome === 'flaky').map((c) => ({ r, c })));
  if (bad.length) {
    out.push('', '#### Failures', '');
    for (const { r, c } of bad) {
      out.push(`- ${c.project}: ${r.flow}${c.outcome === 'flaky' ? ' (flaky: failed first, passed on retry)' : ''}`);
      if (c.message) out.push(`  - ${c.message}`);
      if (c.notes.length) out.push(`  - ${c.notes.join('; ')}`);
      if (c.shots.length) out.push(`  - pictures: ${c.shots.slice(-3).join(', ')}`);
    }
  }
  return out.join('\n');
}
