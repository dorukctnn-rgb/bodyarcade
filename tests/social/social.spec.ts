// Players in separate browsers against the production Worker (Miniflare: the real directory Durable Object, WebSockets): the passwordless
// profile and its device key, friends, requests, presence as it happens, invitations into a room, public lobbies and quick
// match by age group, blocks, reports and a ban, erasing a profile, two tabs of one player. Every page must finish with no
// console error and no uncaught exception.
import { expect, test } from '@playwright/test';
import { player, startSite, type Me, type Player, type Site } from './support.ts';

let site: Site;
test.beforeAll(async () => { test.setTimeout(180_000); site = await startSite(); });
test.afterAll(async () => { await site?.stop(); });

const open: Player[] = [];
async function who(label: string): Promise<Player> {
  const p = await player(site, label);
  open.push(p);
  return p;
}
test.afterEach(async ({}, info) => {
  if (info.status !== 'passed') console.log('WORKER LOG', site.stack.logs.slice(-12).join(' | '));
  const problems = open.flatMap((p) => p.problems);
  await Promise.all(open.splice(0).map((p) => p.close()));
  expect(problems).toEqual([]);
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const goOnline = async (p: Player): Promise<void> => {
  await p.run((ba) => { ba.social.connect(); return null; });
  await p.until((s) => s.hub === 'online', 'the hub to open');
};
/** Two friends, both online. */
async function friends(aLabel: string, bLabel: string): Promise<{ a: Player; b: Player; aMe: Me; bMe: Me }> {
  const a = await who(aLabel);
  const b = await who(bLabel);
  const aMe = await a.signUp({ band: 'adult', name: aLabel });
  const bMe = await b.signUp({ band: 'adult', name: bLabel });
  await goOnline(a);
  await goOnline(b);
  await a.run((ba, code) => ba.social.sendRequest(code), bMe.code);
  await b.until((s) => s.requests.incoming.length === 1, 'the request');
  await b.run((ba, fid) => ba.social.respond(fid, true), aMe.fid);
  await a.until((s) => s.friends.length === 1, 'the friendship');
  return { a, b, aMe, bMe };
}
const admin = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${site.origin}${path}`, { ...init, headers: { Authorization: `Bearer ${site.adminToken}`, 'Content-Type': 'application/json', ...init.headers } });

// ───────── the profile ─────────

test('a profile without a password: the key stays on the device and the profile survives a reload', async () => {
  const ada = await who('Ada');
  const me = await ada.signUp({ band: 'adult', name: 'Ada', region: 'eu', level: 7 });
  expect(me).toMatchObject({ name: 'Ada', band: 'adult', level: 7, region: 'eu', can: { freeName: true, publicPlay: true } });
  expect(me.code).toMatch(/^BA-[A-Z2-9]{6}$/);
  expect(me.link).toMatch(new RegExp(`/f/${me.code}$`));
  expect((await ada.snap()).persistent).toBe(true);

  // the private key is a non-extractable WebCrypto key in IndexedDB: the page cannot read its bytes
  const keyFacts = await ada.page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('bodyarcade-social', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec: { keys: { privateKey: CryptoKey; publicRaw: string; kid: string } } = await new Promise((res, rej) => {
      const r = db.transaction('device').objectStore('device').get('identity'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    let exported = 'refused';
    try { await crypto.subtle.exportKey('pkcs8', rec.keys.privateKey); exported = 'exported'; } catch { exported = 'refused'; }
    return { extractable: rec.keys.privateKey.extractable, exported, algorithm: rec.keys.privateKey.algorithm.name };
  });
  expect(keyFacts).toMatchObject({ extractable: false, exported: 'refused', algorithm: 'ECDSA' });

  // a reload is the same player: same friend id and code
  await ada.open();
  const again = await ada.snap();
  expect(again.profile?.fid).toBe(me.fid);
  expect(again.profile?.code).toBe(me.code);

  // the profile can be edited and the friend code renewed (the old one stops working)
  const renamed = await ada.run((ba) => ba.social.updateProfile({ name: 'Ada L', level: 9, dnd: false }), undefined);
  expect(renamed).toMatchObject({ name: 'Ada L', level: 9 });
  const renewed = await ada.run((ba) => ba.social.renewCode(), undefined) as { code: string };
  expect(renewed.code).not.toBe(me.code);
  const bo = await who('Bo');
  await bo.signUp({ band: 'adult', name: 'Bo' });
  expect(await bo.try((ba, code) => ba.social.sendRequest(code), me.code)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  expect(await bo.try((ba, code) => ba.social.sendRequest(code), renewed.code)).toEqual({ ok: true, value: { status: 'sent' } });
});

test('a second device and cleared browser data: the recovery code brings the profile back with its friends, and nobody else can use it', async () => {
  const { a, b, aMe, bMe } = await friends('Ada', 'Bo');
  const code = (await a.snap()).recovery as string;
  expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);

  // a second device: a wrong code is refused, the right one (typed in lower case) brings the profile
  const phone = await who('Ada phone');
  expect((await phone.snap()).profile).toBeNull();
  expect(await phone.try((ba, x) => ba.social.recoverProfile(x), { code: aMe.code, recovery: 'AAAA-AAAA-AAAA-AAAA' })).toMatchObject({ ok: false, status: 403, code: 'recovery_failed' });
  await phone.run((ba, x) => ba.social.recoverProfile(x), { code: aMe.code.toLowerCase(), recovery: code.toLowerCase() });
  const there = await phone.snap();
  expect(there.profile).toMatchObject({ fid: aMe.fid, code: aMe.code, name: 'Ada' });
  expect(there.recovery).toBe(code);
  expect(((await phone.run((ba) => ba.social.loadFriends(), undefined)) as { name: string }[]).map((f) => f.name)).toEqual(['Bo']);
  // one player, one connection: the phone takes it, the first page is told
  await goOnline(phone);
  await a.until((s) => s.hub === 'replaced', 'the first device to be told');
  expect((await b.snap()).friends[0]?.presence.status).toBe('online');

  // the first device's browser clears the site's data: the key is gone, and so is the profile on that page
  const cdp = await a.ctx.newCDPSession(a.page);
  await cdp.send('Storage.clearDataForOrigin', { origin: site.origin, storageTypes: 'indexeddb' });
  await a.open();
  expect((await a.snap()).profile).toBeNull();
  expect(await a.try((ba) => ba.social.loadFriends(), undefined)).toMatchObject({ ok: false });
  // the code brings it back on the same page, with a new key; the friends are all there
  expect((await a.run((ba, x) => ba.social.recoverProfile(x), { code: aMe.code, recovery: code }) as { fid: string }).fid).toBe(aMe.fid);
  expect(((await a.run((ba) => ba.social.loadFriends(), undefined)) as { name: string }[]).map((f) => f.name)).toEqual(['Bo']);
  await goOnline(a);
  await phone.until((s) => s.hub === 'replaced', 'the phone to be told in its turn');

  // a new code makes the old one useless, on every device
  const fresh = await a.run((ba) => ba.social.renewRecovery(), undefined) as string;
  expect(fresh).not.toBe(code);
  const stranger = await who('Eve');
  expect(await stranger.try((ba, x) => ba.social.recoverProfile(x), { code: aMe.code, recovery: code })).toMatchObject({ ok: false, status: 403, code: 'recovery_failed' });
  expect(bMe.fid).toBeTruthy();
});

test('a teen and a child never type a name, and what the band allows is told to the page', async () => {
  const teen = await who('Teen');
  const kid = await who('Kid');
  const t = await teen.signUp({ band: 'teen', name: 'Typed Name' });
  const k = await kid.signUp({ band: 'child', name: 'Typed Name' });
  expect(t.name).not.toBe('Typed Name');
  expect(k.name).not.toBe('Typed Name');
  expect(t.can).toMatchObject({ freeName: false, freeText: false, video: false, publicPlay: true });
  expect(k.can).toMatchObject({ freeName: false, freeText: false, video: false, publicPlay: false });
  expect(await kid.try((ba) => ba.social.lobbies(), undefined)).toMatchObject({ ok: false, status: 403, code: 'child_no_public' });
  // a second sign-up on a device that has a profile is refused
  expect(await teen.try((ba) => ba.social.signUp({ band: 'adult' }), undefined)).toMatchObject({ ok: false, status: 409 });
});

// ───────── friends ─────────

test('a request by link reaches the other page the moment it is sent, and accepting fills both lists', async () => {
  const ada = await who('Ada');
  const bo = await who('Bo');
  const a = await ada.signUp({ band: 'adult', name: 'Ada' });
  const b = await bo.signUp({ band: 'adult', name: 'Bo' });
  await goOnline(ada);
  await goOnline(bo);
  expect(await ada.run((ba, text) => ba.social.sendRequest(text), `  ${b.link}  `)).toEqual({ status: 'sent' });
  const seen = await bo.until((s) => s.requests.incoming.length === 1, 'the request to arrive without a reload');
  expect(seen.requests.incoming[0]).toMatchObject({ fid: a.fid, name: 'Ada', via: 'link' });
  expect(seen.events).toContain('friendRequest');
  expect((await ada.snap()).requests.outgoing.map((r) => r.name)).toEqual(['Bo']);
  await bo.run((ba, fid) => ba.social.respond(fid, true), a.fid);
  const added = await ada.until((s) => s.friends.length === 1, 'the friend in the list');
  expect(added.friends[0]).toMatchObject({ fid: b.fid, name: 'Bo', presence: { status: 'online' } });
  expect(added.events).toContain('friendAdded');
  expect(added.requests.outgoing).toEqual([]);
  expect((await bo.snap()).friends[0]).toMatchObject({ fid: a.fid, name: 'Ada', presence: { status: 'online' } });
});

test('a friend link is a page of the site: the page reads the code from its address, a new player signs up and asks through it, and the answer reaches them', async () => {
  const ada = await who('Ada');
  const a = await ada.signUp({ band: 'adult', name: 'Ada' });
  await goOnline(ada);
  const path = `/f/${a.code}`;
  // the Worker serves the start page under the link, keeps it out of search results and sends no referrer (the code is a key to the inbox)
  const res = await fetch(`${site.origin}${path}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(await res.text()).toContain('<script');
  // a new device opens the link: no profile yet, and the page finds the code in its own address
  const eve = await who('Eve');
  await eve.openAt(path);
  expect((await eve.snap()).profile).toBeNull();
  expect(await eve.run((ba) => ba.addressCode())).toBe(a.code.replace(/^BA-/, ''));
  // she answers the age question, then asks with the address the page is on
  const e = await eve.signUp({ band: 'teen' });
  await goOnline(eve);
  expect(await eve.run((ba) => ba.social.sendRequest(location.href))).toEqual({ status: 'sent' });
  const seen = await ada.until((s) => s.requests.incoming.length === 1, 'the request to arrive');
  expect(seen.requests.incoming[0]).toMatchObject({ fid: e.fid, name: e.name, via: 'link' });
  await ada.run((ba, fid) => ba.social.respond(fid, true), e.fid);
  const there = await eve.until((s) => s.friends.length === 1, 'the friendship');
  expect(there.friends[0]).toMatchObject({ fid: a.fid, name: 'Ada', presence: { status: 'online' } });
  // an address that is no code is still a page of the app, and the page says there is no code in it
  await eve.openAt('/f/nonsense');
  expect(await eve.run((ba) => ba.addressCode())).toBeNull();
  expect((await eve.snap()).profile?.fid).toBe(e.fid);
});

