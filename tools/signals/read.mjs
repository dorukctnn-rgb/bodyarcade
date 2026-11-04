#!/usr/bin/env node
// Reads the game signal back: how many rounds started and finished (packages/server/src/site/ping.ts writes them to two
// Workers Analytics Engine datasets, bodyarcade_game_start and bodyarcade_run_finished; the preview has _preview names).
//
//   node tools/signals/read.mjs --account <cloudflare account id> --token-file <file>          totals per day (GraphQL)
//   node tools/signals/read.mjs --account <id> --token-file <file> --sql                       per game (SQL API)
//   node tools/signals/read.mjs --account <id> --token-file <file> --visits                     also the visits and page views of Web Analytics (GraphQL)
//   options: --days 7 (1 to 90), --preview (the preview's datasets), --json (machine output)
//   the token can also come from CF_API_TOKEN and the account from CF_ACCOUNT_ID; the token is never printed.
//
// Totals per day: Cloudflare's GraphQL Analytics API (workersAnalyticsEngineAdaptiveGroups), which any read-only account analytics
// token can ask. Per game: the Analytics Engine SQL API, which needs a token with "Account Analytics: Read" (dashboard > My Profile >
// API Tokens). A dataset that has not been written to yet answers empty (or "no such table"): that means no round was counted yet.
// Retention is three months. Without this script: Workers & Pages > bodyarcade > Observability > Logs, query `evt = ping`, group by `e` and `g`.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EVENTS = ['game_start', 'run_finished'];

