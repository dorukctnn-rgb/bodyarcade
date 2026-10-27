// What page-check looks at. A target is one page (or one state of a page) that is opened at every screen size.
// The built-in list follows the product: the pages of the web shell (one page per catalogue game, found from the
// catalogue so new games are covered the day their manifest lands), the dialogs, the play screen and the results
// screen, and the pages of the live site. Anything else: node tools/page-check/run.ts --url <address>.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadCatalogue } from '../../packages/web/catalogue/load.ts';
import { repoRoot } from './servers.ts';

export type ServerKind = 'web' | 'site' | 'dev' | 'external';

export type Step =
  | { click: string }
  | { waitFor: string; timeout?: number }
  | { waitGone: string; timeout?: number }
  | { waitUrl: string }
  | { wait: number }
  | { press: string }
  | { goto: string }
  | { eval: string };

export interface Target {
  id: string;
  server: ServerKind;
  /** Path (or, for 'external', the full address). */
  path: string;
  steps?: Step[];
  /** Values for window.__BA_TEST__ (the shell's test hooks) before the page loads. */
  hooks?: Record<string, unknown>;
  /** Extra expression evaluated in the page; returns a list of problem strings (the shell's HUD check, for example). */
  probe?: string;
  /** Selectors left out of the overlap and clipping checks. */
  ignore?: string[];
  /** Selectors of the main action (a warning when it is not fully on the first screen). */
  primary?: string[];
  /** Console and network messages (text or URL) that are not errors for this page. */
  allowMessages?: string[];
  /** Needs a camera that shows a person (run with --camera <video>); left out of the run otherwise. */
  needsCamera?: boolean;
  /** The game scene must show something behind the HUD (a flat colour over the whole scene is an error). */
  expectScene?: boolean;
  /** Breakpoint ids this target is opened at (default: all ten). */
  sizes?: string[];
  /** Free text for the report. */
  note?: string;
}

// A round with the keyboard: the HUD (or the panel that says the round could not start) shows, the countdown is over.
// ':visible' matters: a list of selectors waits for the FIRST match in the page to turn visible, and the HUD plates come first.
const PLAY_WAIT: Step[] = [{ waitFor: '[data-hud="statusLeft"]:visible, [data-hud="statusP1"]:visible, #ov-title:visible', timeout: 45000 }, { waitGone: '.ba-countdown, [data-cal-view]' }, { wait: 1200 }];
// A whole start on the camera: explainer, calibration on the person, countdown, then the game runs for a moment.
const CAMERA_ROUND: Step[] = [
  { waitFor: '[data-action="camera-continue"]' }, { click: '[data-action="camera-continue"]' },
  { waitFor: '[data-cal-view]:visible, .ba-countdown:visible, #ov-title:visible', timeout: 40000 }, { waitGone: '[data-cal-view]', timeout: 90000 }, { waitGone: '.ba-countdown', timeout: 40000 }, { wait: 1800 },
];
// The camera flow: the explainer, then (after "Continue") whatever follows with a camera that shows no person: the calibration of a real game, the countdown of the practice session.
const CAMERA_CONTINUE: Step[] = [{ waitFor: '[data-action="camera-continue"]' }, { click: '[data-action="camera-continue"]' }, { waitFor: '[data-cal-view]:visible, .ba-countdown:visible, #ov-title:visible' }, { wait: 1500 }];

// The practice build as the shell's own end-to-end specs open it: a keyboard is there at every size, the practice session runs fast.
const PRACTICE: Record<string, unknown> = { timeScale: 40, roundSeconds: 6, forceDemo: true, keyboard: true };
/** Players added to a fresh device that has the Family plan (a child, two more); `active` is the one that plays. */
const FAMILY_PLAYERS = [{ name: 'Defne', kid: true, avatar: 'fox' }, { name: 'Mert', avatar: 'robot' }, { name: 'Elif', avatar: 'rocket' }];
/** The main action of Home: the play button of the hero (today's game). */
const HOME_MAIN = '.k-today .ba-btn--primary';
const TOUR_READY: Step = { waitFor: '[data-welcome][data-ready="1"]', timeout: 40000 };
const MAIN_READY: Step = { waitFor: 'main h1', timeout: 20000 };

