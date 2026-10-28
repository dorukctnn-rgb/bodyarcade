// The Android app's own rows on the settings page ("This app": offline play and the daily reminder): drawn only for the app, in every
// state, in both languages, with the words the player is promised and nothing the web page did not already have.
import { describe, expect, it } from 'vitest';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { stringTables } from '../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { makeContext } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import type { OfflineView } from './app/offline.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];

function settings(lang: Lang, app: { offline: OfflineView | null; reminderTime: string } | null): { html: string; text: string; missing: string[] } {
  const missing: string[] = [];
  const url = lang === 'en' ? '/settings/' : `/${lang}/settings/`;
  const ctx = makeContext({ lang, games, url, i18n: { onMissing: (k, l) => missing.push(`${l}:${k}`) } });
  const html = renderPage(ctx, router.match(url), { ...EMPTY_STATE, app }).body.value;
  return { html, text: textOf(html), missing };
}

describe('settings: the web page is the page it was', () => {
  it.each(LANGS)('%s: no app rows, no reminder, no offline row when the page is not the app\'s', (lang) => {
    const { html, text } = settings(lang, null);
    expect(html).not.toMatch(/data-offline|data-reminder-time|offline-save|reminder-add|k-reminder|s-app/);
    expect(text).not.toContain(stringTables[lang]['settings.section.app'] as string);
  });
});

describe.each(LANGS)('settings: the app rows in %s', (lang) => {
  const t = stringTables[lang];
  const mb = 20;
  const cases: [OfflineView, RegExp, 'button' | 'badge' | 'bar' | 'none'][] = [
    [{ kind: 'checking' }, new RegExp(`${(t['settings.offline.checking'] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'none'],
    [{ kind: 'missing', mb }, /20 MB/, 'button'],
    [{ kind: 'saved', mb }, /20 MB/, 'badge'],
    [{ kind: 'saving', pct: 42 }, /42/, 'bar'],
    [{ kind: 'failed', mb }, new RegExp((t['settings.offline.failed'] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'button'],
  ];

  it.each(cases)('offline state %j says what is true and offers the right control', (view, words, control) => {
    const { html, text, missing } = settings(lang, { offline: view, reminderTime: '18:00' });
    expect(missing).toEqual([]);
    expect(text).not.toMatch(/undefined|\[object|NaN|\{[a-z]+\}/);
    expect(text).toContain(t['settings.section.app'] as string);
    expect(text).toContain(t['settings.offline'] as string);
    expect(text).toMatch(words);
    expect(html).toContain(`data-offline="${view.kind}"`);
    expect(html.includes('data-action="offline-save"')).toBe(control === 'button');
    expect(html.includes('k-offline-ok')).toBe(control === 'badge');
    expect(html.includes('data-offline-bar')).toBe(control === 'bar');
    // the sentence about saving is in a node the page can patch without drawing everything again
    expect(html).toContain('data-offline-status');
  });

  it('a phone that cannot keep files has no offline row, and still has the reminder', () => {
    const { html, text } = settings(lang, { offline: null, reminderTime: '07:30' });
    expect(html).not.toContain('data-offline');
    expect(text).not.toContain(t['settings.offline'] as string);
    expect(html).toContain('data-reminder-time');
  });

  it('the reminder is a time field with a label, its value kept, and one button', () => {
    const { html, text } = settings(lang, { offline: { kind: 'missing', mb }, reminderTime: '07:30' });
    expect(html).toMatch(/<input[^>]*type="time"[^>]*name="reminderTime"[^>]*value="07:30"/);
    expect(html).toContain(`aria-label="${t['settings.reminder.time'] as string}"`);
    expect(html.match(/data-action="reminder-add"/g)).toHaveLength(1);
    expect(text).toContain(t['settings.reminder'] as string);
    // says plainly what it does and what it does not do
    expect(t['settings.reminder.hint']).toMatch(lang === 'en' ? /calendar.*sends nothing.*never reads/s : /takvim.*göndermez.*okumaz/s);
  });

  it('every new sentence follows the copy rules', () => {
    const keys = Object.keys(t).filter((k) => /^(settings\.(offline|reminder)|reminder\.|play\.err\.pose_offline)/.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(19);
    for (const k of keys) expect(copyProblems(t[k] as string), `${lang} ${k}`).toEqual([]);
  });
});

describe('the offline sentence in a round', () => {
  it('exists in both languages and names the way out', () => {
    expect(stringTables.en['play.err.pose_offline']).toMatch(/offline.*Connect once/);
    expect(stringTables.tr['play.err.pose_offline']).toMatch(/Çevrimdışısın.*bağlan/);
  });
});