/** The dataset of an event (wrangler.prod.jsonc, and wrangler.jsonc with the _preview suffix). */
export function datasetOf(event, preview = false) {
  if (!EVENTS.includes(event)) throw new Error(`unknown event ${event}`);
  return `bodyarcade_${event}${preview ? '_preview' : ''}`;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The GraphQL query and variables for the daily totals of one dataset, over the last `days` days (today included). */
export function totalsRequest(account, dataset, days, now = Date.now()) {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('the account id is 32 hexadecimal characters');
  const d = Math.min(90, Math.max(1, Math.trunc(days)));
  return {
    query: 'query($acc: String!, $set: String!, $from: Date!, $to: Date!) { viewer { accounts(filter: { accountTag: $acc }) {'
      + ' workersAnalyticsEngineAdaptiveGroups(limit: 200, filter: { dataset: $set, date_geq: $from, date_leq: $to }, orderBy: [date_ASC]) { count dimensions { date } } } } }',
    variables: { acc: account, set: dataset, from: day(now - (d - 1) * 86_400_000), to: day(now) },
  };
}

/** The GraphQL request for Web Analytics' page loads of one host per day: page views (count) and visits. */
export function visitsRequest(account, host, days, now = Date.now()) {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Error('the account id is 32 hexadecimal characters');
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error('not a host name');
  const d = Math.min(90, Math.max(1, Math.trunc(days)));
  return {
    query: 'query($acc: String!, $host: string!, $from: Date!, $to: Date!) { viewer { accounts(filter: { accountTag: $acc }) {'
      + ' rumPageloadEventsAdaptiveGroups(limit: 200, filter: { requestHost: $host, date_geq: $from, date_leq: $to }, orderBy: [date_ASC]) { count sum { visits } dimensions { date } } } } }',
    variables: { acc: account, host, from: day(now - (d - 1) * 86_400_000), to: day(now) },
  };
}

/** The daily page views and visits in a GraphQL answer: [{ date, views, visits }]. */
export function visitsOf(answer) {
  const rows = answer?.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? [];
  return rows.map((r) => ({ date: String(r.dimensions?.date ?? ''), views: Number(r.count ?? 0), visits: Number(r.sum?.visits ?? 0) }));
}

/** The daily totals in a GraphQL answer: [{ date, count }]. */
export function totalsOf(answer) {
  const rows = answer?.data?.viewer?.accounts?.[0]?.workersAnalyticsEngineAdaptiveGroups ?? [];
  return rows.map((r) => ({ date: String(r.dimensions?.date ?? ''), count: Number(r.count ?? 0) }));
}

/** The SQL for the per-game numbers of one dataset (the sample interval keeps the sum right if Cloudflare ever samples). */
export function sqlFor(dataset, days) {
  if (!/^bodyarcade_[a-z_]+$/.test(dataset)) throw new Error('not a signal dataset');
  const d = Math.min(90, Math.max(1, Math.trunc(days)));
  return `SELECT blob1 AS game, SUM(_sample_interval) AS rounds FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${d}' DAY GROUP BY game ORDER BY rounds DESC LIMIT 100 FORMAT JSON`;
}

/** The per-game rows of a SQL API answer (FORMAT JSON): [{ game, rounds }]. */
export function gamesOf(answer) {
  return (answer?.data ?? []).map((r) => ({ game: String(r.game ?? ''), rounds: Number(r.rounds ?? 0) }));
}

/** Plain text for a person: totals per day, then per game when there are any. */
export function render({ days, totals, games, visits }) {
  const lines = [];
  const dates = [...new Set(EVENTS.flatMap((e) => (totals[e] ?? []).map((r) => r.date)))].sort();
  lines.push(`Game signal, last ${days} day(s)`);
  lines.push('');
  if (dates.length === 0) lines.push('no rounds counted yet');
  else {
    lines.push('date        started  finished');
    for (const date of dates) {
      const n = (e) => String((totals[e] ?? []).find((r) => r.date === date)?.count ?? 0);
      lines.push(`${date}  ${n('game_start').padStart(7)}  ${n('run_finished').padStart(8)}`);
    }
    const sum = (e) => (totals[e] ?? []).reduce((a, r) => a + r.count, 0);
    lines.push(`total       ${String(sum('game_start')).padStart(7)}  ${String(sum('run_finished')).padStart(8)}`);
  }
  if (visits) {
    lines.push('');
    if (visits.length === 0) lines.push('Web Analytics: no visits counted yet');
    else {
      lines.push('Web Analytics  views  visits');
      for (const r of visits) lines.push(`${r.date}  ${String(r.views).padStart(6)}  ${String(r.visits).padStart(6)}`);
    }
  }
  if (games) {
    lines.push('');
    lines.push('game                    started  finished');
    const names = [...new Set(EVENTS.flatMap((e) => (games[e] ?? []).map((r) => r.game)))];
    const rows = names.map((g) => ({ g, s: games.game_start?.find((r) => r.game === g)?.rounds ?? 0, f: games.run_finished?.find((r) => r.game === g)?.rounds ?? 0 }));
    rows.sort((a, b) => b.s - a.s || b.f - a.f || a.g.localeCompare(b.g));
    for (const r of rows) lines.push(`${r.g.padEnd(22)}  ${String(r.s).padStart(7)}  ${String(r.f).padStart(8)}`);
    if (rows.length === 0) lines.push('(none)');
  }
  return lines.join('\n');
}

const API = 'https://api.cloudflare.com/client/v4';

async function graphql(token, request) {
  const res = await fetch(`${API}/graphql`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.errors && body.errors.length)) throw new Error(`GraphQL answered ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body;
}

async function sql(token, account, text) {
  const res = await fetch(`${API}/accounts/${account}/analytics_engine/sql`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: text });
  const raw = await res.text();
  if (!res.ok) {
    // a dataset nobody has written to has no table yet: that is an empty answer, not an error
    if (/unable to find type of column|unknown table|no such table|Unknown table/i.test(raw)) return { data: [] };
    throw new Error(`the SQL API answered ${res.status}: ${raw.slice(0, 200)} (a token with "Account Analytics: Read" is needed)`);
  }
  return JSON.parse(raw);
}

export function parseArgs(argv, env = {}) {
  const o = { days: 7, preview: false, sql: false, json: false, visits: false, host: 'bodyarcade.com', account: env.CF_ACCOUNT_ID ?? '', tokenFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preview') o.preview = true;
    else if (a === '--sql') o.sql = true;
    else if (a === '--json') o.json = true;
    else if (a === '--visits') o.visits = true;
    else if (a === '--host') o.host = String(argv[++i] ?? '');
    else if (a === '--days') o.days = Number(argv[++i]);
    else if (a === '--account') o.account = String(argv[++i] ?? '');
    else if (a === '--token-file') o.tokenFile = String(argv[++i] ?? '');
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isFinite(o.days) || o.days < 1) throw new Error('--days must be a number from 1 to 90');
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2), process.env);
  const token = process.env.CF_API_TOKEN || (o.tokenFile ? readFileSync(o.tokenFile, 'utf8').trim() : '');
  if (!token) throw new Error('no token: set CF_API_TOKEN or pass --token-file <file with a read-only Cloudflare analytics token>');
  if (!o.account) throw new Error('no account: set CF_ACCOUNT_ID or pass --account <id>');
  const totals = {};
  for (const e of EVENTS) totals[e] = totalsOf(await graphql(token, totalsRequest(o.account, datasetOf(e, o.preview), o.days)));
  let games;
  if (o.sql) {
    games = {};
    for (const e of EVENTS) games[e] = gamesOf(await sql(token, o.account, sqlFor(datasetOf(e, o.preview), o.days)));
  }
  const visits = o.visits ? visitsOf(await graphql(token, visitsRequest(o.account, o.host, o.days))) : undefined;
  console.log(o.json ? JSON.stringify({ days: o.days, preview: o.preview, totals, ...(games ? { games } : {}), ...(visits ? { visits } : {}) }, null, 2) : render({ days: o.days, totals, games, visits }));
}

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