/** The sizes of the rounds that run on a camera picture (each takes a calibration and a countdown, so not all ten). */
const CAMERA_SIZES = ['phone-390', 'phone-land-844', 'tablet-768', 'laptop-1280'];

/** Sizes where two players on one camera are offered (desktop, laptop, TV and landscape tablets). */
const BIG_SIZES = ['tablet-land-1024', 'laptop-1280', 'laptop-1440', 'tv-1920'];

/** Does packages/games/<id>/index.ts exist? Without it the practice session stands in for the game (development builds only). */
const hasGameCode = (id: string): boolean => existsSync(join(repoRoot(), 'packages', 'games', id, 'index.ts'));

/**
 * The play screen's checks, as one expression run in the page: the HUD's own problem list, the "round could not start"
 * panel (the shell shows it when a game cannot be started), and a warning when only the practice session stands in.
 * Lines starting with "warn:" count as warnings, the others as errors.
 */
function playProbe(id: string): string {
  const practice = hasGameCode(id) ? '' : `out.push('warn:the practice session stands in, packages/games/${id}/index.ts does not exist on this branch yet');`;
  return `(() => {
    const out = [];
    const a = window.__BA__;
    if (!a) return ['the test hook window.__BA__ is missing'];
    out.push(...a.debug().playProblems);
    const t = document.querySelector('#ov-title');
    if (t && /could not start|ba\\u015flat\\u0131lamad\\u0131/i.test(t.textContent || '')) out.push('the round did not start: ' + ((document.querySelector('.ba-explain [role=alert]') || {}).textContent || '').trim());
    ${practice}
    return out;
  })()`;
}

