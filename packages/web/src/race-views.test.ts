// The screens around a race against a recording, without a browser: the window that asks who to race, the card a friend's link opens,
// and what the results say. The clicks and the whole race are the end-to-end test's (e2e/race.spec.ts).
import { describe, expect, it } from 'vitest';
import { courseOf, runFromResults, type GhostRun } from '../../core/net/ghost.ts';
import { GhostBook } from '../../core/net/ghost-book.ts';
import type { KeyValueStore } from '../../core/net/identity.ts';
import type { ObstacleResult } from '../../core/types/net.ts';
import { escapeHtml } from '../../core/ui/html.ts';
import { createI18n, type Lang } from '../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { ghostMenu, raceMsOf, type GhostMenu, type RaceOutcome } from './app/race.ts';
import { makeContext } from './make-context.ts';
import { defaultChoice, ghostDialog, ghostOffer, labelText, raceBlock, winnerName, type GhostChoice } from './views/race.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const AT = Date.UTC(2026, 9, 21, 14, 0);
const GAME = { id: 'squat-flap', durationSec: 270 };
const MS = raceMsOf(GAME);
const memory = (): KeyValueStore => { const m = new Map<string, string>(); return { get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };
const ctx = (lang: Lang = 'en') => makeContext({ lang, games, url: '/games/squat-flap/' });

function recording(pass: number, o: { source?: GhostRun['source']; name?: string } = {}): GhostRun {
  const base = { gameId: 'squat-flap', seed: 77, durationMs: MS };
  const results: ObstacleResult[] = courseOf(base).map((ob, i) => ({ ob: ob.id, k: i < pass ? 'pass' : 'hit' }));
  return runFromResults({ ...base, results, name: o.name ?? 'Ada', at: AT, source: o.source ?? 'friend' });
}

function menu(o: { own?: boolean; friends?: GhostRun[]; family?: { id: string; name: string; run: GhostRun }[]; all?: boolean } = {}): GhostMenu {
  const book = new GhostBook(memory());
  if (o.own) book.offer(recording(6, { source: 'own', name: 'Me' }));
  for (const f of o.friends ?? []) book.addFriend(f);
  const others = (o.family ?? []).map((f) => {
    const b = new GhostBook(memory());
    b.offer({ ...f.run, source: 'own' });
    return { id: f.id, name: f.name, avatar: 'fox' as const, ghosts: b };
  });
  return ghostMenu({ game: GAME, ghosts: book, rules: { ghosts: o.all === false ? 'family' : 'all' }, others });
}

const choice = (m: GhostMenu, over: Partial<GhostChoice> = {}): GhostChoice => ({ ...defaultChoice(m), ...over });

describe('the window "Race a ghost"', () => {
  it('has the practice partner to begin with when the player has no run of their own, and says why their best cannot be taken', () => {
    const m = menu();
    const h = ghostDialog(ctx(), m, choice(m)).value;
    expect(defaultChoice(m).value).toBe('practice');
    expect(h).toContain('role="radiogroup"');
    expect(h).toMatch(/<input type="radio" name="ghost" value="own"[^>]*disabled/);
    expect(h).toContain('Race a ghost once and your best run is kept here.');
    expect(h).toMatch(/<input type="radio" name="ghost" value="practice:medium"[^>]*checked/);
    expect(h).toContain('A bot, not a person.');
    // the level shows while the practice partner is chosen, as real radios
    expect(h).toContain('name="level"');
    for (const l of ['easy', 'medium', 'hard']) expect(h).toContain(`name="level" value="${l}"`);
  });

  it('offers the best run of the player first when there is one, with its points and its day', () => {
    const m = menu({ own: true });
    expect(defaultChoice(m).value).toBe('own');
    const h = ghostDialog(ctx(), m, choice(m)).value;
    expect(h).toMatch(/<input type="radio" name="ghost" value="own"[^>]*checked/);
    expect(h).not.toMatch(/<input type="radio" name="ghost" value="own"[^>]*disabled/);
    expect(h).toMatch(/\d+ points?, /);
    // the level is not there while another recording is chosen
    expect(h).not.toContain('name="level"');
  });

  it('lists the family and the friends by their names, with words that cannot become markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const m = menu({ friends: [recording(4, { name: evil })], family: [{ id: 'p2', name: 'Defne "D" <b>', run: recording(5) }] });
    const h = ghostDialog(ctx(), m, choice(m)).value;
    expect(h).toContain(escapeHtml('Best run of Defne "D" <b>'));
    expect(h).toContain(escapeHtml(`Recording of ${evil}`));
    expect(h).not.toContain(evil);
    expect(h).toContain('value="family:p2"');
  });

  it('has a box for a code for a grown-up only, and says what the box answered', () => {
    const adult = menu();
    const child = menu({ all: false });
    expect(ghostDialog(ctx(), adult, choice(adult)).value).toContain('id="race-code"');
    expect(ghostDialog(ctx(), child, choice(child)).value).not.toContain('id="race-code"');
    const bad = ghostDialog(ctx(), adult, choice(adult, { note: { kind: 'bad' } })).value;
    expect(bad).toContain('That is not a recording. Check the code and try again.');
    expect(bad).toMatch(/class="[^"]*pf-error[^"]*"[^>]*id="race-code-note"/);
    expect(ghostDialog(ctx(), adult, choice(adult, { note: { kind: 'game' } })).value).toContain('That recording is of another game.');
    const added = ghostDialog(ctx(), adult, choice(adult, { note: { kind: 'added', label: 'Recording of Ada' } })).value;
    expect(added).toContain('Recording of Ada is added to the list.');
    expect(added).not.toMatch(/class="[^"]*pf-error[^"]*"[^>]*id="race-code-note"/);
  });

  it('is a form with Start and Cancel, and is as complete in Turkish', () => {
    const m = menu({ own: true });
    for (const lang of ['en', 'tr'] as const) {
      const t = createI18n(lang);
      const h = ghostDialog(ctx(lang), m, choice(m)).value;
      expect(h).toContain('data-form="ghost"');
      expect(h).toContain(escapeHtml(t.t('race.start')));
      expect(h).toContain(escapeHtml(t.t('common.cancel')));
      expect(h).toContain(escapeHtml(t.t('race.title')));
    }
    expect(ghostDialog(ctx('tr'), m, choice(m)).value).toContain('Hayaletle yarış');
  });
});

