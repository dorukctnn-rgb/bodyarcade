// Syncing the streak, the daily challenge and the plans through the social client's documents: a second device picks up where
// the first stopped, nothing is ever lost to a conflict, and a device with nothing new says nothing.
import { describe, expect, it } from 'vitest';
import { createChallengeBook, type ChallengeBook } from './daily-challenge.ts';
import { addDays, type Day } from './date.ts';
import { daysOf } from './dayset.ts';
import { createHabit, type Habit } from './habit.ts';
import { createStore, memoryStorage } from './store.ts';
import { DOC_KEYS, createDocSync, type DocSync, type SyncedDocument } from './sync-docs.ts';
import { FakeSyncServer } from './testkit.ts';
import { createPlanBook, type PlanBook, type PlanGame } from './workout-plans.ts';

const GAMES: PlanGame[] = ['twist-turbine', 'star-catch', 'squat-flap', 'knee-sprint', 'firework-jacks', 'road-run', 'pose-wall', 'summit-climb']
  .map((id) => ({ id, free: true, seated: true, lowImpact: true, durationSec: 180 }));

interface Device { habit: Habit; challenge: ChallengeBook; plans: PlanBook; sync: DocSync; at(d: Day): void; play(d: Day, seconds?: number): void; done(d: Day): void }

function device(server: FakeSyncServer | null, start: Day = '2026-10-24'): Device {
  const clock = { t: Date.parse(`${start}T12:00:00Z`) };
  const store = createStore({ storage: memoryStorage(), now: () => clock.t, timeZone: 'UTC' });
  const habit = createHabit(store);
  const challenge = createChallengeBook(store, { games: () => GAMES });
  const plans = createPlanBook(store, { games: () => GAMES, can: () => true });
  const sync = createDocSync({ port: () => (server ? server.port() : null), sources: { habit, challenge, plans }, now: () => clock.t });
  const at = (d: Day): void => { clock.t = Date.parse(`${d}T12:00:00Z`); };
  return {
    habit, challenge, plans, sync, at,
    play: (d, seconds = 200) => { at(d); habit.addPlay(seconds); },
    done: (d) => { at(d); challenge.record({ game: challenge.today().challenge?.game as string, seconds: 100 }); },
  };
}

describe('a first device with something to say and a server that has nothing', () => {
  it('writes what it knows, one document each, and nothing for a record that is empty', async () => {
    const server = new FakeSyncServer();
    const a = device(server);
    a.play('2026-10-22'); a.play('2026-10-23');
    const r1 = await a.sync.sync();
    expect(r1).toMatchObject({ ok: true, pulled: [], pushed: ['habit'] });
    expect(server.docs.has('daily')).toBe(false);
    expect(server.docs.has('plans')).toBe(false);
    a.done('2026-10-24');
    a.plans.start('desk-break'); a.plans.finishStep({ score: 1, seconds: 100 }); a.plans.finishStep({ score: 1, seconds: 100 });
    const r2 = await a.sync.sync();
    expect(r2).toMatchObject({ ok: true, pushed: ['daily', 'plans'] });
    expect([...server.docs.keys()].sort()).toEqual(['daily', 'habit', 'plans']);
  });

  it('says nothing on the next sync: the only request is the one that reads', async () => {
    const server = new FakeSyncServer();
    const a = device(server);
    a.play('2026-10-23');
    await a.sync.sync();
    server.loads = 0; server.writes = 0;
    expect(await a.sync.sync()).toMatchObject({ ok: true, pulled: [], pushed: [] });
    expect(server.loads).toBe(1);
    expect(server.writes).toBe(0);
  });
});