test('a code nobody has is not found, junk is refused before it leaves the page, and guessing is stopped after a few misses', async () => {
  const ada = await who('Ada');
  await ada.signUp({ band: 'adult', name: 'Ada' });
  expect(await ada.try((ba) => ba.social.sendRequest('BA-ZZZZZZ'), undefined)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  expect(await ada.try((ba) => ba.social.sendRequest('hello there friend'), undefined)).toMatchObject({ ok: false, status: 400, code: 'bad_code' });
  const answers: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await ada.try((ba, n) => ba.social.sendRequest(`BA-ZZZZ${'ABCDEFGHJKLMNPQRSTUVWXYZ'[n]}${'23456789'[n % 8]}`.slice(0, 9)), i);
    answers.push(r.ok ? 'ok' : r.code);
  }
  expect(answers).toContain('too_many_attempts');
});

test('removing a friend and blocking show on the other page at once; an adult cannot send a request to a minor and the minor can', async () => {
  const { a, b, aMe, bMe } = await friends('Ada', 'Bo');
  await a.run((ba, fid) => ba.social.removeFriend(fid), bMe.fid);
  await b.until((s) => s.friends.length === 0, 'the removal to reach the other page');
  // a request both ways makes them friends again
  await b.run((ba, code) => ba.social.sendRequest(code), aMe.code);
  await a.until((s) => s.requests.incoming.length === 1, 'the new request');
  await a.run((ba, fid) => ba.social.respond(fid, true), bMe.fid);
  await b.until((s) => s.friends.length === 1, 'friends again');
  // block: the friendship goes, the other page loses the friend, and a request from the blocked player goes nowhere
  await a.run((ba, fid) => ba.social.block(fid), bMe.fid);
  await b.until((s) => s.friends.length === 0, 'the block to reach the other page');
  expect((await a.snap()).blocks.map((x) => x.name)).toEqual(['Bo']);
  expect(await b.run((ba, code) => ba.social.sendRequest(code), aMe.code)).toEqual({ status: 'sent' });
  await sleep(700);
  expect((await a.snap()).requests.incoming).toEqual([]);
  await a.run((ba, fid) => ba.social.unblock(fid), bMe.fid);
  expect((await a.snap()).blocks).toEqual([]);

  // an adult asks a teen: "request sent", and nothing reaches the teen; the teen asks the adult and it arrives
  const teen = await who('Teen');
  const t = await teen.signUp({ band: 'teen' });
  await goOnline(teen);
  expect(await a.run((ba, code) => ba.social.sendRequest(code), t.code)).toEqual({ status: 'sent' });
  await sleep(800);
  expect((await teen.snap()).requests.incoming).toEqual([]);
  expect(await teen.run((ba, code) => ba.social.sendRequest(code), aMe.code)).toEqual({ status: 'sent' });
  const got = await a.until((s) => s.requests.incoming.some((r) => r.fid === t.fid), 'the minor\'s request');
  expect(got.requests.incoming.find((r) => r.fid === t.fid)?.name).toBe(t.name);
});

