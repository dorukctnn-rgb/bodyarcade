// The daily reminder of the Android app: one repeating event for the phone's calendar app (an iCalendar file, RFC 5545).
//
// Why a calendar file and not a push message: a push needs the phone's address on our server, an account-less identity and a sender we
// run every day, and the privacy policy and the Play data safety form would have to say so. A calendar event needs none of it. The
// player picks the time, the calendar app of the phone does the reminding (its own notification), nothing is sent to us and nothing
// is read from the calendar. To stop it, the player deletes the event there. The file has a fixed id (UID), so adding it again moves
// the same event to the new time instead of making a second one.
//
// Pure: no browser, no clock of its own (the caller passes `now`), so a test can read the file it makes.

/** The name the phone saves the file under. */
export const REMINDER_FILE = 'bodyarcade-reminder.ics';
export const REMINDER_UID = 'daily-workout@bodyarcade.com';
export const DEFAULT_REMINDER_TIME = '18:00';

/** "18:00" or "7:05": hours 0 to 23, minutes 0 to 59. Anything else is not a time. */
export function parseTime(v: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? { h, m: min } : null;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** A local date and time without a zone ("floating"): the event happens at that wall-clock time wherever the phone is. */
const local = (d: Date): string => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}T${two(d.getHours())}${two(d.getMinutes())}00`;
const utc = (d: Date): string => `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;

/** RFC 5545 text escaping: backslash, semicolon, comma and line breaks. */
export const escapeText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Content lines are at most 75 octets: longer ones continue on the next line after a space. Never cuts inside a character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export interface ReminderOptions {
  /** "HH:MM", the time of day. */
  time: string;
  /** The current moment: the first event is today when the time is still ahead, otherwise tomorrow. */
  now: Date;
  /** The words of the player's language. */
  title: string;
  body: string;
  /** Where the event points: the site, which opens the app on a phone that has it. */
  url: string;
  /** How long the event lasts, in minutes (default 15). */
  minutes?: number;
}

/** The calendar file, or null for a time that is not a time. Lines end in CRLF as the format asks. */
export function reminderCalendar(o: ReminderOptions): string | null {
  const t = parseTime(o.time);
  if (!t) return null;
  const start = new Date(o.now.getFullYear(), o.now.getMonth(), o.now.getDate(), t.h, t.m, 0, 0);
  if (start.getTime() <= o.now.getTime()) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + (o.minutes ?? 15) * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Peak Apps Studio//BodyArcade//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${REMINDER_UID}`,
    `DTSTAMP:${utc(o.now)}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:${escapeText(o.title)}`,
    `DESCRIPTION:${escapeText(`${o.body} ${o.url}`)}`,
    `URL:${o.url}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(o.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
