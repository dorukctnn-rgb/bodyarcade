// The reading tool asks for the datasets the Worker writes, with queries that cannot be bent by what is typed, and prints plain numbers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PING_BINDINGS } from '../../packages/server/src/site/ping.ts';

interface Tool {
  EVENTS: string[];
  datasetOf(event: string, preview?: boolean): string;
  totalsRequest(account: string, dataset: string, days: number, now?: number): { query: string; variables: Record<string, string> };
  totalsOf(answer: unknown): { date: string; count: number }[];
  sqlFor(dataset: string, days: number): string;
  gamesOf(answer: unknown): { game: string; rounds: number }[];
  render(r: { days: number; totals: Record<string, { date: string; count: number }[]>; games?: Record<string, { game: string; rounds: number }[]> }): string;
  parseArgs(argv: string[], env?: Record<string, string>): { days: number; preview: boolean; sql: boolean; json: boolean; visits: boolean; host: string; account: string; tokenFile: string };
}
const tool = async (): Promise<Tool> => (await import(/* @vite-ignore */ new URL('./read.mjs', import.meta.url).href)) as Tool;
const ROOT = new URL('../../', import.meta.url);
const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('tools/signals/read.mjs', () => {
  it('asks for exactly the datasets the wrangler configs bind, preview and production', async () => {
    const t = await tool();
    expect(t.EVENTS).toEqual(Object.keys(PING_BINDINGS));
    for (const [file, preview] of [['wrangler.prod.jsonc', false], ['wrangler.jsonc', true]] as const) {
      const cfg = JSON.parse(readFileSync(new URL(file, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { analytics_engine_datasets: { binding: string; dataset: string }[] };
      for (const event of t.EVENTS) {
        const binding = PING_BINDINGS[event as keyof typeof PING_BINDINGS];
        expect(cfg.analytics_engine_datasets.find((d) => d.binding === binding)?.dataset, `${file} ${event}`).toBe(t.datasetOf(event, preview));
      }
    }
    expect(() => t.datasetOf('page_view')).toThrow();
  });

  it('builds the daily totals request for the last N days, today included, with the values as variables', async () => {
    const t = await tool();
    const now = Date.UTC(2026, 10, 4, 12, 0, 0);
    const r = t.totalsRequest(ACCOUNT, 'bodyarcade_game_start', 7, now);
    expect(r.variables).toEqual({ acc: ACCOUNT, set: 'bodyarcade_game_start', from: '2026-10-29', to: '2026-11-04' });
    expect(r.query).toContain('workersAnalyticsEngineAdaptiveGroups');
    expect(r.query).not.toContain(ACCOUNT);
    expect(t.totalsRequest(ACCOUNT, 'x', 500, now).variables.from).toBe('2026-08-07');
    expect(t.totalsRequest(ACCOUNT, 'x', 0, now).variables.from).toBe('2026-11-04');
    expect(() => t.totalsRequest('not-an-id', 'x', 7)).toThrow();
  });

  it('reads the daily totals and the per-game rows out of the two answers, and survives an empty or odd answer', async () => {
    const t = await tool();
    const answer = { data: { viewer: { accounts: [{ workersAnalyticsEngineAdaptiveGroups: [{ count: 12, dimensions: { date: '2026-11-03' } }, { count: 30, dimensions: { date: '2026-11-04' } }] }] } } };
    expect(t.totalsOf(answer)).toEqual([{ date: '2026-11-03', count: 12 }, { date: '2026-11-04', count: 30 }]);
    expect(t.totalsOf({ data: { viewer: { accounts: [{ workersAnalyticsEngineAdaptiveGroups: [] }] } } })).toEqual([]);
    expect(t.totalsOf(null)).toEqual([]);
    expect(t.gamesOf({ data: [{ game: 'road-run', rounds: '5' }, { game: 'knee-sprint', rounds: 2 }] })).toEqual([{ game: 'road-run', rounds: 5 }, { game: 'knee-sprint', rounds: 2 }]);
    expect(t.gamesOf({})).toEqual([]);
  });

  it('asks Web Analytics for the page views and visits of one host per day, and reads them back', async () => {
    const t = (await tool()) as Tool & {
      visitsRequest(account: string, host: string, days: number, now?: number): { query: string; variables: Record<string, string> };
      visitsOf(answer: unknown): { date: string; views: number; visits: number }[];
    };
    const r = t.visitsRequest(ACCOUNT, 'bodyarcade.com', 3, Date.UTC(2026, 10, 4, 9, 0, 0));
    expect(r.variables).toEqual({ acc: ACCOUNT, host: 'bodyarcade.com', from: '2026-11-02', to: '2026-11-04' });
    expect(r.query).toContain('rumPageloadEventsAdaptiveGroups');
    expect(() => t.visitsRequest(ACCOUNT, 'bodyarcade.com" } }', 3)).toThrow();
    expect(t.visitsOf({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: [{ count: 40, sum: { visits: 25 }, dimensions: { date: '2026-11-04' } }] }] } } })).toEqual([{ date: '2026-11-04', views: 40, visits: 25 }]);
    expect(t.visitsOf({})).toEqual([]);
    const text = t.render({ days: 3, totals: { game_start: [], run_finished: [] }, visits: [{ date: '2026-11-04', views: 40, visits: 25 }] } as never);
    expect(text).toContain('2026-11-04      40      25');
    expect(t.render({ days: 3, totals: { game_start: [], run_finished: [] }, visits: [] } as never)).toContain('Web Analytics: no visits counted yet');
  });

  it('writes the per-game SQL for one dataset only, and refuses a name that is not one of ours', async () => {
    const t = await tool();
    const q = t.sqlFor('bodyarcade_run_finished', 7);
    expect(q).toBe("SELECT blob1 AS game, SUM(_sample_interval) AS rounds FROM bodyarcade_run_finished WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY game ORDER BY rounds DESC LIMIT 100 FORMAT JSON");
    expect(t.sqlFor('bodyarcade_game_start_preview', 400)).toContain("INTERVAL '90' DAY");
    for (const bad of ['users', 'bodyarcade_x; DROP', 'bodyarcade_x y', '', 'BODYARCADE_X']) expect(() => t.sqlFor(bad, 7), bad).toThrow();
  });

  it('prints a plain table, or says that nothing was counted yet', async () => {
    const t = await tool();
    expect(t.render({ days: 7, totals: { game_start: [], run_finished: [] } })).toBe('Game signal, last 7 day(s)\n\nno rounds counted yet');
    const text = t.render({
      days: 7,
      totals: { game_start: [{ date: '2026-11-03', count: 12 }, { date: '2026-11-04', count: 30 }], run_finished: [{ date: '2026-11-04', count: 21 }] },
      games: { game_start: [{ game: 'road-run', rounds: 30 }, { game: 'knee-sprint', rounds: 12 }], run_finished: [{ game: 'road-run', rounds: 21 }] },
    });
    expect(text).toContain('2026-11-03       12         0');
    expect(text).toContain('2026-11-04       30        21');
    expect(text).toContain('total            42        21');
    expect(text.indexOf('road-run')).toBeLessThan(text.indexOf('knee-sprint'));
  });

  it('reads its options and refuses unknown ones; the token is never an option value, only a file or the environment', async () => {
    const t = await tool();
    expect(t.parseArgs(['--days', '30', '--preview', '--sql', '--json', '--account', ACCOUNT, '--token-file', 'x.txt'])).toEqual({ days: 30, preview: true, sql: true, json: true, visits: false, host: 'bodyarcade.com', account: ACCOUNT, tokenFile: 'x.txt' });
    expect(t.parseArgs(['--visits', '--host', 'example.com'])).toMatchObject({ visits: true, host: 'example.com' });
    expect(t.parseArgs([], { CF_ACCOUNT_ID: ACCOUNT }).account).toBe(ACCOUNT);
    expect(() => t.parseArgs(['--token', 'secret'])).toThrow();
    expect(() => t.parseArgs(['--days', 'x'])).toThrow();
  });
});