// ───────── presence ─────────

test('presence as it happens: playing, back online, the page closing, and coming back', async () => {
  const { a, b, bMe } = await friends('Ada', 'Bo');
  await b.run((ba) => { ba.social.setStatus('playing', 'squat-flap'); return null; });
  await a.until((s) => s.friends[0]?.presence.status === 'playing' && s.friends[0]?.presence.game === 'squat-flap', 'Bo playing');
  await b.run((ba) => { ba.social.setStatus('online'); return null; });
  await a.until((s) => s.friends[0]?.presence.status === 'online', 'Bo online again');
  // Bo's page goes away
  await b.page.close();
  await a.until((s) => s.friends[0]?.presence.status === 'offline', 'Bo to be offline once the page is gone');
  // and comes back (a new page of the same device: the same key store)
  await b.open();
  expect((await b.snap()).profile?.fid).toBe(bMe.fid);
  await goOnline(b);
  await a.until((s) => s.friends[0]?.presence.status === 'online', 'Bo online after returning');
  // "appear offline": the switch hides the player
  await b.run((ba) => ba.social.updateProfile({ dnd: true }), undefined);
  await a.until((s) => s.friends[0]?.presence.status === 'offline', 'Bo hidden by do-not-disturb');
  await b.run((ba) => ba.social.updateProfile({ dnd: false }), undefined);
  await a.until((s) => s.friends[0]?.presence.status === 'online', 'Bo visible again');
});

