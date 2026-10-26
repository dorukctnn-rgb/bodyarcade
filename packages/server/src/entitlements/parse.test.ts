import { describe, expect, it } from 'vitest';
import { MAX_PURCHASES } from '../../../core/entitlements/api.ts';
import {
  cleanEmail, parseDeactivateBody, parseKeyBody, parsePlayBody, parsePurchases, parseReminderBody, parseResetBody, reminderLang,
} from './parse.ts';

const DID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'T'.repeat(40);
const BUY = { productId: 'bodyarcade_pro_yearly', purchaseToken: TOKEN };

describe('a licence key body', () => {
  it('takes a key and a device id, trims the key, and ignores the rest', () => {
    expect(parseKeyBody({ key: '  ABCD1234-EFGH5678  ', did: DID, ip: '1.2.3.4', more: 1 })).toEqual({ ok: true, value: { key: 'ABCD1234-EFGH5678', did: DID } });
  });

  it.each([
    [null], [undefined], ['x'], [5], [[]], [{}], [{ key: 'ABCD1234' }], [{ did: DID }], [{ key: 'ABCD1234', did: 'nope' }], [{ key: 'ABCD1234', did: DID.toUpperCase() }],
    [{ key: 'SHORT', did: DID }], [{ key: 'ab cd ef gh', did: DID }], [{ key: 'A'.repeat(81), did: DID }], [{ key: 12345678, did: DID }], [{ key: ['ABCD1234'], did: DID }],
  ])('refuses %j', (body) => {
    expect(parseKeyBody(body)).toEqual({ ok: false });
  });
});

describe('Play purchases', () => {
  it('keeps well-formed purchases of products we sell, once each, at most ten', () => {
    expect(parsePurchases([BUY, BUY, { productId: 'bodyarcade_lifetime', purchaseToken: 'L'.repeat(40) }])).toEqual([BUY, { productId: 'bodyarcade_lifetime', purchaseToken: 'L'.repeat(40) }]);
    const many = Array.from({ length: 30 }, (_, i) => ({ productId: 'bodyarcade_pro_monthly', purchaseToken: `${'M'.repeat(30)}${String(i).padStart(4, '0')}` }));
    expect(parsePurchases(many)).toHaveLength(MAX_PURCHASES);
  });

  it('drops what is not one: another product, a short token, a token with spaces, a shape that is not an object', () => {
    expect(parsePurchases([
      { productId: 'some_other_app_item', purchaseToken: TOKEN }, { productId: 'bodyarcade_pro_yearly', purchaseToken: 'short' }, { productId: 'bodyarcade_pro_yearly', purchaseToken: 'has a space in it!!!!' },
      { productId: '__proto__', purchaseToken: TOKEN }, { productId: 'constructor', purchaseToken: TOKEN }, null, 'x', 5, [], { purchaseToken: TOKEN }, { productId: 'bodyarcade_lifetime' },
      { productId: 'bodyarcade_pro_yearly', purchaseToken: 'x'.repeat(1025) },
    ])).toEqual([]);
    expect(parsePurchases('nope')).toEqual([]);
    expect(parsePurchases(undefined)).toEqual([]);
  });

  it('a body needs a device and at least one good purchase', () => {
    expect(parsePlayBody({ did: DID, purchases: [BUY] })).toEqual({ ok: true, value: { did: DID, purchases: [BUY] } });
    expect(parsePlayBody({ did: DID, purchases: [] })).toEqual({ ok: false });
    expect(parsePlayBody({ did: DID, purchases: [{ productId: 'x', purchaseToken: TOKEN }] })).toEqual({ ok: false });
    expect(parsePlayBody({ purchases: [BUY] })).toEqual({ ok: false });
    expect(parsePlayBody(null)).toEqual({ ok: false });
  });
});

describe('deactivate', () => {
  it('needs a token that looks like one and a device', () => {
    const token = 'h.p.s'.padEnd(60, 'x');
    expect(parseDeactivateBody({ token, did: DID })).toEqual({ ok: true, value: { token, did: DID } });
    for (const bad of [{ token: 'short', did: DID }, { token, did: 'x' }, { did: DID }, { token: 'x'.repeat(2049), did: DID }, { token: 5, did: DID }, null]) expect(parseDeactivateBody(bad)).toEqual({ ok: false });
  });
});

describe('reset', () => {
  it('takes a key, or Play purchases, with a device', () => {
    expect(parseResetBody({ did: DID, key: ' ABCD1234-EFGH5678 ' })).toEqual({ ok: true, value: { did: DID, key: 'ABCD1234-EFGH5678' } });
    expect(parseResetBody({ did: DID, purchases: [BUY] })).toEqual({ ok: true, value: { did: DID, purchases: [BUY] } });
  });
  it('refuses both missing, a bad key (even with purchases beside it), or no device', () => {
    expect(parseResetBody({ did: DID })).toEqual({ ok: false });
    expect(parseResetBody({ did: DID, key: 'bad', purchases: [BUY] })).toEqual({ ok: false });
    expect(parseResetBody({ did: DID, purchases: [] })).toEqual({ ok: false });
    expect(parseResetBody({ key: 'ABCD1234-EFGH5678' })).toEqual({ ok: false });
  });
});

describe('an address for the reminder', () => {
  it.each([
    ['player@example.com', 'player@example.com'], ['  Player.One@Example.COM ', 'Player.One@example.com'], ['a+tag@sub.example.co.uk', 'a+tag@sub.example.co.uk'], ["o'neil@example.org", "o'neil@example.org"],
  ])('accepts %j as %j', (input, expected) => {
    expect(cleanEmail(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['plainaddress'], ['@example.com'], ['a@'], ['a@b'], ['a b@example.com'], ['a@exa mple.com'], ['a@@example.com'], ['a@example..com'], ['a@-example.com'], ['<a@example.com>'], ['a@example.com\r\nBcc: x@y.z'], [`${'a'.repeat(65)}@example.com`], [`a@${'b'.repeat(250)}.com`], [5], [null], [undefined]])('refuses %j', (input) => {
    expect(cleanEmail(input)).toBeNull();
  });

  it('knows the five languages of the app and falls back to English', () => {
    expect(['en', 'tr', 'de', 'es', 'fr'].map(reminderLang)).toEqual(['en', 'tr', 'de', 'es', 'fr']);
    expect(reminderLang('tr-TR')).toBe('tr');
    expect(reminderLang('DE')).toBe('de');
    for (const other of ['pt', 'ja', '', 'x', 5, null, undefined]) expect(reminderLang(other)).toBe('en');
  });

  it('a reminder body has a token, a device, a language and an address (or null to take it back)', () => {
    const token = 'h.p.s'.padEnd(60, 'x');
    expect(parseReminderBody({ token, did: DID, email: 'a@example.com', lang: 'fr-CA' })).toEqual({ ok: true, value: { token, did: DID, email: 'a@example.com', lang: 'fr' } });
    expect(parseReminderBody({ token, did: DID, email: null, lang: 'xx' })).toEqual({ ok: true, value: { token, did: DID, email: null, lang: 'en' } });
    for (const bad of [{ token, did: DID, email: 'nope', lang: 'en' }, { token, did: DID, lang: 'en' }, { token: 'short', did: DID, email: 'a@example.com' }, { token, email: 'a@example.com' }, null]) {
      expect(parseReminderBody(bad)).toEqual({ ok: false });
    }
  });
});
