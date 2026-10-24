// The players of the Family plan in the shell, without a browser: the pictures, what is said for each failure of the profile book,
// the three screens drawn from a real book (who is playing, manage, the form), the closed and the guarded states, the family table,
// the switcher, the parent gate's window, what a child's rules do to the results and the settings, and the friends pages said to a
// child. The clicks, the gate answered and the removal that asks are the end-to-end test's (e2e/profiles.spec.ts).
import { describe, expect, it } from 'vitest';
import { AVATARS, createProfileBook, memoryStorage, type ProfileBook } from '../../core/store/index.ts';
import { escapeHtml, html, textOf } from '../../core/ui/html.ts';
import { AVATAR_IDS, avatar } from '../../core/ui/avatars.ts';
import { createI18n, type Lang } from '../../core/ui/i18n/index.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { factsOf, failureKey, lastPlayed, newDraft, NO_PROFILES_STATE, OPEN_RULES, rulesOf, safeNext, showsSwitcher, waitText, type ProfilesPageState } from './app/profiles-model.ts';
import { makeContext } from './make-context.ts';
import { EMPTY_STATE, renderPage } from './pages.ts';
import { router } from './routes.ts';
import { chrome } from './views/chrome.ts';
import { childSocialPage, familyTable, gateHtml, lastPlayedText, profilesPage } from './views/profiles.ts';
import { resultsPage, type RoundResult } from './views/results.ts';
import { settingsPage } from './views/settings.ts';
import { defaultSetup } from './views/setup.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 86_400_000;

function makeBook(o: { can?: (feature: string) => boolean; storage?: ReturnType<typeof memoryStorage>; now?: () => number } = {}): ProfileBook {
  return createProfileBook({
    storage: o.storage ?? memoryStorage(), now: o.now ?? (() => NOW), timeZone: 'UTC', can: o.can ?? (() => true), random: () => 0,
    ownerName: 'Ayşe', recoveredName: (n) => `Oyuncu ${n}`, games: () => games.map((g) => g.id),
  });
}

/** A grown-up answers the gate (random: () => 0 makes the first question 13 x 6). */
function pass(book: ProfileBook): void {
  const q = book.gate.ask();
  if (!q.ok) throw new Error('the gate is closed');
  const r = book.gate.answer(q.question.id, q.question.a * q.question.b);
  if (!r.ok) throw new Error('the gate did not open');
}

/** A family: Ayşe (the main player) and Defne (a child). */
function family(): ProfileBook {
  const book = makeBook();
  const made = book.create({ name: 'Defne', kid: true, avatar: 'fox' });
  if (!made.ok) throw new Error(`could not add: ${made.code}`);
  return book;
}

const ctxOf = (book: ProfileBook, o: { lang?: Lang; url?: string; family?: boolean; child?: boolean } = {}) => {
  const cap = book.capacity();
  return makeContext({
    lang: o.lang ?? 'en', games, url: o.url ?? '/profiles/',
    player: factsOf(book.active(), { players: book.list().filter((p) => p.state === 'ready').length, capacity: { max: cap.max, used: cap.used } }),
    flags: { family: o.family ?? true, ...(o.child ? { socialChild: true } : {}) },
  });
};

const state = (book: ProfileBook, over: Partial<ProfilesPageState> = {}): ProfilesPageState => ({ ...NO_PROFILES_STATE, picker: book.picker(), ...over });
const page = (book: ProfileBook, over: Partial<ProfilesPageState> = {}, lang: Lang = 'en'): string => profilesPage(ctxOf(book, { lang }), state(book, over), NOW).value;

describe('the twelve pictures', () => {
  it('are the ones the store names, each drawn once, with a name for the choice and none beside a name', () => {
    expect([...AVATAR_IDS]).toEqual([...AVATARS]);
    const seen = new Set<string>();
    for (const id of AVATAR_IDS) {
      const plain = avatar(id, { size: 48 }).value;
      const named = avatar(id, { size: 48, label: id }).value;
      expect(plain, id).toContain('aria-hidden="true"');
      expect(plain, id).not.toContain('role="img"');
      expect(named, id).toContain(`role="img" aria-label="${id}"`);
      expect(plain.match(/<circle cx="32" cy="32" r="32"/g), id).toHaveLength(1);
      expect(seen.has(plain), id).toBe(false);
      seen.add(plain);
    }
  });

  it('have a name in every complete language', () => {
    for (const lang of ['en', 'tr'] as const) {
      const t = createI18n(lang);
      for (const id of AVATAR_IDS) expect(t.has(`profile.avatar.${id}`), `${lang} ${id}`).toBe(true);
    }
  });
});