describe("the card a friend's link opens", () => {
  it('names the friend and the points, and starts the race at the address it is given', () => {
    const h = ghostOffer(ctx(), { run: recording(5, { name: 'Ada' }), startHref: '/play/squat-flap/?ghost=ABC' }).value;
    expect(h).toContain('Race the recording of Ada?');
    expect(h).toMatch(/\d+ points? on the same course\. Nobody is playing live\./);
    expect(h).toContain('href="/play/squat-flap/?ghost=ABC"');
    expect(h).toContain('data-ghost-offer');
  });

  it('says "this recording" when it has no name, and never lets a name become markup', () => {
    expect(ghostOffer(ctx(), { run: recording(5, { name: '' }), startHref: '/x/' }).value).toContain('Race this recording?');
    const evil = '"><script>alert(1)</script>';
    const h = ghostOffer(ctx(), { run: recording(5, { name: evil }), startHref: '/x/' }).value;
    expect(h).not.toContain('<script>');
  });
});

const outcome = (o: Partial<RaceOutcome> = {}): RaceOutcome => ({
  kind: 'ghost', you: 40, rivals: [{ name: 'Practice bot', score: 25, label: { key: 'ghost.label.bot', name: '', at: AT, source: 'bot' } }],
  won: true, lost: false, draw: false, margin: 15, best: 'none', code: null, ...o,
});

describe('what the results say about a race', () => {
  const block = (o: Partial<RaceOutcome>, sendable = true, lang: Lang = 'en'): string => raceBlock(ctx(lang), outcome(o), { again: '/play/squat-flap/?ghost=practice%3Aeasy', sendable }).value;

  it('says who won and by how much, the two scores, and where "Race again" goes', () => {
    const h = block({});
    expect(h).toContain('You won by 15 points.');
    expect(h).toContain('data-race-verdict');
    expect(h).toContain('<b>40</b>');
    expect(h).toContain('<b>25</b>');
    expect(h).toContain('href="/play/squat-flap/?ghost=practice%3Aeasy"');
    expect(h).toContain('You are racing a practice partner, a bot. Nobody is playing live.');
  });

  it('says it when the recording won, by its name, and a draw plainly', () => {
    const friend = { name: 'Ada', score: 60, label: { key: 'ghost.label.friend' as const, name: 'Ada', at: AT, source: 'friend' as const } };
    expect(block({ won: false, lost: true, margin: -20, you: 40, rivals: [friend] })).toContain('Ada won by 20 points.');
    expect(block({ won: false, lost: true, margin: -20, rivals: [{ ...friend, label: { ...friend.label, key: 'ghost.label.recording', name: '' } }] })).toContain('The recording won by 20 points.');
    expect(block({ won: false, draw: true, margin: 0 })).toContain('A draw.');
    expect(block({ won: true, margin: 1 })).toContain('You won by 1 point.');
  });

  it('says what became of the best run, and only when something was kept', () => {
    expect(block({ best: 'best' })).toContain('A new best run. It is kept on this device.');
    expect(block({ best: 'kept' })).toContain('Your best run stays the one it was.');
    const none = block({ best: 'none' });
    expect(none).not.toContain('A new best run');
    expect(none).not.toContain('stays the one it was');
  });

  it('has "Send my run" only for a player who may send and when there is a run to send', () => {
    expect(block({ code: 'CODE123' })).toContain('data-code="CODE123"');
    expect(block({ code: 'CODE123' })).toContain('Send my run');
    expect(block({ code: 'CODE123' }, false)).not.toContain('Send my run');
    expect(block({ code: null })).not.toContain('Send my run');
  });

  it('is said in Turkish too', () => {
    const h = block({}, true, 'tr');
    expect(h).toContain('puan farkla kazandın');
    expect(h).toContain('Yeniden yarış');
  });
});

describe('the names of recordings in sentences', () => {
  it('says what a recording is: yours, a friend\'s by name, nobody\'s, or a bot', () => {
    const c = ctx();
    expect(labelText(c, { key: 'ghost.label.own', name: '', at: AT, source: 'own' })).toBe('Your best run');
    expect(labelText(c, { key: 'ghost.label.friend', name: 'Ada', at: AT, source: 'friend' })).toBe('Recording of Ada');
    expect(labelText(c, { key: 'ghost.label.recording', name: '', at: AT, source: 'friend' })).toBe('A recording');
    expect(labelText(c, { key: 'ghost.label.bot', name: '', at: AT, source: 'bot' })).toBe('Practice partner (a bot)');
    expect(winnerName(c, { key: 'ghost.label.bot', name: '', at: AT, source: 'bot' })).toBe('The practice partner');
    expect(winnerName(c, { key: 'ghost.label.friend', name: 'Ada', at: AT, source: 'friend' })).toBe('Ada');
    expect(winnerName(c, null)).toBe('The recording');
  });
});
