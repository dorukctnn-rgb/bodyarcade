import { describe, expect, it } from 'vitest';
import type { PageResult } from './run.ts';
import { buildSection, END, replaceSection, START } from './notes.ts';
import { collect, type Report } from './summarize.ts';

const res = (target: string, size: string, o: Partial<PageResult> = {}): PageResult => ({
  target, size, w: 360, h: 780, errors: 0, warnings: 0, findings: [], messages: [], probe: [], probeWarn: [], shot: `${target.replace(/:/g, '-')}/${size}.jpg`, ms: 10, stats: null, ...o,
});
const overlap = (a: string, b: string): PageResult['findings'][number] => ({ kind: 'overlap', severity: 'error', message: `${a} overlaps ${b} (12x16px)`, at: a, with: b });

const report = (results: PageResult[]): Report => ({ generated: '2026-10-24T08:00:00.000Z', lang: 'en', dark: false, sizes: ['phone-360', 'laptop-1280'], checked: results.length, failing: results.filter((r) => r.errors).length, results });

describe('collect', () => {
  it('lists one entry per page and problem, with the sizes it shows at', () => {
    const f = overlap('span "11 games"', 'button "Seated"');
    const { entries, errors } = collect(report([
      res('web:home', 'phone-360', { errors: 1, findings: [f] }),
      res('web:home', 'laptop-1280', { errors: 1, findings: [{ ...f, message: 'span "11 games" overlaps button "Seated" (96x16px)' }] }),
      res('web:pro', 'laptop-1280', { messages: ['console.warn: slow'], warnings: 1 }),
    ]));
    expect(errors).toBe(2);
    const home = entries.filter((e) => e.page === 'web:home');
    expect(home).toHaveLength(1);
    expect(home[0]?.sizes).toEqual(['phone-360', 'laptop-1280']);
    expect(entries.find((e) => e.page === 'web:pro')?.severity).toBe('warn');
  });

  it('counts a probe line as a game error and a warn: line as a warning', () => {
    const { entries } = collect(report([res('web:play:x', 'phone-360', { errors: 1, probe: ['the round did not start: nope'], probeWarn: ['practice session'] })]));
    expect(entries.map((e) => `${e.severity}:${e.kind}`).sort()).toEqual(['error:game', 'warn:game']);
  });
});

describe('notes section', () => {
  const bad = report([res('web:home', 'phone-360', { errors: 1, findings: [overlap('a', 'b')] })]);
  const state = (keys: string[]): { at: string; commit: string; keys: string[] } => ({ at: '2026-10-24T07:00:00.000Z', commit: 'old1234', keys });

  it('says what is new and what is gone since the run before', () => {
    const first = buildSection(bad, { label: 'en', commit: 'abc1234', max: 40, previous: undefined });
    expect(first.body).toContain('### en');
    expect(first.body).toContain('web:home');
    expect(first.body).not.toContain('NEW');
    const worse = report([res('web:home', 'phone-360', { errors: 2, findings: [overlap('a', 'b'), overlap('c', 'd')] })]);
    const next = buildSection(worse, { label: 'en', commit: 'def5678', max: 40, previous: state(first.keys) });
    expect(next.body).toContain('NEW overlap');
    expect(next.body).toContain('1 new, 0 gone');
    const better = buildSection(report([res('web:home', 'phone-360')]), { label: 'en', commit: 'fff9999', max: 40, previous: state(first.keys) });
    expect(better.body).toContain('No errors.');
    expect(better.body).toContain('Gone since the run before: 1');
  });

  it('replaces its own section and nothing else, and keeps the line endings', () => {
    const notes = 'BURADAN DEVAM: x\n\n# NOTLAR\n\nText below.\n';
    const once = replaceSection(notes, '## LAUNCH FINDINGS\nfirst');
    expect(once.startsWith('BURADAN DEVAM: x\n\n')).toBe(true);
    expect(once).toContain(START);
    expect(once.indexOf(START)).toBeLessThan(once.indexOf('# NOTLAR'));
    const twice = replaceSection(once, '## LAUNCH FINDINGS\nsecond');
    expect(twice.split(START)).toHaveLength(2);
    expect(twice).toContain('second');
    expect(twice).not.toContain('first');
    expect(twice).toContain('Text below.');
    expect(twice.endsWith(`${END}\n\n# NOTLAR\n\nText below.\n`) || twice.includes(`${END}\n\n# NOTLAR`)).toBe(true);
    const crlf = replaceSection(notes.replace(/\n/g, '\r\n'), 'x');
    expect(crlf).toContain('\r\n');
    expect(crlf.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('merge', () => {
  it('keeps what a smaller run did not check again and points to the old pictures', async () => {
    const { mergeReports } = await import('./summarize.ts');
    const old = report([res('web:home', 'phone-360', { errors: 1, findings: [overlap('a', 'b')] }), res('web:play:x', 'phone-360', { errors: 1, probe: ['old problem'] })]);
    const fresh = report([res('web:play:x', 'phone-360')]);
    const merged = mergeReports(fresh, old, { fresh: 'C:/runs/new', old: 'C:/runs/old' });
    expect(merged.results.map((r) => `${r.target}@${r.size}`)).toEqual(['web:home@phone-360', 'web:play:x@phone-360']);
    expect(merged.results[0]?.shot).toBe('../old/web-home/phone-360.jpg');
    expect(merged.results.find((r) => r.target === 'web:play:x')?.errors).toBe(0);
    expect(merged.failing).toBe(1);
  });
});