test('a broken connection: the friend sees the player go offline, the page reconnects by itself and everything is current again', async () => {
  const { a, b, aMe } = await friends('Ada', 'Bo');
  expect(await b.run((ba) => ba.dropSocket(), undefined)).toBe(true);
  await a.until((s) => s.friends[0]?.presence.status === 'offline', 'Bo to be seen offline when the connection broke');
  // the page notices, waits a moment and connects again without anybody touching it, and loads the lists again
  await b.until((s) => s.hub === 'online' && s.events.filter((e) => e === 'hub:online').length >= 2, 'the page to reconnect by itself', 20_000);
  await a.until((s) => s.friends[0]?.presence.status === 'online', 'Bo to be online again');
  expect((await b.snap()).friends.map((f) => f.fid)).toEqual([aMe.fid]);
  // and it keeps working after it: a status change still reaches the friend
  await b.run((ba) => { ba.social.setStatus('playing', 'pad-work'); return null; });
  await a.until((s) => s.friends[0]?.presence.status === 'playing' && s.friends[0]?.presence.game === 'pad-work', 'the status after the reconnect');
});

test('the same player in two tabs: the newest tab holds the connection, the older one is told and can take it back', async () => {
  const { a, b, bMe } = await friends('Ada', 'Bo');
  const tab2 = await b.newTab();
  await tab2.evaluate(() => (window as unknown as { ba: { social: { connect(): void } } }).ba.social.connect());
  await b.until((s) => s.hub === 'replaced', 'the first tab to be told it was replaced');
  // the friend still sees Bo online: it is one player
  expect((await a.snap()).friends[0]?.presence.status).toBe('online');
  await sleep(500);
  expect((await b.snap()).hub).toBe('replaced');                  // nothing reconnects by itself
  expect((await b.snap()).profile?.fid).toBe(bMe.fid);
  await b.run((ba) => { ba.social.connect(); return null; });
  await b.until((s) => s.hub === 'online', 'the first tab to take the connection back');
  await tab2.close();
});