describe('two devices', () => {
  it('end with the same record after each has spoken once and listened once, and then say nothing', async () => {
    const server = new FakeSyncServer();
    const phone = device(server);
    const laptop = device(server);
    phone.play('2026-10-20'); phone.play('2026-10-22'); phone.done('2026-10-22');
    laptop.play('2026-10-21'); laptop.play('2026-10-23'); laptop.done('2026-10-23');
    await phone.sync.sync();
    expect(await laptop.sync.sync()).toMatchObject({ ok: true, pulled: ['daily', 'habit'], pushed: ['daily', 'habit'] });
    expect(await phone.sync.sync()).toMatchObject({ ok: true, pulled: ['daily', 'habit'], pushed: [] });
    phone.at('2026-10-24'); laptop.at('2026-10-24');
    expect(daysOf(phone.habit.doc().a)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(phone.habit.doc()).toEqual(laptop.habit.doc());
    expect(phone.challenge.doc()).toEqual(laptop.challenge.doc());
    expect(phone.habit.view()).toMatchObject({ dayStreak: 4 });
    expect(daysOf(laptop.challenge.doc().d)).toEqual(['2026-10-22', '2026-10-23']);
    server.loads = 0; server.writes = 0;
    expect(await laptop.sync.sync()).toMatchObject({ ok: true, pulled: [], pushed: [] });
    expect(server.writes).toBe(0);
  });

  it('lose nothing when the other device writes between the read and the write of a sync', async () => {
    const server = new FakeSyncServer();
    const phone = device(server);
    const laptop = device(server);
    phone.play('2026-10-20');
    laptop.play('2026-10-21');
    phone.at('2026-10-24'); laptop.at('2026-10-24');
    await phone.sync.sync();
    // The laptop reads the server (sees the phone's day), then, before its own write lands, the phone's write of another day lands.
    server.interfere = () => {
      const cur = server.docs.get('habit') as SyncedDocument;
      server.write('habit', cur.rev, { v: 1, a: { '2026-10': (1 << 19) | (1 << 21) }, r: {} });      // the 20th (known) and the 22nd
    };
    const report = await laptop.sync.sync();
    expect(report.ok).toBe(true);
    expect(server.conflicts).toBe(1);                                                    // the conflict happened, and was merged, not overwritten
    await phone.sync.sync();
    await laptop.sync.sync();
    const days = daysOf((server.docs.get('habit')?.data as { a: Record<string, number> }).a as never);
    expect(days).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(laptop.habit.doc()).toEqual(phone.habit.doc());
  });

  it('a device back from a long absence, with nothing, picks the whole record up', async () => {
    const server = new FakeSyncServer();
    const old = device(server);
    for (let i = 0; i < 20; i++) old.play(addDays('2026-10-01', i));
    old.plans.start('desk-break'); old.plans.finishStep({ score: 1, seconds: 100 }); old.plans.finishStep({ score: 1, seconds: 100 });
    await old.sync.sync();
    const fresh = device(server, '2026-10-24');
    expect(await fresh.sync.sync()).toMatchObject({ ok: true, pulled: ['habit', 'plans'], pushed: [] });
    expect(daysOf(fresh.habit.doc().a)).toHaveLength(20);
    expect(fresh.habit.view()).toMatchObject({ weekStreak: 3, dayStreak: 0 });             // three full weeks, and a gap of three days that no rest day covers
    expect(fresh.plans.card('desk-break')?.doneDays).toBe(1);
  });

  it('keep every document inside the 3,000 characters the server takes, after a year of use', async () => {
    const server = new FakeSyncServer();
    const a = device(server, '2026-10-01');
    for (let i = 0; i < 420; i++) {
      const d = addDays('2025-09-01', i);
      a.play(d);
      a.done(d);
    }
    for (const id of ['desk-break', 'full-body', 'legs-day', 'kids-break', 'easy-60']) {
      for (let i = 0; i < 400; i += 3) {
        a.at(addDays('2025-09-05', i));
        a.plans.start(id);
        for (let s = 0; s < 6; s++) a.plans.finishStep({ score: 1, seconds: 100 });
      }
    }
    a.at('2026-10-24');
    expect(await a.sync.sync()).toMatchObject({ ok: true });
    for (const key of DOC_KEYS) expect(JSON.stringify(server.docs.get(key)?.data).length, key).toBeLessThan(3000);
  });
});

describe('when it cannot work', () => {
  it('says there is no port while the player has no profile', async () => {
    const a = device(null);
    a.play('2026-10-23');
    expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'no_port', pulled: [], pushed: [] });
  });

  it('says "network" for a request that never got an answer, and "refused" for a server that does not know the player', async () => {
    const server = new FakeSyncServer();
    const a = device(server);
    a.play('2026-10-23');
    server.failLoad = Object.assign(new Error('network'), { status: 0, code: 'network' });
    expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'network' });
    server.failLoad = Object.assign(new Error('unknown_device'), { status: 401, code: 'unknown_device' });
    expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'refused' });
    server.failLoad = new TypeError('Failed to fetch');
    expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'network' });
    server.failLoad = new Error('boom');
    expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'failed' });
    server.failLoad = null;
    expect(await a.sync.sync()).toMatchObject({ ok: true, pushed: ['habit'] });             // and the next try simply works
  });

  it('keeps what it pulled when a write fails, tells which documents went through, and tries the rest next time', async () => {
    const server = new FakeSyncServer();
    const other = device(server);
    other.play('2026-10-20');
    await other.sync.sync();
    const a = device(server);
    a.play('2026-10-23'); a.done('2026-10-23');
    server.failWrite = { key: 'habit', error: Object.assign(new Error('rate_limited'), { status: 429, code: 'rate_limited' }) };
    const report = await a.sync.sync();
    expect(report).toMatchObject({ ok: false, failure: 'failed', pulled: ['habit'], pushed: ['daily'] });      // the challenge went through, the streak did not
    expect(daysOf(a.habit.doc().a)).toEqual(['2026-10-20', '2026-10-23']);                  // what the server knew is here already
    server.failWrite = null;
    expect(await a.sync.sync()).toMatchObject({ ok: true, pushed: ['habit'] });
  });

  it('gives up cleanly on a conflict that does not end', async () => {
    const server = new FakeSyncServer();
    const a = device(server);
    a.play('2026-10-23');
    const original = server.write.bind(server);
    server.write = (key, base, data) => { original(key, base, data); return { ok: false, current: server.docs.get(key) ?? null }; };
    expect(await a.sync.sync()).toMatchObject({ ok: false, failure: 'failed' });
  });

  it('never throws, even when a record or the clock does', async () => {
    const server = new FakeSyncServer();
    const a = device(server);
    const broken = createDocSync({
      port: () => server.port(), now: () => 5,
      sources: { habit: { doc: () => { throw new Error('x'); }, merge: () => { throw new Error('y'); } }, challenge: a.challenge, plans: a.plans },
    });
    await expect(broken.sync()).resolves.toMatchObject({ ok: false, failure: 'failed' });
    const noPort = createDocSync({ port: () => { throw new Error('no client yet'); }, sources: { habit: a.habit, challenge: a.challenge, plans: a.plans } });
    await expect(noPort.sync()).resolves.toMatchObject({ ok: false, failure: 'no_port' });
  });

  it('shares one attempt between two calls made together', async () => {
    const server = new FakeSyncServer();
    const a = device(server);
    a.play('2026-10-23');
    const [x, y] = await Promise.all([a.sync.sync(), a.sync.sync()]);
    expect(x).toBe(y);
    expect(server.loads).toBe(1);
    expect(server.writes).toBe(1);
  });
});

