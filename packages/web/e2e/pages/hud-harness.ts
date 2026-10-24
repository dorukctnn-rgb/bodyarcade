// Browser side of e2e/hud.spec.ts: the real HUD (core/ui/hud/hud.ts) on the shell's own stylesheet, and every reason and every
// command a game can show ("miss.*", "*.prompt.*" and "*.cmd.*" of the shell and of the games), in every language, asked to
// fit. Nothing here asserts; the spec does.
import '../../src/styles/app.css';
import { PlayHud } from '../../../core/ui/hud/hud.ts';
import { createI18n, LANGS, stringTables, type Lang } from '../../../core/ui/i18n/index.ts';
import type { HudMode, PipPlacement } from '../../../core/ui/layout.ts';

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

/** Leaves one reason (and a command) on the screen, for a picture of it. */
function show(c: Case, text: string, command = 'Jack'): string[] {
  const h = open(c);
  h.set('prompt', { text: command, icon: 'stand' });
  say(h, c.duo, text);
  return h.problems();
}

declare global {
  interface Window { __HUD__: { check(c: Case): Found[]; reasons(lang: Lang): string[]; commands(lang: Lang): string[]; show(c: Case, text: string, command?: string): string[] } }
}
window.__HUD__ = { check, reasons, commands, show };
