// The player's own profile: register (passwordless, a device key and an age band), read, change, renew the friend code,
// export every stored byte, delete everything.
import { isAgeBand, lowerBand, policyFor } from '../../../core/social/age.ts';
import { clampLevel } from '../../../core/social/levels.ts';
import { friendLink, formatFriendCode, parseFriendCode, parseRecoveryCode, randomFid, randomFriendChars } from '../../../core/social/codes.ts';
import { nameAfterBandChange, resolveName } from '../../../core/social/names.ts';
import { randomPresetName } from '../../../core/social/presets.ts';
import { DAY, LIMITS, REQUEST_TTL_MS, isLang, isRegion, regionFromContinent } from '../../../core/social/rules.ts';
import type { AgeBand, BlockEntry, DataExport, IncomingRequest, MyProfile, OutgoingRequest, Region } from '../../../core/social/types.ts';
import { HttpError } from '../http.ts';
import { meFromRow, PROFILE_COLUMNS, proveKey, type Me } from './auth.ts';
import { isUniqueError, one, rows, run, stmt } from './db.ts';
import type { D1Like } from './db.ts';
import type { SocialEnv } from './env.ts';
import { bump, bumpStmt, enforce, guard, used } from './limits.ts';
import { MAX_DEVICES, newRecovery, recoveryHash, sameHash } from './recovery.ts';
import { eraseProfile } from './people.ts';
import { hubClose, hubSend, pushPresence } from './presence.ts';
import { scoresOf } from './scores.ts';
import { addressHash, ok, randomId, type Ctx, type SocialHandler } from './util.ts';

export const DEFAULT_MAX_SIGNUPS_PER_DAY = 4000;

// ───────── the view ─────────