describe('what the server holds that this version cannot read', () => {
  it('leaves a document written by a newer version of the app alone, and still syncs the others', async () => {
    const server = new FakeSyncServer();
    server.docs.set('habit', { rev: 4, at: 1, data: { v: 2, weeks: [1, 2, 3] } });
    const a = device(server);
    a.play('2026-10-23'); a.done('2026-10-23');
    expect(await a.sync.sync()).toMatchObject({ ok: true, pulled: [], pushed: ['daily'] });
    expect(server.docs.get('habit')).toEqual({ rev: 4, at: 1, data: { v: 2, weeks: [1, 2, 3] } });
  });

  it('writes over a document that is only damaged, with the union of what it can read', async () => {
    const server = new FakeSyncServer();
    server.docs.set('habit', { rev: 2, at: 1, data: 'not a document' });
    const a = device(server);
    a.play('2026-10-23');
    expect(await a.sync.sync()).toMatchObject({ ok: true, pushed: ['habit'] });
    expect(daysOf((server.docs.get('habit')?.data as { a: never }).a)).toEqual(['2026-10-23']);
    expect(server.docs.get('habit')?.rev).toBe(3);
  });

  it('does not take a day from the future from a server whose other device had a wrong clock', async () => {
    const server = new FakeSyncServer();
    server.docs.set('habit', { rev: 1, at: 1, data: { v: 1, a: { '2026-10': 1 << 29, '2030-01': 5 }, r: {} } });
    const a = device(server);
    await a.sync.sync();
    expect(daysOf(a.habit.doc().a)).toEqual([]);
  });
});
