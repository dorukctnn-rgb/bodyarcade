import { describe, expect, it } from 'vitest';
import { CHAT_MAX_CHARS, checkChat, checkName, hasProfanity, sanitize } from './chat-filter.ts';

const reason = (s: string) => { const r = checkChat(s); return r.ok ? 'ok' : r.reason; };

describe('checkChat: ordinary messages pass (false-positive corpus)', () => {
  const ok = [
    'Good game!', 'One more?', 'That was close', 'I passed 12 obstacles', 'class assignment', 'pass', 'assassin',
    'Scunthorpe', 'cocktail party', 'Dickens is great', 'analysis', 'therapist', 'button', 'Essex and Sussex',
    'I got 12345 points', 'score 1200 vs 1500', 'see you at 7:30', 'my email is private', 'shall we go again?',
    'grape juice', 'documents', 'snapshot', 'I am ready', 'as you like', 'hello there', 'pic of the day',
    'I got it', 'computadora nueva', 'examinar', 'bite me not', 'con permiso',
    // Turkish
    'Sık sık oynarız', 'Sıkıldım biraz', 'Götür beni eve', 'oynayarak öğreniyoruz', 'boyayarak', 'amcam geldi',
    'amacımız kazanmak', 'iyi oyundu', 'bir tur daha?', 'çok iyiydin', 'Şerefe!', 'meme', 'ama neden',
    'Amina ile oynadık', 'yarın görüşürüz', 'sıkıştım', 'kahve içelim', 'puşet', 'pusula',
    // German, Spanish, French
    'Gut gemacht', 'Fickle weather', 'buenas noches', 'computación', 'Muy bien jugado', 'bien joué', 'merci',
    'à demain', 'conocer',
    // self-censored spellings are allowed on purpose
    'f*ck off', 'sh*t happens',
    // all-caps Turkish with a capital I is ambiguous (SIK can be "sık", often)
    'SIK SIK OYNARIZ',
  ];
  for (const s of ok) it(JSON.stringify(s), () => expect(reason(s)).toBe('ok'));
});

describe('checkChat: profanity is blocked, including disguised spellings', () => {
  const bad = [
    'fuck', 'FUCK YOU', 'what the fuuuuck', 'f u c k', 'f.u.c.k', 'fck', 'sh1t', 'shiiit', 'bullshit', 'asssshole',
    'you bitch', 'b1tch', 'asshole', 'a$$hole', 'dickhead', 'motherfucker', 'ｆｕｃｋ', 'fu​ck', 'fυck',
    'kill yourself', 'kys', 'nigger', 'faggot', 'slut', 'porn', 'p0rn', 'nudes', 'cunt', 'retarded',
    // Turkish
    'amk', 'AMK', 'aq', 'orospu', 'orospu çocuğu', 'oç', 'piç', 'siktir', 'siktir git', 'SİKTİR', 's1kt1r', 'sikerim',
    'yarrak', 'göt', 'ibne', 'pezevenk', 'kahpe', 'şerefsiz', 'serefsiz', 'yavşak', 'amına', 'amcık', 'sürtük',
    // German, Spanish, French
    'Scheiße', 'scheisse', 'Hurensohn', 'Arschloch', 'fotze', 'puta', 'la puta madre', 'mierda', 'gilipollas',
    'pendejo', 'putain', 'merde', 'salope', 'connard', 'enculé', 'ta gueule',
  ];
  for (const s of bad) it(JSON.stringify(s), () => expect(reason(s)).toBe('profanity'));
});

describe('checkChat: contact details are blocked', () => {
  const cases: [string, string][] = [
    ['visit https://example.com', 'link'], ['www.example.org', 'link'], ['go to example . com', 'link'],
    ['site dot com', 'link'], ['bodyarcade nokta com', 'link'], ['t.me/someone', 'link'], ['discord.gg/abc', 'link'],
    ['instagram.com/me', 'link'], ['mail me at bob@example.com', 'email'], ['bob (at) example (dot) com', 'email'],
    ['my gmail is bob', 'email'], ['call 0555 123 45 67', 'phone'], ['+90 (555) 123-4567', 'phone'],
    ['5551234567', 'phone'], ['555.123.4567', 'phone'], ['add me @coolguy99', 'handle'],
  ];
  for (const [s, r] of cases) it(JSON.stringify(s), () => expect(reason(s)).toBe(r));

  it('allows short numbers and times', () => {
    expect(reason('round 3, 2 to go, 45 s left at 12:30')).toBe('ok');
    expect(reason('I scored 123 456')).toBe('ok');
  });
});

describe('checkChat: length and emptiness', () => {
  it('rejects empty and whitespace-only messages', () => {
    expect(reason('')).toBe('empty');
    expect(reason('   ​  ')).toBe('empty');
  });

  it('counts characters, not UTF-16 units, and allows exactly 200', () => {
    expect(reason('a'.repeat(CHAT_MAX_CHARS))).toBe('ok');
    expect(reason('a'.repeat(CHAT_MAX_CHARS + 1))).toBe('too_long');
    expect(reason('ğ'.repeat(CHAT_MAX_CHARS))).toBe('ok');
  });

  it('returns cleaned text', () => {
    const r = checkChat('  hello​   there\n ');
    expect(r).toEqual({ ok: true, text: 'hello there' });
  });

  it('strips direction overrides and control characters', () => {
    expect(sanitize('a‮b\u0007c')).toBe('abc');
  });
});

describe('checkName', () => {
  it('accepts ordinary names in several scripts', () => {
    for (const n of ['Ayşe', 'Doruk', 'Jean-Luc', 'mr_smith', 'Ömer 2', 'Zoë']) expect(checkName(n)).toEqual({ ok: true, text: n });
  });

  it('rejects long names, symbols, contact details and profanity', () => {
    expect(checkName('x'.repeat(21))).toEqual({ ok: false, reason: 'too_long' });
    expect(checkName('<script>')).toEqual({ ok: false, reason: 'handle' });
    expect(checkName('@bob')).toEqual({ ok: false, reason: 'handle' });
    expect(checkName('5551234567')).toEqual({ ok: false, reason: 'phone' });
    expect(checkName('bob.com')).toEqual({ ok: false, reason: 'link' });
    expect(checkName('siktir')).toEqual({ ok: false, reason: 'profanity' });
    expect(checkName('')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('hasProfanity is stable on odd input', () => {
  it('handles emoji, mixed scripts and very long words without throwing', () => {
    expect(hasProfanity('🙂🙂🙂')).toBe(false);
    expect(hasProfanity('a'.repeat(5000))).toBe(false);
    expect(hasProfanity('日本語のテキスト')).toBe(false);
  });
});