/** What the player sees of their own profile. */
export async function myProfile(db: D1Like, me: Me, origin: string, now: number): Promise<MyProfile> {
  const c = await one<{ friends: number; incoming: number; outgoing: number; blocks: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM soc_friends WHERE pid = ?1) AS friends,
            (SELECT COUNT(*) FROM soc_requests WHERE to_pid = ?1 AND at > ?2) AS incoming,
            (SELECT COUNT(*) FROM soc_requests WHERE from_pid = ?1 AND at > ?2) AS outgoing,
            (SELECT COUNT(*) FROM soc_blocks WHERE pid = ?1) AS blocks`,
    me.pid, now - REQUEST_TTL_MS,
  );
  const pol = policyFor(me.band);
  return {
    fid: me.fid,
    name: me.name,
    code: formatFriendCode(me.code),
    link: friendLink(origin, me.code),
    band: me.band,
    level: me.level,
    region: me.region,
    lang: me.lang,
    dnd: me.dnd,
    createdAt: me.createdAt,
    mutedUntil: me.mutedUntil > now ? me.mutedUntil : 0,
    publicBlockedUntil: me.publicBlockedUntil > now ? me.publicBlockedUntil : 0,
    counts: { friends: c?.friends ?? 0, incoming: c?.incoming ?? 0, outgoing: c?.outgoing ?? 0, blocks: c?.blocks ?? 0 },
    can: { freeName: !pol.presetNameOnly, freeText: pol.freeText, video: pol.video, publicPlay: pol.publicPlay && me.publicBlockedUntil <= now, maxFriends: pol.maxFriends },
  };
}

/** The player's row as `Me`, re-read after a change. */
export async function loadMe(db: D1Like, pid: string, kid: string): Promise<Me> {
  const r = await one<Parameters<typeof meFromRow>[0]>(db, `SELECT ${PROFILE_COLUMNS} FROM soc_profiles p WHERE p.pid = ?1`, pid);
  if (!r) throw new HttpError(404, 'not_found');
  return meFromRow(r, kid);
}

// ───────── register ─────────

/** `request.cf.continent` on Cloudflare, nothing elsewhere. */
function continentOf(req: Request): unknown {
  return (req as unknown as { cf?: { continent?: unknown } }).cf?.continent;
}

interface NewProfile { pid: string; fid: string; code: string }

function fresh(): NewProfile {
  return { pid: randomId(18), fid: randomFid(), code: randomFriendChars() };
}

/**
 * POST /api/social/register {pub, band, name?, region?, lang?, level?}. The request is signed with the key in `pub`, which
 * proves the sender holds the private half. Idempotent: registering the same key again returns the same profile.
 */
export const register = async (c: Omit<Ctx, 'me'>): Promise<Record<string, unknown> | Response> => {
  const b = c.body;
  const { pub, kid } = await proveKey(c);

  const existing = await one<Parameters<typeof meFromRow>[0]>(c.db, `SELECT ${PROFILE_COLUMNS} FROM soc_devices d JOIN soc_profiles p ON p.pid = d.pid WHERE d.kid = ?1`, kid);
  if (existing) return known(c, meFromRow(existing, kid));

  if (!isAgeBand(b.band)) throw new HttpError(400, 'bad_request', { field: 'band' });
  const band: AgeBand = b.band;
  const nm = resolveName(band, b.name);
  if (!nm.ok) throw new HttpError(400, 'name_rejected', { reason: nm.reason });
  if (b.region !== undefined && !isRegion(b.region)) throw new HttpError(400, 'bad_request', { field: 'region' });
  if (b.lang !== undefined && !isLang(b.lang)) throw new HttpError(400, 'bad_request', { field: 'lang' });
  const region: Region = isRegion(b.region) ? b.region : regionFromContinent(continentOf(c.req)) ?? 'eu';
  const lang = isLang(b.lang) ? b.lang : 'en';
  const level = clampLevel(b.level);

  const specAll = { ...LIMITS.signupsDay, max: capOf(c.env) };
  if ((await used(c.db, 'all', specAll, c.now)) >= specAll.max) throw new HttpError(503, 'closed', { retryAfterMs: DAY - (c.now % DAY) });
  const addr = c.env.SOCIAL_NO_LIMITS === '1' ? null : `a:${await addressHash(c.env, c.req)}`;
  if (addr) {
    await guard(c.db, addr, LIMITS.registerHour, c.now);
    await guard(c.db, addr, LIMITS.registerDay, c.now);
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const np = fresh();
    const rec = await newRecovery(np.pid);
    try {
      await c.db.batch([
        stmt(c.db, 'INSERT INTO soc_profiles (pid, fid, code, name, band, level, region, lang, dnd, created_at, seen_day, recovery) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11)',
          np.pid, np.fid, np.code, nm.name, band, level, region, lang, c.now, Math.floor(c.now / DAY), rec.hash),
        stmt(c.db, 'INSERT INTO soc_devices (kid, pid, pub, created_at) VALUES (?1, ?2, ?3, ?4)', kid, np.pid, pub, c.now),
        bumpStmt(c.db, 'all', specAll, c.now),
        ...(addr ? [bumpStmt(c.db, addr, LIMITS.registerHour, c.now), bumpStmt(c.db, addr, LIMITS.registerDay, c.now)] : []),
      ]);
      const me = await loadMe(c.db, np.pid, kid);
      // The recovery code is in this answer and nowhere else, ever: the server keeps a hash.
      return ok({ created: true, me: await myProfile(c.db, me, c.origin, c.now), recovery: rec.shown }, 201, c.now);
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      // Two requests with the same key at once: the other one won, answer with its profile.
      const again = await one<Parameters<typeof meFromRow>[0]>(c.db, `SELECT ${PROFILE_COLUMNS} FROM soc_devices d JOIN soc_profiles p ON p.pid = d.pid WHERE d.kid = ?1`, kid);
      if (again) return known(c, meFromRow(again, kid));
      // Otherwise a random value collided (fid, code, pid): draw new ones.
    }
  }
  throw new HttpError(503, 'unavailable');
};

/**
 * POST /api/social/recover {pub, code, recovery}: signed with the NEW device's key. The friend code names the profile and the
 * recovery code proves it is yours; the new key is added to the profile (the oldest device goes when there are five). The code
 * stays the same, so an answer that was lost on the way can be asked for again; a new one comes from renewRecovery.
 */
export const recover = async (c: Omit<Ctx, 'me'>): Promise<Record<string, unknown>> => {
  const { pub, kid } = await proveKey(c);
  const chars = parseFriendCode(c.body.code);
  const typed = parseRecoveryCode(c.body.recovery);
  if (!chars) throw new HttpError(400, 'bad_request', { field: 'code' });
  if (!typed) throw new HttpError(400, 'bad_request', { field: 'recovery' });
  const addr = c.env.SOCIAL_NO_LIMITS === '1' ? null : `a:${await addressHash(c.env, c.req)}`;
  if (addr) await guard(c.db, addr, LIMITS.recoverAddress, c.now, 'too_many_attempts');
  await guard(c.db, `rc:${chars}`, LIMITS.recoverCode, c.now, 'too_many_attempts');
  const prof = await one<{ pid: string; recovery: string }>(c.db, 'SELECT pid, recovery FROM soc_profiles WHERE code = ?1', chars);
  if (!prof || !sameHash(prof.recovery, await recoveryHash(prof.pid, typed))) {
    await bump(c.db, `rc:${chars}`, LIMITS.recoverCode, c.now);
    if (addr) await bump(c.db, addr, LIMITS.recoverAddress, c.now);
    throw new HttpError(403, 'recovery_failed');
  }
  const had = await one<{ pid: string }>(c.db, 'SELECT pid FROM soc_devices WHERE kid = ?1', kid);
  if (had && had.pid !== prof.pid) throw new HttpError(409, 'conflict');
  if (!had) {
    const n = (await one<{ n: number }>(c.db, 'SELECT COUNT(*) AS n FROM soc_devices WHERE pid = ?1', prof.pid))?.n ?? 0;
    const drop = Math.max(0, n - MAX_DEVICES + 1);
    await c.db.batch([
      ...(drop > 0 ? [stmt(c.db, 'DELETE FROM soc_devices WHERE kid IN (SELECT kid FROM soc_devices WHERE pid = ?1 ORDER BY created_at, kid LIMIT ?2)', prof.pid, drop)] : []),
      stmt(c.db, 'INSERT INTO soc_devices (kid, pid, pub, created_at) VALUES (?1, ?2, ?3, ?4)', kid, prof.pid, pub, c.now),
    ]);
  }
  const me = await loadMe(c.db, prof.pid, kid);
  return { me: await myProfile(c.db, me, c.origin, c.now) };
};

/** POST /api/social/me/recovery: a new recovery code (the old one stops working); three a day. */
export const renewRecovery: SocialHandler = async (c) => {
  await enforce(c.db, c.me.pid, LIMITS.renewRecovery, c.now);
  const next = await newRecovery(c.me.pid);
  await run(c.db, 'UPDATE soc_profiles SET recovery = ?2 WHERE pid = ?1', c.me.pid, next.hash);
  return { recovery: next.shown };
};

async function known(c: Omit<Ctx, 'me'>, me: Me): Promise<Record<string, unknown>> {
  if (me.bannedUntil > c.now) throw new HttpError(403, 'banned', { until: me.bannedUntil });
  return { created: false, me: await myProfile(c.db, me, c.origin, c.now) };
}

function capOf(env: SocialEnv): number {
  const n = Number(env.SOCIAL_MAX_SIGNUPS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_SIGNUPS_PER_DAY;
}

// ───────── me ─────────

export const getMe: SocialHandler = async (c) => ({ me: await myProfile(c.db, c.me, c.origin, c.now) });

/** POST /api/social/me {name?, region?, lang?, level?, dnd?, band? (only down), reroll?}. Only the fields sent change. */
export const updateMe: SocialHandler = async (c) => {
  const { body: b, me, db, now } = c;
  let band = me.band;
  let name = me.name;
  let bandChanged = false;
  let nameLimited = false;

  if (b.band !== undefined) {
    if (!isAgeBand(b.band)) throw new HttpError(400, 'bad_request', { field: 'band' });
    const to = lowerBand(me.band, b.band);
    if (to === null) throw new HttpError(403, 'band_locked');
    if (to !== me.band) {
      band = to;
      bandChanged = true;
      name = nameAfterBandChange(to, name);
    }
  }
  if (b.reroll === true) {
    name = randomPresetName();
    nameLimited = true;
  }
  if (b.name !== undefined && b.name !== null) {
    if (typeof b.name !== 'string') throw new HttpError(400, 'bad_request', { field: 'name' });
    if (b.name.trim() !== '') {
      const r = resolveName(band, b.name);
      if (!r.ok) throw new HttpError(400, 'name_rejected', { reason: r.reason });
      name = r.name;
      nameLimited = true;
    }
  }
  let region = me.region;
  if (b.region !== undefined) {
    if (!isRegion(b.region)) throw new HttpError(400, 'bad_request', { field: 'region' });
    region = b.region;
  }
  let lang = me.lang;
  if (b.lang !== undefined) {
    if (!isLang(b.lang)) throw new HttpError(400, 'bad_request', { field: 'lang' });
    lang = b.lang;
  }
  let level = me.level;
  let levelChanged = false;
  if (b.level !== undefined) {
    if (typeof b.level !== 'number' || !Number.isFinite(b.level)) throw new HttpError(400, 'bad_request', { field: 'level' });
    const l = clampLevel(b.level);
    levelChanged = l !== me.level;
    level = l;
  }
  let dnd = me.dnd;
  if (b.dnd !== undefined) {
    if (typeof b.dnd !== 'boolean') throw new HttpError(400, 'bad_request', { field: 'dnd' });
    dnd = b.dnd;
  }

  const nameChanged = name !== me.name;
  const changed = nameChanged || bandChanged || region !== me.region || lang !== me.lang || levelChanged || dnd !== me.dnd;
  if (!changed) return { me: await myProfile(db, me, c.origin, now) };

  // A rename (typed or rolled) is limited per day; the name that replaces a free name when the band steps down is not.
  if (nameChanged && nameLimited) await enforce(db, me.pid, LIMITS.rename, now);
  if (levelChanged) await enforce(db, me.pid, LIMITS.levelUpdate, now);

  const writes = [stmt(db, 'UPDATE soc_profiles SET name = ?2, band = ?3, region = ?4, lang = ?5, level = ?6, dnd = ?7 WHERE pid = ?1', me.pid, name, band, region, lang, level, dnd)];
  if (bandChanged && band !== 'adult') {
    // An adult may not send requests to under-18 players: requests from adults that were waiting for this player go away.
    writes.push(stmt(db, "DELETE FROM soc_requests WHERE to_pid = ?1 AND from_pid IN (SELECT pid FROM soc_profiles WHERE band = 'adult')", me.pid));
  }
  await db.batch(writes);
  if (nameChanged || dnd !== me.dnd) c.wait(pushPresence(c.env, me.pid, now));
  const next = await loadMe(db, me.pid, me.kid);
  return { me: await myProfile(db, next, c.origin, now) };
};

/** POST /api/social/me/code: a new friend code (the old one stops working at once). */
export const renewCode: SocialHandler = async (c) => {
  await enforce(c.db, c.me.pid, LIMITS.renewCode, c.now);
  for (let i = 0; i < 6; i++) {
    try {
      await run(c.db, 'UPDATE soc_profiles SET code = ?2 WHERE pid = ?1', c.me.pid, randomFriendChars());
      const next = await loadMe(c.db, c.me.pid, c.me.kid);
      return { me: await myProfile(c.db, next, c.origin, c.now) };
    } catch (e) {
      if (!isUniqueError(e)) throw e;
    }
  }
  throw new HttpError(503, 'unavailable');
};

// ───────── export and delete ─────────

/** GET /api/social/me/export: everything stored about the player, in one JSON document. */
export const exportMe: SocialHandler = async (c) => {
  const { db, me, now } = c;
  const profile = await myProfile(db, me, c.origin, now);
  const friends = await rows<{ fid: string; name: string; since: number }>(db, 'SELECT p.fid, p.name, f.since FROM soc_friends f JOIN soc_profiles p ON p.pid = f.friend WHERE f.pid = ?1 ORDER BY f.since', me.pid);
  const incoming = await rows<IncomingRequest>(db, 'SELECT p.fid, p.name, r.at, r.via FROM soc_requests r JOIN soc_profiles p ON p.pid = r.from_pid WHERE r.to_pid = ?1 ORDER BY r.at', me.pid);
  const outgoing = await rows<OutgoingRequest>(db, 'SELECT p.fid, p.name, r.at FROM soc_requests r JOIN soc_profiles p ON p.pid = r.to_pid WHERE r.from_pid = ?1 ORDER BY r.at', me.pid);
  const blocks = await rows<BlockEntry>(db, 'SELECT p.fid, p.name, b.at FROM soc_blocks b JOIN soc_profiles p ON p.pid = b.target WHERE b.pid = ?1 ORDER BY b.at', me.pid);
  const counts = await one<{ filed: number; against: number }>(db, 'SELECT (SELECT COUNT(*) FROM soc_reports WHERE reporter = ?1) AS filed, (SELECT COUNT(*) FROM soc_reports WHERE target = ?1) AS against', me.pid);
  const { counts: _counts, can: _can, ...bare } = profile;
  const data: DataExport = {
    exportedAt: now,
    profile: bare,
    friends,
    incoming,
    outgoing,
    blocks,
    scores: await scoresOf(db, me.pid, now),
    reportsFiled: counts?.filed ?? 0,
    reportsAgainstYou: counts?.against ?? 0,
  };
  return { export: data };
};

/** POST /api/social/me/delete {confirm: 'delete'}: erases the profile, the devices, the friend lists and the presence. */
export const deleteMe: SocialHandler = async (c) => {
  if (c.body.confirm !== 'delete') throw new HttpError(400, 'bad_request', { field: 'confirm' });
  await enforce(c.db, c.me.pid, LIMITS.deleteMe, c.now);
  const { friends } = await eraseProfile(c.db, c.me.pid);
  c.wait((async () => {
    await hubClose(c.env, c.me.pid, 'deleted');
    await Promise.all(friends.map((f) => hubSend(c.env, f, { t: 'friend_removed', fid: c.me.fid })));
  })());
  return { deleted: true };
};
