// The reading tool asks for the datasets the Worker writes, with queries that cannot be bent by what is typed, and prints plain numbers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUNNEL_BINDING, PING_BINDINGS } from '../../packages/server/src/site/ping.ts';

interface Tool {
  EVENTS: string[];
  datasetOf(event: string, preview?: boolean): string;
  totalsRequest(account: string, dataset: string, days: number, now?: number): { query: string; variables: Record<string, string> };
  totalsOf(answer: unknown): { date: string; count: number }[];
  sqlFor(dataset: string, days: number): string;
  gamesOf(answer: unknown): { game: string; rounds: number }[];
  render(r: { days: number; totals: Record<string, { date: string; count: number }[]>; games?: Record<string, { game: string; rounds: number }[]> }): string;
  parseArgs(argv: string[], env?: Record<string, string>): { days: number; preview: boolean; sql: boolean; json: boolean; visits: boolean; funnel: boolean; host: string; account: string; tokenFile: string };
  funnelDataset(preview?: boolean): string;
  funnelSql(dataset: string, days: number): string;
  roundWordSql(dataset: string, days: number): string;
  funnelRowsOf(answer: unknown): { day: string; e: string; g: string; x: string; n: number }[];
  wordsOf(answer: unknown): { first: number; again: number; none: number };
  renderFunnel(r: { days: number; rows: { day: string; e: string; g: string; x: string; n: number }[]; rounds?: Record<string, { first: number; again: number; none: number }> }): string;
}
const tool = async (): Promise<Tool> => (await import(/* @vite-ignore */ new URL('./read.mjs', import.meta.url).href)) as Tool;
const ROOT = new URL('../../', import.meta.url);
const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('tools/signals/read.mjs --funnel', () => {
  it('reads the funnel dataset the configs bind, with SQL that only takes our names and a number of days', async () => {
    const t = await tool();
    for (const [file, preview] of [['wrangler.prod.jsonc', false], ['wrangler.jsonc', true]] as const) {
      const cfg = JSON.parse(readFileSync(new URL(file, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { analytics_engine_datasets: { binding: string; dataset: string }[] };
      expect(cfg.analytics_engine_datasets.find((d) => d.binding === FUNNEL_BINDING)?.dataset, file).toBe(t.funnelDataset(preview));
    }
    expect(t.funnelSql('bodyarcade_funnel', 7)).toContain("FROM bodyarcade_funnel WHERE timestamp > NOW() - INTERVAL '7' DAY");
    expect(t.funnelSql('bodyarcade_funnel', 500)).toContain("INTERVAL '90' DAY");
    expect(() => t.funnelSql('bodyarcade_funnel; DROP', 7)).toThrow();
    expect(() => t.funnelSql('bodyarcade_game_start', 7)).toThrow();
    expect(t.roundWordSql('bodyarcade_run_finished', 3)).toContain('GROUP BY x');
    expect(() => t.roundWordSql('bodyarcade_funnel', 3)).toThrow();
    expect(t.parseArgs(['--funnel']).funnel).toBe(true);
  });

  it('adds the steps up into the funnel, with first-time players apart and the reasons under it', async () => {
    const t = await tool();
    const rows = t.funnelRowsOf({ data: [
      { day: '2026-11-06 00:00:00', e: 'visit', g: 'home', x: 'google', n: 40 },
      { day: '2026-11-06 00:00:00', e: 'visit', g: 'webcam-fitness-games', x: 'google', n: 10 },
      { day: '2026-11-06 00:00:00', e: 'visit', g: 'game-squat-flap', x: 'internal', n: 30 },
      { day: '2026-11-06 00:00:00', e: 'play_open', g: 'squat-flap', x: 'first', n: 20 },
      { day: '2026-11-06 00:00:00', e: 'tracking_ready', g: 'squat-flap', x: 'first', n: 12 },
      { day: '2026-11-06 00:00:00', e: 'play_left', g: 'squat-flap', x: 'calibrating', n: 4 },
      { day: '2026-11-06 00:00:00', e: 'play_error', g: 'squat-flap', x: 'denied', n: 3 },
      { day: '2026-11-06 00:00:00', e: 'paywall_view', g: 'results', x: '', n: 2 },
    ] });
    expect(rows[0]).toEqual({ day: '2026-11-06', e: 'visit', g: 'home', x: 'google', n: 40 });
    expect(t.wordsOf({ data: [{ x: 'first', n: 5 }, { x: 'again', n: 2 }, { x: '', n: 9 }] })).toEqual({ first: 5, again: 2, none: 9 });
    const text = t.renderFunnel({ days: 7, rows, rounds: { game_start: { first: 8, again: 2, none: 0 }, run_finished: { first: 5, again: 1, none: 0 } } });
    expect(text).toMatch(/visits \(landings\)\s+50/);
    expect(text).toMatch(/play screen opened\s+20\s+40%/);
    expect(text).toMatch(/round started\s+10\s+83%/);
    expect(text).toMatch(/round finished\s+6\s+60%/);
    expect(text).toContain('started 8, finished 5');
    expect(text).toMatch(/calibrating\s+4/);
    expect(text).toMatch(/denied\s+3/);
    expect(t.renderFunnel({ days: 1, rows: [] })).toContain('no step of the funnel counted yet');
  });
});

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
    expect(t.parseArgs(['--days', '30', '--preview', '--sql', '--json', '--account', ACCOUNT, '--token-file', 'x.txt'])).toEqual({ days: 30, preview: true, sql: true, json: true, visits: false, funnel: false, host: 'bodyarcade.com', account: ACCOUNT, tokenFile: 'x.txt' });
    expect(t.parseArgs(['--visits', '--host', 'example.com'])).toMatchObject({ visits: true, host: 'example.com' });
    expect(t.parseArgs([], { CF_ACCOUNT_ID: ACCOUNT }).account).toBe(ACCOUNT);
    expect(() => t.parseArgs(['--token', 'secret'])).toThrow();
    expect(() => t.parseArgs(['--days', 'x'])).toThrow();
  });
});
