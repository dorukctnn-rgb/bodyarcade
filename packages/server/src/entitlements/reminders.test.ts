// The one e-mail promised on the web: two days before a free trial ends, to a player who left an address for it.
import { describe, expect, it } from 'vitest';
import { REMINDER_LANGS, type ReminderLang } from '../../../core/entitlements/api.ts';
import { reminderMail, trialEndText } from './mail.ts';
import { RECHECK_S, REMINDER_LEAD_S, sha256Hex, normalizeKey } from './rules.ts';
import { DAY, DIDS, KEYS, PRODUCT_PRO_MONTHLY, PRODUCT_PRO_YEARLY, makeRig, type Rig } from './testkit.ts';

const [KEY, KEY2] = KEYS as unknown as [string, string];
const [D0, D1] = DIDS as [string, string, string, string, string, string, string, string];
const ADDRESS = 'Player.One@Example.COM';

async function trialRig(): Promise<{ r: Rig; token: string; trialEnd: number }> {
  const r = await makeRig();
  r.gum.add(PRODUCT_PRO_YEARLY, KEY);
  const res = await r.engine.grantKey({ key: KEY, did: D0 }, '');
  return { r, token: String(res.body['token']), trialEnd: r.clock.now() / 1000 + 7 * 86_400 };
}
const ask = (r: Rig, token: string, email: string | null, over: { did?: string; lang?: ReminderLang } = {}) =>
  r.engine.reminder({ token, did: over.did ?? D0, email, lang: over.lang ?? 'en' }, '');
const rows = (r: Rig) => r.db.all<{ sub: string; email: string; lang: string; send_at: number; trial_end: number; tries: number }>('SELECT * FROM reminders');

describe('leaving an address for the trial', () => {
  it('keeps it for one reminder, due two days before the trial ends', async () => {
    const { r, token, trialEnd } = await trialRig();
    const res = await ask(r, token, ADDRESS, { lang: 'tr' });
    expect(res).toMatchObject({ status: 200, body: { ok: true, sendAt: (trialEnd - REMINDER_LEAD_S) * 1000 } });
    expect(rows(r)).toEqual([{ sub: await sha256Hex(normalizeKey(KEY)), email: ADDRESS, lang: 'tr', send_at: trialEnd - REMINDER_LEAD_S, trial_end: trialEnd, created_at: r.clock.now() / 1000, tries: 0 }]);
    expect(r.mail.attempts).toHaveLength(0);                               // nothing is sent now
    expect(r.engine.nextDue()).toBe((trialEnd - REMINDER_LEAD_S) * 1000);
  });

  it('one address for each purchase: a second one replaces the first', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, 'first@example.com');
    await ask(r, token, 'second@example.com', { lang: 'de' });
    expect(rows(r).map((x) => [x.email, x.lang])).toEqual([['second@example.com', 'de']]);
  });

  it('takes it back when asked: nothing is kept, nothing is sent', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    expect(await ask(r, token, null)).toMatchObject({ status: 200, body: { ok: true, sendAt: null } });
    expect(rows(r)).toHaveLength(0);
    r.clock.advance(6 * DAY);
    await r.engine.sweep();
    expect(r.mail.attempts).toHaveLength(0);
    expect(r.engine.nextDue()).toBeNull();
  });

  it('is set late (inside the last two days) and goes out at the next sweep', async () => {
    const { r, token } = await trialRig();
    r.clock.advance(6 * DAY);
    r.clock.advance((RECHECK_S + 1) * 1000);
    const fresh = String((await r.engine.grantKey({ key: KEY, did: D0 }, '', 'refresh')).body['token']);
    const res = await ask(r, fresh, ADDRESS);
    expect(res.body['sendAt']).toBe(r.clock.now());
    await r.engine.sweep();
    expect(r.mail.sent).toHaveLength(1);
  });

  describe('refuses', () => {
    it('a purchase that has no trial running: a monthly plan, a trial that is over, a trial that was cancelled', async () => {
      const r = await makeRig();
      r.gum.add(PRODUCT_PRO_MONTHLY, KEY);
      const monthly = String((await r.engine.grantKey({ key: KEY, did: D0 }, '')).body['token']);
      expect(await ask(r, monthly, ADDRESS)).toMatchObject({ status: 409, body: { error: 'no_trial' } });

      const over = await trialRig();
      over.r.clock.advance(8 * DAY);
      over.r.gum.purchase(PRODUCT_PRO_YEARLY, KEY)['sale_timestamp'] = new Date(over.r.clock.now() - 8 * DAY).toISOString();
      const fresh = String((await over.r.engine.grantKey({ key: KEY, did: D0 }, '', 'refresh')).body['token']);
      expect(await ask(over.r, fresh, ADDRESS)).toMatchObject({ status: 409, body: { error: 'no_trial' } });

      const cancelled = await makeRig();
      cancelled.gum.add(PRODUCT_PRO_YEARLY, KEY, { subscription_cancelled_at: new Date(cancelled.clock.now() + 3 * DAY).toISOString() });
      const t = String((await cancelled.engine.grantKey({ key: KEY, did: D0 }, '')).body['token']);
      expect(await ask(cancelled, t, ADDRESS)).toMatchObject({ status: 409, body: { error: 'no_trial' } });
      expect(rows(cancelled)).toHaveLength(0);
    });

    it('a token that is not ours, of another device, or that has run out; and a device without a purchase', async () => {
      const { r, token } = await trialRig();
      expect((await ask(r, `${token.slice(0, -4)}AAAA`, ADDRESS)).status).toBe(400);
      expect((await ask(r, token, ADDRESS, { did: D1 })).status).toBe(400);
      r.clock.advance(8 * DAY);
      expect((await ask(r, token, ADDRESS)).status).toBe(400);
      expect(rows(r)).toHaveLength(0);
    });

    it('everything when the Worker has no mail service: "unavailable", and nothing is stored', async () => {
      const r = await makeRig({ mail: false });
      r.gum.add(PRODUCT_PRO_YEARLY, KEY);
      const token = String((await r.engine.grantKey({ key: KEY, did: D0 }, '')).body['token']);
      expect(await ask(r, token, ADDRESS)).toMatchObject({ status: 503, body: { error: 'unavailable' } });
      expect(rows(r)).toHaveLength(0);
    });

    it('ten addresses an hour from one place (a bot filling in a form)', async () => {
      const r = await makeRig({ noLimits: false });
      r.gum.add(PRODUCT_PRO_YEARLY, KEY);
      const token = String((await r.engine.grantKey({ key: KEY, did: D0 }, '198.51.100.9')).body['token']);
      for (let i = 0; i < 10; i++) expect((await r.engine.reminder({ token, did: D0, email: `a${i}@example.com`, lang: 'en' }, '198.51.100.9')).status).toBe(200);
      const eleventh = await r.engine.reminder({ token, did: D0, email: 'b@example.com', lang: 'en' }, '198.51.100.9');
      expect(eleventh.status).toBe(429);
      expect(Number(eleventh.headers?.['Retry-After'])).toBeGreaterThan(0);
    });
  });
});