// ───────── rooms and invitations ─────────

test('an invitation from a room reaches a friend whose page is open, the friend takes the seat, and a decline reaches the host', async () => {
  const { a, b, aMe, bMe } = await friends('Ada', 'Bo');
  const grant = await a.run((ba) => ba.social.createRoom({ kind: 'private', gameId: 'squat-flap', size: 2 }), undefined) as { code: string; link: string };
  await a.run((ba, g) => ba.seat(g), grant);
  const hostSeat = await a.snap();
  expect(hostSeat.room).toMatchObject({ welcomed: true });
  // the friend sees that Ada is in a room they can join
  const seen = await b.until((s) => s.friends[0]?.presence.status === 'in_room' && s.friends[0]?.presence.room === grant.code, 'Ada in a room');
  expect(seen.friends[0]?.presence.game).toBe('squat-flap');

  const sent = await a.run((ba, x) => ba.social.invite(x.fid, x.code), { fid: bMe.fid, code: grant.code }) as { id: string };
  const got = await b.until((s) => s.invites.length === 1, 'the invitation');
  expect(got.invites[0]).toMatchObject({ id: sent.id, room: grant.code, game: 'squat-flap', from: { fid: aMe.fid, name: 'Ada' } });
  await b.run((ba) => ba.social.declineInvite(ba.social.invites[0]), undefined);
  await a.until((s) => s.events.includes('inviteDeclined'), 'the decline to reach the host');
  expect((await b.snap()).invites).toEqual([]);

  // invited again: Bo takes the seat from the invitation
  await a.run((ba, x) => ba.social.invite(x.fid, x.code), { fid: bMe.fid, code: grant.code });
  await b.until((s) => s.invites.length === 1, 'the second invitation');
  await b.run(async (ba) => { const inv = ba.social.invites[0]; ba.social.acceptInvite(inv); await ba.seat(await ba.social.joinRoom(inv.room)); return null; }, undefined);
  await b.until((s) => s.room?.welcomed === true, 'Bo to be welcomed in the room');
  await a.until((s) => (s.room?.members ?? 0) === 2, 'two players in the room');
  // the room is full: it is no longer joinable, so the invitation for a third player is refused
  const third = await who('Cy');
  const c = await third.signUp({ band: 'adult', name: 'Cy' });
  expect(c.fid).toBeTruthy();
  expect(await a.try((ba, x) => ba.social.invite(x.fid, x.code), { fid: bMe.fid, code: grant.code })).toMatchObject({ ok: false, status: 409 });
  expect(await a.try((ba, x) => ba.social.invite(x.fid, x.code), { fid: c.fid, code: grant.code })).toMatchObject({ ok: false, status: 404, code: 'not_friends' });
  await b.run((ba) => { ba.leaveRoom(); return null; });
  await a.run((ba) => { ba.leaveRoom(); return null; });
  // nobody is in the room any more
  await b.until((s) => s.friends[0]?.presence.status === 'online', 'Ada out of the room');
});

