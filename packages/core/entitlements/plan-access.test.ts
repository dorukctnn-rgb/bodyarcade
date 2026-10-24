// The workout plans and the entitlements together, on the real games: a free player has the desk break and nothing more of
// the plans, buying Pro opens the rest at once, and the rule is the one `can()` of the manager gives, not a copy of it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createArcade, createStore, memoryStorage, planFeature, WORKOUT_PLAN_IDS, FREE_PLAN_ID, type ArcadeGame } from '../store/index.ts';
import { createEntitlements } from './manager.ts';
import { createServerProvider } from './providers/server.ts';
import { Clock, DID_1, FakeServer, KEY_A, makeKeys, type Keys } from './testkit.ts';

const dir = fileURLToPath(new URL('../../games/', import.meta.url));
const GAMES: ArcadeGame[] = readdirSync(dir)
  .filter((d) => existsSync(`${dir}${d}/manifest.json`))
  .map((d) => JSON.parse(readFileSync(`${dir}${d}/manifest.json`, 'utf8')) as ArcadeGame);

let keys: Keys;
beforeAll(async () => { keys = await makeKeys(); });
const hexBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) as string[], (h) => parseInt(h, 16));

async function setup() {
  const clock = new Clock();
  const server = new FakeServer(keys, clock);
  server.licenses.set(KEY_A, { plan: 'pro-yearly', status: 'active' });
  const store = createStore({ storage: memoryStorage(), now: clock.now, timeZone: 'UTC' });
  let didOf = (): string => '';
  const service = createEntitlements({
    store, keys: [keys.pub], now: clock.now, random: () => hexBytes(DID_1), autoRefresh: false,
    providers: [createServerProvider({ fetch: server.fetch, did: () => didOf(), keys: [keys.pub], now: clock.now })],
    rules: { isFreeGame: (id) => GAMES.find((g) => g.id === id)?.free === true },
    setTimer: () => 0, clearTimer: () => undefined,
  });
  didOf = service.deviceId;
  await service.ready();
  const arcade = createArcade({ store, games: () => GAMES, can: (f) => service.can(f), paid: () => service.current().plan !== 'free', now: clock.now });
  return { service, arcade, clock };
}

describe('plans and Pro', () => {
  it('give a free player the desk break, with games that are all free, and every other plan behind Pro', async () => {
    const { arcade } = await setup();
    const open = arcade.plans.list().filter((c) => !c.locked).map((c) => c.id);
    expect(open).toEqual([FREE_PLAN_ID]);
    const r = arcade.plans.start(FREE_PLAN_ID);
    expect(r.ok).toBe(true);
    for (const id of WORKOUT_PLAN_IDS.filter((x) => x !== FREE_PLAN_ID)) expect(arcade.plans.start(id), id).toEqual({ ok: false, code: 'locked' });
  });

  it('open every plan once Pro is bought, without restarting anything', async () => {
    const { arcade, service } = await setup();
    expect(arcade.plans.card('legs-day')?.locked).toBe(true);
    expect((await service.activateKey(KEY_A)).ok).toBe(true);
    expect(arcade.plans.list().every((c) => !c.locked)).toBe(true);
    for (const id of WORKOUT_PLAN_IDS) expect(arcade.plans.start(id).ok, id).toBe(true);
  });

  it('close again when Pro goes (a refund, an end), but let a plan that is running finish its day', async () => {
    const { arcade, service } = await setup();
    await service.activateKey(KEY_A);
    expect(arcade.plans.start('full-body').ok).toBe(true);
    await service.deactivate();
    expect(arcade.plans.card('full-body')?.locked).toBe(true);
    expect(arcade.plans.active()?.plan.id).toBe('full-body');               // what was started today is still played
    expect(arcade.plans.start('legs-day')).toEqual({ ok: false, code: 'locked' });
  });

  it('say the same as can(), for every plan and every game of the first release', async () => {
    const { arcade, service } = await setup();
    for (const id of WORKOUT_PLAN_IDS) expect(arcade.plans.card(id)?.locked === false, id).toBe(service.can(planFeature(id)));
    await service.activateKey(KEY_A);
    for (const id of WORKOUT_PLAN_IDS) expect(arcade.plans.card(id)?.locked === false, id).toBe(service.can(planFeature(id)));
    expect(GAMES.length).toBeGreaterThanOrEqual(11);
  });

  it('keep the daily challenge on a free game, so a free player always has one to play', async () => {
    const { arcade } = await setup();
    const game = arcade.challenge.today().challenge?.game as string;
    expect(GAMES.find((g) => g.id === game)?.free).toBe(true);
    expect(arcade.recordRun(game, { score: 100, seconds: 90, complete: true, variant: 'standard', difficulty: 'normal' }).challenge).toMatchObject({ done: true });
  });
});