describe('the reminder going out', () => {
  it('is sent once, when it is due, in the language asked for, and the address is deleted at once', async () => {
    const { r, token, trialEnd } = await trialRig();
    await ask(r, token, ADDRESS, { lang: 'de' });
    r.clock.advance(4 * DAY);
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 0 });
    expect(r.mail.sent).toHaveLength(0);
    r.clock.advance(DAY + 3600_000);                                       // five days and an hour in: past the due time, a little before the end
    const report = await r.engine.sweep();
    expect(report).toMatchObject({ remindersSent: 1, remindersDropped: 0 });
    expect(r.mail.sent).toHaveLength(1);
    const m = r.mail.sent[0]!;
    expect(m.to).toBe(ADDRESS);
    expect(m.subject).toBe('Deine kostenlose BodyArcade-Testphase endet in 2 Tagen');
    expect(m.text).toContain(trialEndText(trialEnd * 1000, 'de'));
    expect(rows(r)).toHaveLength(0);
    expect(JSON.stringify(r.db.all('SELECT * FROM purchases'))).not.toContain('Example');
    await r.engine.sweep();
    expect(r.mail.sent).toHaveLength(1);                                   // never twice
  });

  it('is not sent for a trial that was cancelled in the meantime (the next renewal showed it): the address goes without a mail', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.gum.purchase(PRODUCT_PRO_YEARLY, KEY)['subscription_cancelled_at'] = new Date(r.clock.now() + 7 * DAY).toISOString();
    r.clock.advance(3 * DAY);
    await r.engine.grantKey({ key: KEY, did: D0 }, '', 'refresh');         // the device renewed and the seller said "cancelled"
    r.clock.advance(3 * DAY);
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 0, remindersDropped: 1 });
    expect(r.mail.attempts).toHaveLength(0);
    expect(rows(r)).toHaveLength(0);
  });

  it('is not sent for a purchase that was refunded', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.gum.purchase(PRODUCT_PRO_YEARLY, KEY)['refunded'] = true;
    r.clock.advance(3 * DAY);
    await r.engine.grantKey({ key: KEY, did: D0 }, '', 'refresh');
    r.clock.advance(3 * DAY);
    await r.engine.sweep();
    expect(r.mail.attempts).toHaveLength(0);
    expect(rows(r)).toHaveLength(0);
  });

  it('is dropped, unsent, when the trial is over before anyone swept (the server was down)', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.clock.advance(9 * DAY);
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 0 });
    expect(r.mail.attempts).toHaveLength(0);
    expect(rows(r)).toHaveLength(0);
  });

  it('is tried again an hour later when the mail service is down, five times at most, and then the address goes', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.clock.advance(5 * DAY + 1000);
    r.mail.result = 'retry';
    for (let i = 1; i <= 4; i++) {
      expect(await r.engine.sweep(), `try ${i}`).toMatchObject({ remindersRetried: 1 });
      expect(rows(r)[0]?.tries).toBe(i);
      await r.engine.sweep();                                              // too early: nothing more happens within the hour
      expect(r.mail.attempts).toHaveLength(i);
      r.clock.advance(3600_000);
    }
    expect(await r.engine.sweep()).toMatchObject({ remindersRetried: 0, remindersDropped: 1 });
    expect(rows(r)).toHaveLength(0);
    expect(r.mail.attempts).toHaveLength(5);
  });

  it('is sent on the second try when the service comes back', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.clock.advance(5 * DAY + 1000);
    r.mail.result = 'retry';
    await r.engine.sweep();
    r.mail.result = 'sent';
    r.clock.advance(3600_000);
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 1 });
    expect(rows(r)).toHaveLength(0);
  });

  it('is dropped at once when the service refuses the address for good', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.clock.advance(5 * DAY + 1000);
    r.mail.result = 'drop';
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 0, remindersDropped: 1 });
    expect(rows(r)).toHaveLength(0);
  });

  it('handles at most 25 a sweep, and the rest are still due', async () => {
    const r = await makeRig();
    const keys: string[] = [];
    for (let i = 0; i < 30; i++) {
      const key = `KEY${String(i).padStart(5, '0')}-AAAAAAAA-BBBBBBBB-CCCCCCCC`;
      keys.push(key);
      r.gum.add(PRODUCT_PRO_YEARLY, key);
      const t = String((await r.engine.grantKey({ key, did: D0 }, '')).body['token']);
      await ask(r, t, `p${i}@example.com`);
    }
    r.clock.advance(5 * DAY + 1000);
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 25 });
    expect(r.engine.nextDue()).not.toBeNull();
    expect(await r.engine.sweep()).toMatchObject({ remindersSent: 5 });
    expect(r.engine.nextDue()).toBeNull();
  });

  it('puts no address in a log line, and no address in the database after it is sent', async () => {
    const { r, token } = await trialRig();
    await ask(r, token, ADDRESS);
    r.clock.advance(5 * DAY + 1000);
    await r.engine.sweep();
    expect(JSON.stringify(r.logs)).not.toContain('example.com');
    expect(JSON.stringify(['purchases', 'seats', 'reminders', 'meta'].map((t) => r.db.all(`SELECT * FROM ${t}`)).concat([r.db.all('SELECT * FROM reminders')]))).not.toMatch(/example\.com/i);
    expect(r.logs.some((l) => l.evt === 'reminder' && l.data['result'] === 'sent')).toBe(true);
  });
});

