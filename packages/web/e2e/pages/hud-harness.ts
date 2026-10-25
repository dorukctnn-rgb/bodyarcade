// Browser side of e2e/hud.spec.ts: the real HUD (core/ui/hud/hud.ts) on the shell's own stylesheet, and every reason and every
// command a game can show ("miss.*", "*.prompt.*" and "*.cmd.*" of the shell and of the games), in every language, asked to
// fit. Nothing here asserts; the spec does.
import '../../src/styles/app.css';
import { NAME_MAX_CHARS } from '../../../core/net/chat-filter.ts';
import { rngStream } from '../../../core/loop/rng.ts';
import { createScene2D } from '../../../core/render2d/scene2d.ts';
import { PlayHud } from '../../../core/ui/hud/hud.ts';
import { createI18n, LANGS, stringTables, type Lang } from '../../../core/ui/i18n/index.ts';
import type { HudMode, PipPlacement } from '../../../core/ui/layout.ts';
import { followHud } from '../../src/app/layout-bridge.ts';

type Table = Readonly<Record<string, string>>;
type Tables = Partial<Record<Lang, Table>>;

// Every table a game folder exports (FJ_STRINGS, STRINGS, strings ...): an object that has a language of ours as a key.
const files = import.meta.glob<Record<string, unknown>>('../../../games/*/strings.ts', { eager: true });

function gameTables(): Tables[] {
  const out: Tables[] = [];
  for (const file of Object.values(files)) {
    for (const value of Object.values(file)) {
      if (value && typeof value === 'object' && Object.keys(value).some((k) => (LANGS as readonly string[]).includes(k))) out.push(value as Tables);
    }
  }
  return out;
}

/** The lines of the games' tables whose key matches, as the player gets them: the game's own line in their language first, then the shell's, English last. */
function linesOf(lang: Lang, match: (key: string) => boolean): string[] {
  const found = new Set<string>();
  const own = stringTables[lang];
  for (const game of gameTables()) {
    for (const key of Object.keys(game.en ?? {})) if (match(key)) found.add(game[lang]?.[key] ?? own[key] ?? game.en?.[key] ?? key);
  }
  return [...found];
}

/** Every reason a player can be told in this language: the shell's own lines and the lines the games add. */
function reasons(lang: Lang): string[] {
  const i18n = createI18n(lang);
  const found = new Set<string>(linesOf(lang, (k) => k.startsWith('miss.')));
  for (const key of Object.keys(stringTables.en)) if (key.startsWith('miss.')) found.add(i18n.t(key as never));
  return [...found].sort();
}

/** Every command a game puts on the screen in this language (the words a game names its beats, moves and phases with). */
function commands(lang: Lang): string[] {
  return linesOf(lang, (k) => /\.(prompt|cmd)\./.test(k)).sort();
}

export interface Case {
  lang: Lang;
  mode: HudMode;
  corner: PipPlacement;
  duo: boolean;
}

export interface Found { kind: 'reason' | 'command'; text: string; problems: string[] }

const root = document.querySelector('[data-hud-root]') as HTMLElement;
let hud: PlayHud | null = null;

/** A score, a timer, lives and a combo as large as a round makes them: the status plates at their widest. */
function open(c: Case): PlayHud {
  hud?.dispose();
  const i18n = createI18n(c.lang);
  const next = new PlayHud({
    document, root, i18n, mode: c.mode, pipCorner: c.corner, duo: c.duo,
    announce: () => undefined, toast: () => undefined, onPause: () => undefined, onMovePip: () => undefined,
  });
  next.set('score', 12840);
  next.set('timer', 108);
  next.set('lives', 3);
  next.set('combo', 4);
  hud = next;
  return next;
}

const longest = (list: string[]): string => list.reduce((a, b) => (b.length > a.length ? b : a), '');

function say(h: PlayHud, duo: boolean, text: string): void {
  if (duo) { h.setPlayer(1, 'hint', text); h.setPlayer(2, 'hint', text); } else h.set('hint', text);
}

function check(c: Case): Found[] {
  const h = open(c);
  const found: Found[] = [];
  // every reason under a command of a normal length
  const all = commands(c.lang);
  h.set('prompt', { text: all.find((t) => t.length >= 6 && t.length <= 12) ?? all[0] ?? 'Jack', icon: 'stand' });
  for (const text of reasons(c.lang)) {
    say(h, c.duo, text);
    const problems = h.problems();
    if (problems.length > 0) found.push({ kind: 'reason', text, problems });
  }
  // every command above the longest reason of the language
  say(h, c.duo, longest(reasons(c.lang)));
  for (const text of all) {
    h.set('prompt', { text, icon: 'stand' });
    const problems = h.problems();
    if (problems.length > 0) found.push({ kind: 'command', text, problems });
  }
  return found;
}

/**
 * The others of a race under the score: every name the plates say in this language (the practice bot, the player's own best, a
 * recording, a friend with the longest name there is) with the largest score, under the longest reason and a command, in every
 * corner of the self view. A race is for one player: the two-player HUD has no rows for them.
 */
