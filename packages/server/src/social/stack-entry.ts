// The Worker of the Miniflare stack (test support: the production bundle never includes this file; stack.ts bundles it
// instead of src/index.ts): the production Worker, whole, plus a clock that a test can hold still and move, and a way for a
// test to run SQL on the directory's tables.
//
// Every module reads the time with Date.now() (the run tickets and what a run may score, the limits' windows, presence
// time-outs, the week a board belongs to), in the Worker and in its Durable Objects, which share the isolate. One replaced
// function therefore moves all of them. A test that needs "three seconds later" says so with `stack.clock.advance(3000)`
// instead of sleeping and hoping the machine is neither too fast nor too slow, and a test that must not straddle midnight
// of a Sunday pins the clock for its whole length.
//
// The tables are inside the directory object, so a test cannot open them from outside the way it could open a database. The
// directory of this bundle is a subclass that also answers `POST https://test.internal/sql`, and the Worker has one test route
// that carries a test's statements to it; both exist only here and only where TEST_CLOCK is "1".
import { POLICY, isAgeBand } from '../../../core/social/age.ts';
import { HttpError, isRecord, json, readJson } from '../http.ts';
import { router } from '../router.ts';
import worker from '../index.ts';
import { SocialDirectory as ProductionDirectory } from './directory.ts';
import { directoryOf } from './env.ts';

export * from '../index.ts';
export default worker;

// Test bundle only: the suites of this module exercise every age band, the under-16 one included, so the switch that production
// keeps off (POLICY.child.online, no online identity under 16) is on in this Worker. A test that needs the production rule turns it
// off with POST /api/__test/online (stack.setOnline('child', false)).
POLICY.child.online = true;

/** The statements a test sends: `{statements: [{sql, params}], mode: 'first' | 'all' | 'run' | 'batch'}`. */
interface SqlCall { statements: { sql: string; params: unknown[] }[]; mode: 'first' | 'all' | 'run' | 'batch' }

export class SocialDirectory extends ProductionDirectory {
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname !== 'test.internal' || url.pathname !== '/sql') return super.fetch(req);
    const call = (await req.json()) as SqlCall;
    try {
      const prepared = call.statements.map((s) => this.db.prepare(s.sql).bind(...s.params));
      const first = prepared[0];
      if (!first) return json({ results: [] });
      if (call.mode === 'batch') return json({ results: await this.db.batch(prepared) });
      if (call.mode === 'first') return json({ row: await first.first() });
      return json({ result: call.mode === 'all' ? await first.all() : await first.run() });
    } catch (e) {
      return json({ error: String((e as { message?: unknown })?.message ?? e) }, 500);
    }
  }
}

const realNow = Date.now.bind(Date);
/** How far the running clock is ahead of the real one. */
let offsetMs = 0;
/** The time a pinned clock stands at (null: the clock runs). */
let pinned: number | null = null;

const now = (): number => pinned ?? realNow() + offsetMs;
Date.now = now;

/** POST /api/__test/clock {op: 'now' | 'pin' | 'advance' | 'release', ms?} -> {now, pinned}; only where TEST_CLOCK is "1". */
router.add('POST', '/api/__test/clock', async (req, env) => {
  if (env.TEST_CLOCK !== '1') throw new HttpError(404, 'not_found');
  const body = await readJson(req);
  const op = isRecord(body) ? body.op : undefined;
  const ms = isRecord(body) && typeof body.ms === 'number' ? body.ms : 0;
  if (!Number.isFinite(ms) || ms < 0) throw new HttpError(400, 'bad_request');   // time only goes forward
  if (op === 'pin') {
    pinned ??= now();
  } else if (op === 'advance') {
    if (pinned !== null) pinned += ms;
    else offsetMs += ms;
  } else if (op === 'release') {
    // The clock runs again from where it stands: it never goes back to the real time it had left behind.
    if (pinned !== null) { offsetMs = pinned - realNow(); pinned = null; }
  } else if (op !== 'now') {
    throw new HttpError(400, 'bad_request');
  }
  return json({ now: now(), pinned: pinned !== null });
});

/** POST /api/__test/sql {statements, mode} -> what the directory's SQL answered; only where TEST_CLOCK is "1". */
router.add('POST', '/api/__test/sql', async (req, env) => {
  if (env.TEST_CLOCK !== '1') throw new HttpError(404, 'not_found');
  const body = await readJson(req, 1_000_000);
  return directoryOf(env).fetch(new Request('https://test.internal/sql', { method: 'POST', body: JSON.stringify(body) }));
});

/** POST /api/__test/online {band, online} -> {band, online}: turns a band's online identity on or off in this Worker (the under-16 switch); only where TEST_CLOCK is "1". */
router.add('POST', '/api/__test/online', async (req, env) => {
  if (env.TEST_CLOCK !== '1') throw new HttpError(404, 'not_found');
  const body = await readJson(req);
  const band = isRecord(body) ? body.band : undefined;
  const online = isRecord(body) ? body.online : undefined;
  if (!isAgeBand(band) || typeof online !== 'boolean') throw new HttpError(400, 'bad_request');
  POLICY[band].online = online;
  return json({ band, online });
});