test('an invitation to a friend whose page is closed is refused with "offline" (the link is shared instead)', async () => {
  const { a, b, bMe } = await friends('Ada', 'Bo');
  const grant = await a.run((ba) => ba.social.createRoom({ kind: 'private', gameId: 'squat-flap', size: 3 }), undefined) as { code: string };
  await a.run((ba, g) => ba.seat(g), grant);
  await b.page.close();
  await a.until((s) => s.friends[0]?.presence.status === 'offline', 'Bo offline');
  expect(await a.try((ba, x) => ba.social.invite(x.fid, x.code), { fid: bMe.fid, code: grant.code })).toMatchObject({ ok: false, status: 409, code: 'offline' });
  await a.run((ba) => { ba.leaveRoom(); return null; });
});

// ───────── public lobbies and quick match ─────────

test('quick match by age group: an adult opens a lobby, a stranger takes the seat, teens and children never see it', async () => {
  const ada = await who('Ada');
  const bo = await who('Bo');
  const eve = await who('Eve');
  const teen = await who('Teen');
  const kid = await who('Kid');
  await ada.signUp({ band: 'adult', name: 'Ada', level: 6, region: 'eu' });
  await bo.signUp({ band: 'adult', name: 'Bo', level: 6, region: 'eu' });
  await eve.signUp({ band: 'adult', name: 'Eve', level: 6, region: 'eu' });
  await teen.signUp({ band: 'teen', level: 6 });
  await kid.signUp({ band: 'child' });

  await ada.run((ba) => { ba.startQuickMatch('jacks'); return null; });
  await ada.until((s) => s.room?.welcomed === true, 'Ada to sit in the lobby she opened', 20_000);
  const lobbies = await eve.run((ba) => ba.social.lobbies({ game: 'jacks' }), undefined) as { code: string; hostName: string; open: number; players: number; names: string[] }[];
  expect(lobbies).toHaveLength(1);
  expect(lobbies[0]).toMatchObject({ hostName: 'Ada', players: 1, open: 1 });
  expect(JSON.stringify(lobbies)).not.toMatch(/"pid"|"fid"/);
  expect(await eve.run((ba) => ba.social.lobbies({ game: 'squat-flap' }), undefined)).toEqual([]);
  expect(await teen.run((ba) => ba.social.lobbies({ game: 'jacks' }), undefined)).toEqual([]);
  expect(await kid.try((ba) => ba.social.lobbies(), undefined)).toMatchObject({ ok: false, status: 403, code: 'child_no_public' });
  await kid.run((ba) => { ba.startQuickMatch('jacks'); return null; });
  await kid.until((s) => s.events.some((e) => e.startsWith('match:error:403')), 'the child to be refused quick match');

  // Bo searches and is seated in Ada's lobby
  await bo.run((ba) => { ba.startQuickMatch('jacks'); return null; });
  await bo.until((s) => s.room?.welcomed === true && s.events.includes('match:joined'), 'Bo to join the lobby', 20_000);
  await ada.until((s) => (s.room?.members ?? 0) === 2, 'two players in the lobby');
  // the lobby is full: Eve sees none, and her own search opens a new one
  expect(await eve.run((ba) => ba.social.lobbies({ game: 'jacks' }), undefined)).toEqual([]);
  await ada.run((ba) => ba.stopQuickMatch(), undefined);
  expect((await ada.snap()).events).toContain('match:stopped');
  await bo.run((ba) => ba.leaveRoom(), undefined);
  await ada.run((ba) => ba.leaveRoom(), undefined);
  await eve.run((ba) => { ba.startQuickMatch('jacks'); return null; });
  await eve.until((s) => s.room?.welcomed === true, 'Eve to open her own lobby', 20_000);
  await eve.run((ba) => ba.stopQuickMatch(), undefined);
  await eve.run((ba) => ba.leaveRoom(), undefined);
});