/** The pages of the web shell. `lang` is the path prefix of a language ('' for English). */
export function webTargets(prefix: string): Target[] {
  const { catalogue } = loadCatalogue({ fixtures: 'fill', requiredLangs: ['en'] });
  const games = catalogue.games;
  const paid = games.find((g) => !g.free);
  const out: Target[] = [
    // The main action of Home is the hero's play button; the challenge of the day under it has its own (also accent) button, a second card that is not the first screen's to show on a phone.
    { id: 'web:home', server: 'web', path: `${prefix}/`, primary: [HOME_MAIN] },
    { id: 'web:region', server: 'web', path: `${prefix}/workouts/legs/` },
    { id: 'web:settings', server: 'web', path: `${prefix}/settings/` },
    { id: 'web:pro', server: 'web', path: `${prefix}/pro/` },
    { id: 'web:friends', server: 'web', path: `${prefix}/friends/` },
    { id: 'web:notfound', server: 'web', path: `${prefix}/nope/` },
  ];
  // The welcome tour, every page of it (the stage drawn once and held still, so the picture is the same on every run).
  for (const n of [1, 2, 3, 4, 5]) out.push({ id: `web:welcome:${n}`, server: 'web', path: `${prefix}/welcome/${n === 1 ? '' : `?step=${n}`}`, hooks: { ...PRACTICE, tour: 'static' }, steps: [TOUR_READY], note: `welcome tour, page ${n}` });
  // Workout plans (the page and a Pro player's page), the paywall in its other states.
  out.push(
    { id: 'web:plans', server: 'web', path: `${prefix}/plans/`, hooks: PRACTICE, note: 'workout plans, free player' },
    { id: 'web:plans:pro', server: 'web', path: `${prefix}/plans/`, hooks: { ...PRACTICE, plan: 'pro' }, note: 'workout plans, Pro player' },
    { id: 'web:pro:trial', server: 'web', path: `${prefix}/pro/`, hooks: { ...PRACTICE, plan: 'pro', trial: { endsInHours: 30 } }, note: 'the paywall for a player in the last days of the trial' },
    { id: 'web:pro:unavailable', server: 'web', path: `${prefix}/pro/`, hooks: { ...PRACTICE, billing: 'unavailable' }, note: 'a build where nothing can be bought' },
    { id: 'web:home:trial', server: 'web', path: `${prefix}/`, hooks: { ...PRACTICE, trial: { endsInHours: 30 } }, primary: [HOME_MAIN], note: 'the notice of the last days of a trial' },
  );
  // The players of the Family plan: the list, the manage state, the form, a child's settings, and the parent gate.
  const family = { ...PRACTICE, plan: 'family', players: FAMILY_PLAYERS };
  const kid = { ...PRACTICE, plan: 'family', players: [{ name: 'Defne', kid: true, avatar: 'fox', active: true }, { name: 'Mert', avatar: 'robot' }] };
  out.push(
    { id: 'web:profiles', server: 'web', path: `${prefix}/profiles/`, hooks: family, steps: [MAIN_READY], note: 'players of the Family plan' },
    { id: 'web:profiles:manage', server: 'web', path: `${prefix}/profiles/?manage=1`, hooks: family, steps: [MAIN_READY], note: 'players, manage state' },
    { id: 'web:profiles:add', server: 'web', path: `${prefix}/profiles/`, hooks: family, steps: [MAIN_READY, { click: '[data-action="profile-add"]' }, { waitFor: 'form[data-form="profile"]' }, { wait: 300 }], note: 'the form that adds a player' },
    { id: 'web:profiles:kid', server: 'web', path: `${prefix}/settings/`, hooks: kid, steps: [MAIN_READY], note: 'the settings of a child profile' },
    { id: 'web:profiles:gate', server: 'web', path: `${prefix}/profiles/`, hooks: kid, steps: [MAIN_READY, { click: 'button[data-action="profile-pick"]:has(b.pf-name:text-is("Me")), button[data-action="profile-pick"]:has(b.pf-name:text-is("Ben"))' }, { waitFor: 'dialog.pf-gatebox[open]' }, { wait: 300 }], note: 'the parent gate (a sum) that a child needs to go back to the main player' },
  );
  // The friends side in the practice build (`?social=...`): the screens, the sign-up window, a room just made.
  const social = (id: string, path: string, note: string, steps: Step[] = []): Target => ({ id: `web:${id}`, server: 'web', path: `${prefix}${path}`, hooks: PRACTICE, steps: [MAIN_READY, ...steps], note });
  out.push(
    social('friends:demo', '/friends/?social=1', 'friends, a player with a profile'),
    social('friends:new', '/friends/?social=fresh', 'friends, a player with no profile yet'),
    social('friends:offline', '/friends/?social=offline', 'friends, the service cannot be reached'),
    social('friends:profile', '/friends/?view=profile&social=1', 'my profile'),
    social('friends:boards', '/friends/?view=boards&social=1', 'the boards'),
    social('friends:sheet', '/friends/?social=fresh', 'the sign-up window', [{ click: '[data-action="social.profile"]' }, { waitFor: 'dialog[open]' }, { wait: 300 }]),
    social('lobbies', '/lobbies/?social=1', 'public lobbies'),
    social('room', '/r/K7Q2MX/?social=1', 'an invitation to a room'),
    social('room:host', '/friends/?social=1', 'a room just made, seen by the host', [{ click: '[data-action="room.new"]' }, { waitUrl: '/r/' }, { waitFor: 'main h1' }, { wait: 300 }]),
    social('friendlink', '/f/BA-9PXMR3/?social=1', 'a friend link'),
    social('safety', '/safety/?social=1', 'the safety page'),
  );
  // Every game of the catalogue gets its page (the setup form is part of it), the page with two players chosen, its play
  // screen (the real game when its code exists, the practice session otherwise), the seated and the two-player versions
  // where the manifest offers them, and its results.
  const seenFraming = new Set<string>();
  for (const g of games) {
    const slug = g.seo.slug;
    const play = `${prefix}/play/${slug}/?input=keyboard`;
    out.push({ id: `web:game:${g.id}`, server: 'web', path: `${prefix}/games/${slug}/` });
    if (g.modes.includes('local2')) out.push({ id: `web:game2:${g.id}`, server: 'web', path: `${prefix}/games/${slug}/`, steps: [{ click: 'label.ba-seg-opt:has(input[name="players"][value="2"])' }, { eval: 'window.scrollTo(0, 0)' }, { wait: 250 }], sizes: BIG_SIZES, note: 'game page with two players chosen' });
    out.push({ id: `web:play:${g.id}`, server: 'web', path: play, hooks: { timeScale: 5, roundSeconds: 120 }, steps: PLAY_WAIT, probe: playProbe(g.id), expectScene: hasGameCode(g.id), note: hasGameCode(g.id) ? 'real game' : 'practice session' });
    if (g.seated) out.push({ id: `web:play:${g.id}:seated`, server: 'web', path: `${play}&seated=1`, hooks: { timeScale: 5, roundSeconds: 120 }, steps: PLAY_WAIT, probe: playProbe(g.id), expectScene: hasGameCode(g.id) });
    if (g.modes.includes('local2')) out.push({ id: `web:play2:${g.id}`, server: 'web', path: `${play}&players=2`, hooks: { timeScale: 5, roundSeconds: 120 }, steps: CAMERA_CONTINUE, probe: playProbe(g.id), sizes: BIG_SIZES, note: 'two players on one camera: the screen after the camera explainer' });
    // The camera flow of one game for each way of standing (the screens are the shell's, the framing changes the checks listed).
    if (!seenFraming.has(g.framing)) {
      seenFraming.add(g.framing);
      out.push({ id: `web:camera:${g.id}`, server: 'web', path: `${prefix}/play/${slug}/?input=camera`, hooks: { timeScale: 5, roundSeconds: 120 }, steps: [{ waitFor: '[data-action="camera-continue"]' }, { wait: 300 }], note: `camera explainer (framing ${g.framing})` });
      out.push({ id: `web:calibrate:${g.id}`, server: 'web', path: `${prefix}/play/${slug}/?input=camera`, hooks: { timeScale: 5, roundSeconds: 120 }, steps: CAMERA_CONTINUE, probe: playProbe(g.id), note: `screen after "Continue" with a camera that shows nobody (framing ${g.framing})` });
    }
    // A round on a camera that shows a person: the explainer, the calibration, the countdown, and the game running (needs --camera).
    if (hasGameCode(g.id)) out.push({ id: `web:cam:${g.id}`, server: 'web', path: `${prefix}/play/${slug}/?input=camera`, hooks: { timeScale: 5, roundSeconds: 120 }, steps: CAMERA_ROUND, probe: playProbe(g.id), expectScene: true, needsCamera: true, sizes: CAMERA_SIZES, note: 'a real round on the camera picture of a person' });
    out.push({ id: `web:results:${g.id}`, server: 'web', path: play, hooks: { forceDemo: true, timeScale: 40, roundSeconds: 6 }, steps: [{ waitUrl: 'results' }, { wait: 400 }], note: 'results view with the practice score of this game' });
  }
  if (paid) {
    out.push({ id: 'web:pro:locked', server: 'web', path: `${prefix}/pro/?game=${paid.id}`, note: 'the paywall that a locked game opens' });
  }
  return out.map((t) => ({ ...t, primary: t.primary ?? ['.ba-btn--primary'] }));
}

/** Every page of the live static site (site/), found on disk. */
export function siteTargets(): Target[] {
  const dir = join(repoRoot(), 'site');
  const out: Target[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { if (name !== 'vendor' && name !== 'assets') walk(p); continue; }
      if (!name.endsWith('.html')) continue;
      const rel = relative(dir, p).replace(/\\/g, '/');
      out.push({ id: `site:${rel.replace(/\.html$/, '').replace(/\/index$/, '') || 'index'}`, server: 'site', path: `/${rel}` });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function builtinTargets(o: { prefix: string; groups: string[] }): Target[] {
  const out: Target[] = [];
  if (o.groups.includes('web')) out.push(...webTargets(o.prefix));
  if (o.groups.includes('site')) out.push(...siteTargets());
  return out;
}