describe('the mail itself', () => {
  const END = Date.UTC(2026, 10, 1, 14, 5);

  it.each(REMINDER_LANGS)('is written in %s: a subject, the end of the trial in UTC, how to cancel, and that the address is not kept', (lang) => {
    const m = reminderMail('a@example.com', lang, END);
    expect(m.to).toBe('a@example.com');
    expect(m.subject.length).toBeGreaterThan(20);
    expect(m.text).toContain(trialEndText(END, lang));
    expect(trialEndText(END, lang)).toMatch(/14:05 UTC$/);
    expect(m.text).toContain('Gumroad');
    expect(m.text).toContain('Manage membership');
    expect(m.text.trim().endsWith('BodyArcade')).toBe(true);
    expect(m.text.split('\n\n').length).toBeGreaterThanOrEqual(5);
  });

  it('follows the interface text rules: no dash used as a pause, no arrow, no emoji, no Play, no hype', () => {
    for (const lang of REMINDER_LANGS) {
      const m = reminderMail('a@example.com', lang, END);
      const text = `${m.subject}\n${m.text}`;
      expect(text, lang).not.toMatch(/[—–→←➡]/);
      expect(text, lang).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text, lang).not.toMatch(/Google Play|Play Store|!/);
    }
  });

  it('says the date the way its language does', () => {
    expect(trialEndText(END, 'en')).toContain('1 November 2026');
    expect(trialEndText(END, 'tr')).toContain('1 Kasım 2026');
    expect(trialEndText(END, 'de')).toContain('1. November 2026');
    expect(trialEndText(END, 'es')).toContain('1 de noviembre de 2026');
    expect(trialEndText(END, 'fr')).toContain('1 novembre 2026');
  });

  it('has Turkish with its own characters', () => {
    const m = reminderMail('a@example.com', 'tr', END);
    expect(m.subject).toBe('BodyArcade ücretsiz denemen 2 gün içinde bitiyor');
    expect(m.text).toMatch(/[ğşıöüç]/);
  });
});