describe('what is said', () => {
  it('has a line, in both languages, for every code the profile book answers with, and says "not here" for a code nobody knows', () => {
    const codes = ['name_empty', 'name_long', 'name_chars', 'name_taken', 'avatar', 'plan', 'full', 'locked', 'unknown', 'confirm_required', 'frozen', 'exhausted', 'owner_kid', 'parent_gate'];
    for (const lang of ['en', 'tr'] as const) {
      const t = createI18n(lang);
      for (const code of codes) {
        expect(failureKey(code), code).toBe(`profile.err.${code}`);
        expect(t.has(failureKey(code)), `${lang} ${code}`).toBe(true);
      }
    }
    expect(failureKey('something_new')).toBe('profile.err.unknown');
    expect(failureKey('')).toBe('profile.err.unknown');
  });

  it('counts the days since a player last played by the calendar of the player, not by 24 hours', () => {
    expect(lastPlayed(NOW, null)).toEqual({ kind: 'never' });
    expect(lastPlayed(NOW, Number.NaN)).toEqual({ kind: 'never' });
    expect(lastPlayed(NOW, NOW - 3_600_000, 'UTC')).toEqual({ kind: 'today' });
    expect(lastPlayed(Date.UTC(2026, 9, 24, 0, 5), Date.UTC(2026, 9, 23, 23, 55), 'UTC')).toEqual({ kind: 'yesterday' });
    expect(lastPlayed(NOW, NOW - 5 * DAY, 'UTC')).toEqual({ kind: 'days', n: 5 });
    expect(lastPlayed(NOW, NOW + DAY, 'UTC')).toEqual({ kind: 'today' });
  });

  it('says the gate\'s wait in seconds up to a minute and in whole minutes after', () => {
    expect(waitText(1)).toEqual({ unit: 'sec', n: 1 });
    expect(waitText(42_300)).toEqual({ unit: 'sec', n: 43 });
    expect(waitText(60_000)).toEqual({ unit: 'sec', n: 60 });
    expect(waitText(61_000)).toEqual({ unit: 'min', n: 2 });
    expect(waitText(15 * 60_000)).toEqual({ unit: 'min', n: 15 });
  });

  it('writes the last time a player played in words, in both languages', () => {
    const book = family();
    for (const [lang, never, today] of [['en', 'Not played yet', 'Played today'], ['tr', 'Henüz oynamadı', 'Bugün oynadı']] as const) {
      const ctx = ctxOf(book, { lang });
      expect(lastPlayedText(ctx, null, NOW)).toBe(never);
      expect(lastPlayedText(ctx, NOW, NOW)).toBe(today);
    }
    expect(lastPlayedText(ctxOf(book), NOW - 2 * DAY, NOW)).toBe('Played 2 days ago');
    expect(lastPlayedText(ctxOf(book, { lang: 'tr' }), NOW - 2 * DAY, NOW)).toBe('2 gün önce oynadı');
  });
});

