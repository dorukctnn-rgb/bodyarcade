// The Worker of the Miniflare stack (test support: the production bundle never includes this file; stack.ts bundles it
// instead of src/index.ts): the production Worker, whole, plus a clock that a test can hold still and move.
//
// Every module reads the time with Date.now() (the run tickets and what a run may score, the limits' windows, presence
// time-outs, the week a board belongs to), in the Worker and in its Durable Objects, which share the isolate. One replaced
// function therefore moves all of them. A test that needs "three seconds later" says so with `stack.clock.advance(3000)`
// instead of sleeping and hoping the machine is neither too fast nor too slow, and a test that must not straddle midnight
// of a Sunday pins the clock for its whole length.
import { HttpError, isRecord, json, readJson } from '../http.ts';
import { router } from '../router.ts';
import worker from '../index.ts';

export * from '../index.ts';
export default worker;

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
