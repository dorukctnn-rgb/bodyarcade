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
  | { waitFor: string }
  | { waitGone: string }
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
  /** The game scene must show something behind the HUD (a flat colour over the whole scene is an error). */
  expectScene?: boolean;
  /** Breakpoint ids this target is opened at (default: all ten). */
  sizes?: string[];
  /** Free text for the report. */
  note?: string;
}

// A round with the keyboard: the HUD (or the panel that says the round could not start) shows, the countdown is over.
// ':visible' matters: a list of selectors waits for the FIRST match in the page to turn visible, and the HUD plates come first.
const PLAY_WAIT: Step[] = [{ waitFor: '[data-hud="statusLeft"]:visible, [data-hud="statusP1"]:visible, #ov-title:visible' }, { waitGone: '.ba-countdown, [data-cal-view]' }, { wait: 1200 }];
// The camera flow: the explainer, then (after "Continue") whatever follows with a camera that shows no person: the calibration of a real game, the countdown of the practice session.
const CAMERA_CONTINUE: Step[] = [{ waitFor: '[data-action="camera-continue"]' }, { click: '[data-action="camera-continue"]' }, { waitFor: '[data-cal-view]:visible, .ba-countdown:visible, #ov-title:visible' }, { wait: 1500 }];

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
    { id: 'web:home', server: 'web', path: `${prefix}/` },
    { id: 'web:region', server: 'web', path: `${prefix}/workouts/legs/` },
    { id: 'web:settings', server: 'web', path: `${prefix}/settings/` },
    { id: 'web:pro', server: 'web', path: `${prefix}/pro/` },
    { id: 'web:friends', server: 'web', path: `${prefix}/friends/` },
    { id: 'web:welcome', server: 'web', path: `${prefix}/welcome/` },
    { id: 'web:notfound', server: 'web', path: `${prefix}/nope/` },
  ];
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