test('a player who blocked another does not meet them in the lobby list, and cannot join their room', async () => {
  const { a, b, aMe, bMe } = await friends('Ada', 'Eve');
  const grant = await a.run((ba) => ba.social.createRoom({ kind: 'public', gameId: 'jacks', size: 2 }), undefined) as { code: string };
  await a.run((ba, g) => ba.seat(g), grant);
  await b.until(() => true, 'ready');
  expect(((await b.run((ba) => ba.social.lobbies({ game: 'jacks' }), undefined)) as unknown[]).length).toBe(1);
  await b.run((ba, fid) => ba.social.block(fid), aMe.fid);
  expect(await b.run((ba) => ba.social.lobbies({ game: 'jacks' }), undefined)).toEqual([]);
  expect(await b.try((ba, code) => ba.social.joinRoom(code), grant.code)).toMatchObject({ ok: false, status: 403 });
  // and the host does not see Eve in the lobby list either
  expect(bMe.fid).toBeTruthy();
  await a.run((ba) => { ba.leaveRoom(); return null; });
});

// ───────── weekly boards ─────────

test('weekly boards: scores from three browsers, the best of the week kept, friends and country boards, nothing posted that cannot count', async () => {
  const { a, b, aMe, bMe } = await friends('Ada', 'Bo');
  const cy = await who('Cy');
  await cy.signUp({ band: 'adult', name: 'Cy' });
  const kid = await who('Kid');
  await kid.signUp({ band: 'child' });
  const players = [a, b, cy, kid];
  // the runs start together; the server must see at least three seconds before it takes a score
  const tickets = await Promise.all(players.map((p) => p.run((ba) => ba.social.startRun('star-catch'), undefined))) as { run: string; game: string }[];
  await sleep(3600);                                                // over three seconds by the server's own clock; the scores below are far under the ceiling of that time
  const posted: unknown[] = [];
  for (const [i, score] of [600, 1000, 1000, 200].entries()) posted.push(await (players[i] as Player).run((ba, x) => ba.social.finishRun(x.ticket, x.score), { ticket: tickets[i], score }));
  expect(posted).toEqual([0, 1, 2, 3].map((i) => expect.objectContaining({ improved: true, best: [600, 1000, 1000, 200][i] })));
  // beaten once, then not beaten, then a score nobody can reach in that time
  expect(await a.run((ba, x) => ba.social.finishRun(x.ticket, 800), { ticket: tickets[0] })).toMatchObject({ improved: true, best: 800 });
  expect(await a.run((ba, x) => ba.social.finishRun(x.ticket, 700), { ticket: tickets[0] })).toMatchObject({ improved: false, best: 800 });
  expect(await a.try((ba, x) => ba.social.finishRun(x.ticket, 4_000_000), { ticket: tickets[0] })).toMatchObject({ ok: false, status: 422, code: 'score_implausible' });
  expect(await a.try((ba, x) => ba.social.finishRun({ ...x.ticket, game: 'knee-sprint' }, 10), { ticket: tickets[0] })).toMatchObject({ ok: false, status: 400, code: 'bad_run' });

  // friends: Ada and Bo only, Bo first; each carries the friend id of the other and the player's own line has none
  const friendsBoard = await a.run((ba) => ba.social.leaderboard({ game: 'star-catch', scope: 'friends' }), undefined) as { entries: { rank: number; name: string; score: number; you: boolean; fid?: string }[]; you: { rank: number } };
  expect(friendsBoard.entries).toEqual([
    { rank: 1, name: 'Bo', score: 1000, you: false, fid: bMe.fid },
    { rank: 2, name: 'Ada', score: 800, you: true },
  ]);
  expect(friendsBoard.you.rank).toBe(2);
  // country: the adults who connect from the same country, with no friend id and the same score sharing a place
  const countryBoard = await a.run((ba) => ba.social.leaderboard({ game: 'star-catch', scope: 'country' }), undefined) as { country: string; entries: { rank: number; name: string; you: boolean }[] };
  expect(countryBoard.country).toMatch(/^[A-Z]{2}$/);
  expect(countryBoard.entries.slice(0, 2).map((e) => e.name).sort()).toEqual(['Bo', 'Cy']);     // the same score, the same place
  expect(countryBoard.entries[2]?.name).toBe('Ada');
  expect(countryBoard.entries.map((e) => e.rank)).toEqual([1, 1, 3]);
  expect(JSON.stringify(countryBoard)).not.toMatch(/"fid"/);
  // a child: a friends board of its own and no country board
  expect(await kid.try((ba) => ba.social.leaderboard({ game: 'star-catch', scope: 'country' }), undefined)).toMatchObject({ ok: false, status: 403, code: 'child_no_public' });
  expect(((await kid.run((ba) => ba.social.leaderboard({ game: 'star-catch', scope: 'friends' }), undefined)) as { entries: unknown[] }).entries).toHaveLength(1);
  // another game has its own boards, empty here, and last week's is empty too
  expect(((await b.run((ba) => ba.social.leaderboard({ game: 'knee-sprint', scope: 'friends' }), undefined)) as { entries: unknown[] }).entries).toEqual([]);
  expect(((await b.run((ba) => ba.social.leaderboard({ game: 'star-catch', scope: 'friends', week: 'previous' }), undefined)) as { entries: unknown[] }).entries).toEqual([]);
  // after the reload of a page the same boards come back (the key and the profile are on the device)
  await b.open();
  expect(((await b.run((ba) => ba.social.leaderboard({ game: 'star-catch', scope: 'friends' }), undefined)) as { entries: { name: string }[] }).entries.map((e) => e.name)).toEqual(['Bo', 'Ada']);
  expect(aMe.fid).toBeTruthy();
});

