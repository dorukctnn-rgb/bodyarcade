// The daily reminder's calendar file: a valid iCalendar event that repeats every day at the player's time, with a fixed id.
import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_TIME, REMINDER_UID, escapeText, fold, parseTime, reminderCalendar } from './reminder.ts';
import { en } from './i18n/en.ts';
import { tr } from './i18n/tr.ts';

const NOW = new Date(2026, 9, 28, 9, 30, 15); // 28 Oct 2026, 09:30:15 local
const base = { now: NOW, title: 'BodyArcade workout', body: 'Time to move for a few minutes.', url: 'https://bodyarcade.com/' };

/** The file's lines with the folds undone. */
const unfold = (ics: string): string[] => ics.replace(/\r\n[ ]/g, '').split('\r\n').filter((l) => l !== '');

describe('parseTime', () => {
  it('takes hours 0 to 23 and minutes 0 to 59', () => {
    expect(parseTime('18:00')).toEqual({ h: 18, m: 0 });
    expect(parseTime('7:05')).toEqual({ h: 7, m: 5 });
    expect(parseTime('00:00')).toEqual({ h: 0, m: 0 });
    expect(parseTime('23:59')).toEqual({ h: 23, m: 59 });
    expect(parseTime(DEFAULT_REMINDER_TIME)).not.toBeNull();
  });
  it('refuses anything else', () => {
    for (const v of ['', '24:00', '12:60', '1800', '6pm', '12:5', '-1:00', '12:00:00', 'abc']) expect(parseTime(v), v).toBeNull();
  });
});

describe('reminderCalendar', () => {
  it('is null for a time that is not a time', () => {
    expect(reminderCalendar({ ...base, time: '25:00' })).toBeNull();
    expect(reminderCalendar({ ...base, time: '' })).toBeNull();
  });

  it('is one repeating daily event with the fixed id, the time and a notification at the start', () => {
    const ics = reminderCalendar({ ...base, time: '18:00' }) as string;
    const lines = unfold(ics);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines).toContain(`UID:${REMINDER_UID}`);
    expect(lines).toContain('RRULE:FREQ=DAILY');
    expect(lines).toContain('DTSTART:20261028T180000');
    expect(lines).toContain('DTEND:20261028T181500');
    expect(lines).toContain('DTSTAMP:' + `${NOW.getUTCFullYear()}${String(NOW.getUTCMonth() + 1).padStart(2, '0')}${String(NOW.getUTCDate()).padStart(2, '0')}T${String(NOW.getUTCHours()).padStart(2, '0')}${String(NOW.getUTCMinutes()).padStart(2, '0')}15Z`);
    expect(lines).toContain('BEGIN:VALARM');
    expect(lines).toContain('TRIGGER:PT0M');
    expect(lines).toContain('SUMMARY:BodyArcade workout');
    expect(lines).toContain('URL:https://bodyarcade.com/');
  });

  it('starts today when the time is still ahead and tomorrow when it has passed (never an alarm in the past)', () => {
    expect(unfold(reminderCalendar({ ...base, time: '09:31' }) as string)).toContain('DTSTART:20261028T093100');
    expect(unfold(reminderCalendar({ ...base, time: '09:30' }) as string)).toContain('DTSTART:20261029T093000');
    expect(unfold(reminderCalendar({ ...base, time: '06:00' }) as string)).toContain('DTSTART:20261029T060000');
  });

  it('rolls over a month end and a year end', () => {
    const lines = unfold(reminderCalendar({ ...base, now: new Date(2026, 11, 31, 22, 0, 0), time: '07:00' }) as string);
    expect(lines).toContain('DTSTART:20270101T070000');
    expect(lines).toContain('DTEND:20270101T071500');
  });

  it('lines end in CRLF, none is longer than 75 octets, and a fold never cuts inside a character', () => {
    const long = { ...base, title: 'Bu çok uzun bir başlık, noktalı virgül; ve ters bölü \\ içeriyor ' + 'ğüşıöç'.repeat(12), body: 'Birkaç dakika hareket etme zamanı. '.repeat(8), time: '18:00' };
    const ics = reminderCalendar(long) as string;
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    // unfolded, the words are whole and the special characters are escaped as the format asks
    const summary = unfold(ics).find((l) => l.startsWith('SUMMARY:')) as string;
    expect(summary).toContain('başlık\\, noktalı virgül\\; ve ters bölü \\\\ içeriyor');
    expect(summary).not.toContain('�');
  });

  it('the event stays one event: the same id when it is made again at another time', () => {
    const a = unfold(reminderCalendar({ ...base, time: '07:00' }) as string).find((l) => l.startsWith('UID:'));
    const b = unfold(reminderCalendar({ ...base, time: '21:15' }) as string).find((l) => l.startsWith('UID:'));
    expect(a).toBe(b);
  });

  it('the shipped words of the event are in English and Turkish, plain, with no dashes, arrows or exclamation marks', () => {
    for (const t of [en, tr]) {
      for (const k of ['reminder.title', 'reminder.body'] as const) expect(t[k], k).toMatch(/^[^–—!→]+$/);
    }
    const ics = reminderCalendar({ ...base, time: '18:00', title: tr['reminder.title'], body: tr['reminder.body'] }) as string;
    expect(unfold(ics).find((l) => l.startsWith('SUMMARY:'))).toBe(`SUMMARY:${tr['reminder.title']}`);
  });
});

describe('escapeText and fold', () => {
  it('escapes backslash, semicolon, comma and line breaks', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
  it('leaves a short line alone and breaks a long one after 75 octets with a space on the next line', () => {
    expect(fold('SHORT:line')).toBe('SHORT:line');
    const folded = fold(`X:${'a'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every((p) => p.startsWith(' ') && p.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(`X:${'a'.repeat(200)}`);
  });
});