describe('where to go after the picker', () => {
  it('is a path of this site and nothing else: never another site, never a script, never the picker itself', () => {
    expect(safeNext('/games/squat-flap/')).toBe('/games/squat-flap/');
    expect(safeNext('/tr/plans/?x=1')).toBe('/tr/plans/?x=1');
    expect(safeNext('/')).toBe('/');
    for (const bad of ['//evil.example/x', 'https://evil.example/', 'javascript:alert(1)', '\\evil', '/a\\b', '/a\nb', '/profiles/', '/profiles/?next=/x', '', null, undefined, `/${'a'.repeat(400)}`]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe('the rules of a player at the screens', () => {
  it('are all open for a screen that has no player, and for the main player', () => {
    expect(rulesOf(null)).toBe(OPEN_RULES);
    expect(rulesOf(undefined)).toBe(OPEN_RULES);
    const book = makeBook();
    expect(factsOf(book.active(), { players: 1, capacity: { max: 6, used: 1 } }).rules).toMatchObject({ online: true, purchase: 'open', calories: true, share: true });
  });

  it('close what a child may not do: the shop, the weight, sharing, the online identity', () => {
    const book = family();
    pass(book);
    const r = book.switchTo('p2');
    expect(r.ok).toBe(true);
    const facts = factsOf(book.active(), { players: 2, capacity: { max: 6, used: 2 } });
    expect(facts).toMatchObject({ name: 'Defne', kid: true, owner: false });
    expect(facts.rules).toMatchObject({ online: false, purchase: 'parent_gate', autoPaywall: false, calories: false, freeText: false, share: false, ghosts: 'family' });
  });

  it('show the switcher from two players on, and not before', () => {
    expect(showsSwitcher(null)).toBe(false);
    expect(showsSwitcher(factsOf(makeBook().active(), { players: 1, capacity: { max: 6, used: 1 } }))).toBe(false);
    expect(showsSwitcher(factsOf(family().active(), { players: 2, capacity: { max: 6, used: 2 } }))).toBe(true);
  });
});

describe.each(['en', 'tr'] as const)('the players screen in %s', (lang) => {
  it('asks who is playing: a card for each player that is a button saying whose it is, the main one and the child told apart, the player now marked', () => {
    const book = family();
    const html = page(book, {}, lang);
    expect(html.match(/data-action="profile-pick"/g)).toHaveLength(2);
    const cards = html.slice(html.indexOf('<ul class="pf-cards"'), html.indexOf('</ul>', html.indexOf('<ul class="pf-cards"')));
    expect(cards.match(/aria-current="true"/g)).toHaveLength(1);
    expect(cards).toMatch(/class="pf-card is-active"[^>]*aria-current="true"/);
    const t = createI18n(lang);
    expect(html).toContain(t.t('profile.badge.owner'));
    expect(html).toContain(t.t('profile.badge.kid'));
    expect(html).toContain(`aria-label="${t.t('profile.choose', { name: 'Defne' })}"`);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(textOf(html)).not.toMatch(/undefined|\[object|NaN|\{[a-z]+\}|profile\./);
  });

  it('offers to add a player where one can be added, says when the six are used, and leads a device without the plan to the plan only when the plan is sold', () => {
    const t = createI18n(lang);
    const roomy = makeBook();
    expect(page(roomy, {}, lang)).toContain('data-action="profile-add"');
    const full = makeBook();
    for (let i = 0; i < 5; i++) expect(full.create({ name: `Oyuncu ${i + 1}` }).ok).toBe(true);
    expect(page(full, {}, lang)).not.toContain('data-action="profile-add"');
    const fullManage = page(full, { view: { kind: 'manage' } }, lang);
    expect(fullManage).not.toContain('data-action="profile-add"');
    expect(fullManage).toContain(t.t('profile.full'));
    const solo = makeBook({ can: () => false });
    expect(solo.picker().add).toEqual({ show: true, why: 'plan' });
    const sold = profilesPage(ctxOf(solo, { lang, family: true }), state(solo), NOW).value;
    expect(sold).toContain(`href="${lang === 'en' ? '' : '/tr'}/pro/"`);
    expect(sold).not.toContain('data-action="profile-add"');
    // while the plan is not sold, a device that cannot add players is not told about it
    expect(profilesPage(ctxOf(solo, { lang, family: false }), state(solo), NOW).value).not.toContain('pf-card--add');
    expect(profilesPage(ctxOf(solo, { lang, family: false }), state(solo, { view: { kind: 'manage' } }), NOW).value).not.toContain(t.t('profile.add.plan'));
  });

  it('draws a player whose plan ended as closed and unchosen, with the reason, and the record kept', () => {
    const storage = memoryStorage();
    const open = makeBook({ storage });
    expect(open.create({ name: 'Defne', kid: true }).ok).toBe(true);
    const ended = makeBook({ storage, can: () => false });
    const html = page(ended, {}, lang);
    const t = createI18n(lang);
    expect(html).toContain('is-locked');
    expect(html).toContain(t.t('profile.locked'));
    expect(html.match(/data-action="profile-pick"/g)).toHaveLength(1);
    expect(html).toContain('aria-disabled="true"');
    expect(ended.list().find((p) => p.name === 'Defne')?.state).toBe('locked');
  });

  it('meets a child whose plan ended with the gate instead of the main player\'s profile', () => {
    const storage = memoryStorage();
    const open = makeBook({ storage });
    expect(open.create({ name: 'Defne', kid: true }).ok).toBe(true);
    pass(open);
    expect(open.switchTo('p2').ok).toBe(true);
    const ended = makeBook({ storage, can: () => false });
    expect(ended.picker().guarded).toBe(true);
    const html = page(ended, {}, lang);
    const t = createI18n(lang);
    expect(html).toContain(t.t('profile.guard.title'));
    expect(html).toContain('data-action="profile-gate"');
    expect(html).not.toContain('data-action="profile-add"');
  });

  it('lists the players to manage with a way to edit and to remove each, named for a screen reader', () => {
    const book = family();
    const html = page(book, { view: { kind: 'manage' } }, lang);
    const t = createI18n(lang);
    expect(html.match(/data-action="profile-edit"/g)).toHaveLength(2);
    expect(html.match(/data-action="profile-remove"/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${t.t('profile.edit')}: Defne"`);
    expect(html).toContain(`aria-label="${t.t('profile.remove')}: Ayşe"`);
    expect(html).toContain('data-action="profile-done"');
    expect(html).toContain('data-capacity');
    expect(html).toContain(t.t('profile.capacity', { used: 2, max: 6 }));
  });

  it('draws the form with the twelve pictures as radio buttons, a name box that says its rule, the two switches, and what went wrong at the field it is about', () => {
    const book = makeBook();
    const draft = { ...newDraft('owl', false), name: 'x' };
    const view = (code: string, field: 'name' | 'avatar' | 'form') => ({ kind: 'form' as const, mode: 'create' as const, id: null, draft, error: { field, code } });
    const t = createI18n(lang);
    const html = page(book, { view: view('name_taken', 'name') }, lang);
    expect(html.match(/name="avatar"/g)).toHaveLength(12);
    expect(html).toMatch(/name="avatar" value="owl"[^>]*checked/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(t.t('profile.err.name_taken'));
    expect(html).toContain('role="alert"');
    expect(html).toContain('name="kid"');
    expect(html).toContain('name="seated"');
    expect(html).toContain(escapeHtml(t.t('profile.form.nameHint', { n: 20 })));
    for (const [code, field] of [['name_empty', 'name'], ['name_long', 'name'], ['name_chars', 'name'], ['avatar', 'avatar'], ['plan', 'form'], ['full', 'form'], ['frozen', 'form']] as const) {
      const h = page(book, { view: view(code, field) }, lang);
      expect(textOf(h), code).toContain(t.t(failureKey(code) as 'profile.err.unknown', { n: 20 }));
    }
  });

  it('shows no kid switch for the main player, who cannot be a child', () => {
    const book = makeBook();
    const html = page(book, { view: { kind: 'form', mode: 'edit', id: 'p1', draft: { name: 'Ayşe', avatar: 'fox', kid: false, seated: false }, error: null } }, lang);
    expect(html).toMatch(/id="pf-kid"[^>]*disabled/);
  });
});

describe('the family on a game\'s page', () => {
  it('lists the players and their best from two on, the player now marked, and says "no score yet" for a player who has none', () => {
    const book = family();
    const rows = book.family(games[0]?.id as string);
    const html = familyTable(ctxOf(book), rows).value;
    expect(html).toContain('data-family');
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html).toContain('No score yet');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(familyTable(ctxOf(book), rows.slice(0, 1)).value).toBe('');
    expect(familyTable(ctxOf(book, { lang: 'tr' }), rows).value).toContain('Henüz skor yok');
  });
});

describe('the switcher in the bar', () => {
  it('is in the bar once there are two players, names whose turn it is, and leads to the players screen', () => {
    const book = family();
    const ctx = ctxOf(book, { url: '/' });
    const body = html`<p>x</p>`;
    const out = chrome(ctx, { tab: 'games', main: body }).value;
    expect(out.match(/class="pf-switch"/g)).toHaveLength(2); // the bar and the head of a phone
    expect(out).toContain('aria-label="Playing as Ayşe. Switch player"');
    expect(out).toContain('href="/profiles/"');
    const alone = makeBook();
    expect(chrome(ctxOf(alone, { url: '/' }), { tab: 'games', main: body }).value).not.toContain('pf-switch');
    expect(chrome(makeContext({ lang: 'en', games, url: '/' }), { tab: 'games', main: body }).value).not.toContain('pf-switch');
  });
});

describe('the parent gate\'s window', () => {
  it('asks the sum, takes a number from a numeric keyboard, and says a wrong answer or a wait where a screen reader hears it', () => {
    const ctx = makeContext({ lang: 'en', games, url: '/' });
    const ask = gateHtml(ctx, { a: 13, b: 6, message: null, waitText: null }).value;
    expect(ask).toContain('13 × 6 =');
    expect(ask).toContain('inputmode="numeric"');
    expect(ask).toContain('id="gate-answer"');
    expect(ask).toContain('data-dialog-close="no"');
    expect(ask).toContain('role="status"');
    const wrong = gateHtml(ctx, { a: 14, b: 7, message: 'Not quite. Here is another one.', waitText: null }).value;
    expect(wrong).toContain('Not quite. Here is another one.');
    expect(wrong).not.toMatch(/id="gate-answer"[^>]*disabled/);
    const closed = gateHtml(ctx, { a: 0, b: 0, message: null, waitText: 'Try again in 42 seconds.' }).value;
    expect(closed).toContain('Try again in 42 seconds.');
    expect(closed).toMatch(/id="gate-answer"[^>]*disabled/);
    expect(closed).toMatch(/type="submit"[^>]*disabled/);
    const tr = gateHtml(makeContext({ lang: 'tr', games, url: '/tr/' }), { a: 13, b: 6, message: null, waitText: null }).value;
    expect(tr).toContain('Bir yetişkin için');
  });
});

describe('what a child\'s rules do to the screens', () => {
  const result: RoundResult = {
    gameId: games[0]?.id as string, setup: defaultSetup(makeContext({ lang: 'en', games, url: '/' }), games[0]!), score: 40, seconds: 90, calories: null, personalBest: false, reasons: [],
  };

  it('leave out the calories of a round, and even the line that asks for a weight, for a child', () => {
    const adult = makeBook();
    expect(resultsPage(ctxOf(adult), result).value).toContain('k-kcal');
    const kid = family();
    pass(kid);
    expect(kid.switchTo('p2').ok).toBe(true);
    const html = resultsPage(ctxOf(kid), { ...result, calories: 61 }).value;
    expect(html).not.toContain('k-kcal');
    expect(html).not.toContain('kcal');
  });

  it('leave out the weight on the settings of a child and show the main player\'s players', () => {
    const adult = family();
    const settings = (b: ProfileBook): string => settingsPage(ctxOf(b, { url: '/settings/' }), { reducedMotion: false }).value;
    const html = settings(adult);
    expect(html).toContain('name="weightKg"');
    expect(html).toContain('href="/profiles/?manage=1"');
    expect(html).toContain('2 of 6 on this device');
    pass(adult);
    expect(adult.switchTo('p2').ok).toBe(true);
    expect(settings(adult)).not.toContain('name="weightKg"');
    // a single player who cannot add anybody sees no row about players at all
    expect(settings(makeBook({ can: () => false }))).not.toContain('profiles/?manage');
    expect(settingsPage(makeContext({ lang: 'en', games, url: '/settings/' }), { reducedMotion: false }).value).not.toContain('profiles/?manage');
  });

  it('say to a child on the friends pages that they belong to the main player, with the way to switch, and show nothing where there is no friends side', () => {
    const kid = family();
    const ctx = makeContext({ lang: 'en', games, url: '/friends/', player: factsOf(kid.active(), { players: 2, capacity: { max: 6, used: 2 } }), flags: { social: false, socialChild: true } });
    const out = renderPage(ctx, router.match('/friends/'), EMPTY_STATE);
    expect(out.status).toBe(200);
    expect(out.noindex).toBe(true);
    expect(out.body.value).toContain('This player is a child. To add friends, open the main player.');
    expect(out.body.value).toContain('href="/profiles/?next=%2Ffriends%2F"');
    expect(childSocialPage(ctx).value).toBe(out.body.value);
    for (const url of ['/lobbies/', '/r/K7Q2MX/', '/f/BA-9PXMR3/', '/safety/']) expect(renderPage({ ...ctx, url }, router.match(url), EMPTY_STATE).body.value, url).toContain('open the main player');
    // no friends side at all: the pages are simply not there
    const none = makeContext({ lang: 'en', games, url: '/friends/' });
    expect(renderPage(none, router.match('/friends/'), EMPTY_STATE).status).toBe(404);
  });

  it('draw the players page only for a device that has players', () => {
    const none = makeContext({ lang: 'en', games, url: '/profiles/' });
    expect(renderPage(none, router.match('/profiles/'), EMPTY_STATE).status).toBe(404);
    const out = renderPage(ctxOf(family()), router.match('/profiles/'), { ...EMPTY_STATE, profiles: state(family()) });
    expect(out.status).toBe(200);
    expect(out.noindex).toBe(true);
    expect(out.title).toContain('Who is playing?');
  });
});