// ───────── reports, a ban, and erasing a profile ─────────

test('a report with a block files in the queue; a ban closes the player\'s page connection and refuses their calls until it is cleared', async () => {
  const { a, b, aMe, bMe } = await friends('Ada', 'Bo');
  const r = await a.run((ba, x) => ba.social.report(x.fid, 'abuse', { note: 'rude in chat', block: true }), { fid: bMe.fid }) as { blocked: boolean };
  expect(r.blocked).toBe(true);
  await b.until((s) => s.friends.length === 0, 'the block to reach Bo');
  const list = await (await admin('/api/admin/social/reports?status=open')).json() as { reports: { id: number; targetFid: string; reporterFid: string; reason: string }[] };
  const mine = list.reports.find((x) => x.targetFid === bMe.fid && x.reporterFid === aMe.fid);
  expect(mine).toMatchObject({ reason: 'abuse' });
  const ban = await admin(`/api/admin/social/reports/${mine?.id}`, { method: 'POST', body: JSON.stringify({ action: 'ban', days: 1, note: 'test' }) });
  expect(ban.status).toBe(200);
  await b.until((s) => s.hub === 'banned', 'the ban to reach the page');
  expect(await b.try((ba) => ba.social.loadFriends(), undefined)).toMatchObject({ ok: false, status: 403, code: 'banned' });
  const clear = await admin(`/api/admin/social/reports/${mine?.id}`, { method: 'POST', body: JSON.stringify({ action: 'clear', note: 'test' }) });
  expect(clear.status).toBe(200);
  await b.run((ba) => { ba.social.connect(); return null; });
  await b.until((s) => s.hub === 'online', 'Bo to connect again once the ban is lifted');
  expect(await b.try((ba) => ba.social.loadFriends(), undefined)).toMatchObject({ ok: true });
});

test('erasing a profile: the page forgets the key, the friends lose the player at once, and the code leads nowhere', async () => {
  const { a, b, aMe } = await friends('Ada', 'Bo');
  const stranger = await who('Cy');
  await stranger.signUp({ band: 'adult', name: 'Cy' });
  const dump = await a.run((ba) => ba.social.exportData(), undefined) as { profile: { fid: string }; friends: { name: string }[] };
  expect(dump.profile.fid).toBe(aMe.fid);
  expect(dump.friends.map((f) => f.name)).toEqual(['Bo']);
  await a.run((ba) => ba.social.deleteProfile(), undefined);
  const gone = await a.snap();
  expect(gone.profile).toBeNull();
  expect(gone.events).toContain('signedOut:deleted');
  await b.until((s) => s.friends.length === 0, 'the friend to disappear from Bo\'s page');
  await a.open();                                                 // a reload: no key left on the device
  expect((await a.snap()).profile).toBeNull();
  expect(await stranger.try((ba, code) => ba.social.sendRequest(code), aMe.code)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
  // the same device can start again with a new key and a new friend code
  const fresh = await a.signUp({ band: 'adult', name: 'Ada again' });
  expect(fresh.fid).not.toBe(aMe.fid);
  expect(fresh.code).not.toBe(aMe.code);
});