function rivals(c: Case): { who: string; problems: string[] }[] {
  const i18n = createI18n(c.lang);
  const names: [string, string][] = [
    ['bot', i18n.t('race.plate.bot')], ['own', i18n.t('race.plate.own')], ['recording', i18n.t('race.plate.recording')],
    ['friend', 'W'.repeat(NAME_MAX_CHARS)], ['friend-wide', 'Ağ'.repeat(Math.ceil(NAME_MAX_CHARS / 2))],
  ];
  const out: { who: string; problems: string[] }[] = [];
  const h = open(c);
  const all = commands(c.lang);
  h.set('prompt', { text: all.find((t) => t.length >= 6 && t.length <= 12) ?? all[0] ?? 'Jack', icon: 'stand' });
  say(h, c.duo, longest(reasons(c.lang)));
  for (const [who, name] of names) {
    h.setRivals([{ name, score: 99_999 }]);
    out.push({ who, problems: h.problems() });
  }
  // a room of friends: three rows (the limit of a live race is a handful; three is already more than the plate is meant to carry)
  h.setRivals([{ name: names[3]?.[1] ?? 'W', score: 99_999 }, { name: names[2]?.[1] ?? 'R', score: 12_840 }, { name: names[0]?.[1] ?? 'B', score: 80 }]);
  out.push({ who: 'three rows', problems: h.problems() });
  h.setRivals([]);
  out.push({ who: 'rows taken away', problems: h.problems() });
  return out;
}

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/**
 * The scene kit of a game lays the screen out from what the HUD measured (the shell's own bridge, web/app/layout-bridge.ts). The play
 * area it leaves for the game must be the area the HUD says is the game's, the plate boxes it hands the game (a mirror game places its
 * targets by them) must be where the plates are, and a scene game's play area must be clear of every plate, with every reason in the
 * language (a reason that went to the lifted row, above the self view, takes the strip's room out of the play area).
 */
function kitAgrees(c: Case): { text: string; problem: string }[] {
  const h = open(c);
  const scene = document.querySelector('[data-scene]') as HTMLElement;
  scene.replaceChildren();
  const canvas = document.createElement('canvas');
  scene.append(canvas);
  const kit = createScene2D({ canvas, size: () => ({ width: scene.clientWidth, height: scene.clientHeight }), devicePixelRatio: () => 1, rng: rngStream(7, 'fx') });
  kit.resize();
  const all = commands(c.lang);
  h.set('prompt', { text: all.find((t) => t.length >= 6 && t.length <= 12) ?? all[0] ?? 'Jack', icon: 'stand' });
  const found: { text: string; problem: string }[] = [];
  const origin = scene.getBoundingClientRect();
  for (const text of ['', ...reasons(c.lang)]) {
    say(h, c.duo, text);
    h.problems();
    const info = h.layoutInfo();
    if (!info) { found.push({ text, problem: 'the HUD has no layout' }); continue; }
    followHud(kit, info, c.mode);
    const play = kit.rects.play;
    const mine = info.play;
    const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
    if (!same(play.x, mine.x) || !same(play.y, mine.y) || !same(play.w, mine.w) || !same(play.h, mine.h)) {
      found.push({ text, problem: `the kit leaves the game ${JSON.stringify(play)} but the HUD says ${JSON.stringify(mine)} (reason row ${info.solo?.rects.reason.row ?? '?'})` });
    }
    // The boxes the kit hands a game to keep clear (a mirror game places its targets by them) are the plates where they really are.
    for (const [name, box] of Object.entries(kit.rects.hud)) {
      const n = root.querySelector<HTMLElement>(`[data-hud="${name}"]`);
      if (!n || n.hidden) continue;
      const r = n.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const at = { x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height };
      if (![['x', 2], ['y', 2], ['w', 2], ['h', 2]].every(([k, tol]) => Math.abs((box as unknown as Record<string, number>)[k as string]! - at[k as 'x']) <= (tol as number))) {
        found.push({ text, problem: `the kit's ${name} box ${JSON.stringify(box)} is not where the plate is ${JSON.stringify(at)}` });
      }
    }
    // In a mirror game the camera picture is the scene and the plates are drawn over it by design; only a scene game keeps clear of them.
    for (const n of c.mode === 'scene' ? root.querySelectorAll<HTMLElement>('[data-hud]') : []) {
      const name = n.dataset['hud'] as string;
      if (n.hidden || name === 'pip') continue;
      const r = n.getBoundingClientRect();
      const box = { x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height };
      if (r.width > 0 && r.height > 0 && overlaps(play, box)) found.push({ text, problem: `the play area ${JSON.stringify(play)} is under the ${name} plate ${JSON.stringify(box)}` });
    }
  }
  kit.dispose();
  scene.replaceChildren();
  return found;
}

/** Leaves one reason (and a command) on the screen, for a picture of it. */
function show(c: Case, text: string, command = 'Jack'): string[] {
  const h = open(c);
  h.set('prompt', { text: command, icon: 'stand' });
  say(h, c.duo, text);
  return h.problems();
}

declare global {
  interface Window { __HUD__: { check(c: Case): Found[]; rivals(c: Case): { who: string; problems: string[] }[]; kit(c: Case): { text: string; problem: string }[]; reasons(lang: Lang): string[]; commands(lang: Lang): string[]; show(c: Case, text: string, command?: string): string[] } }
}
window.__HUD__ = { check, rivals, kit: kitAgrees, reasons, commands, show };
