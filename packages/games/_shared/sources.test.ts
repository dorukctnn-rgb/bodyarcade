// What the four games play and say, checked in their source files. A sound that is not in the library is a silent move and a line that
// is not in the table shows its key on the screen ("fj.prompt.arm"); neither makes a unit run fail, and a browser run meets only the
// ones it happens to reach. So: every sound is one of the sound library's, every line a game says is in its table, every line of a table is
// said somewhere (translators' work is not thrown away), and every glyph of a command plate exists.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SFX_NAMES } from '../../core/audio/sfx.ts';
import { POSES } from '../../core/ui/glyphs.ts';
import { LB_STRINGS, PW_STRINGS } from '../gatepose/strings.ts';
import { FJ_STRINGS, TT_STRINGS } from '../strength/strings.ts';
import type { Tables } from './text.ts';

interface GameSource { name: string; prefix: string; tables: Tables; files: string[] }

const GAMES: GameSource[] = [
  { name: 'Firework Jacks', prefix: 'fj', tables: FJ_STRINGS, files: ['../strength/fireworks.ts', '../strength/fireworks-game.ts', '../strength/fireworks-view.ts'] },
  { name: 'Twist Turbine', prefix: 'tt', tables: TT_STRINGS, files: ['../strength/turbine.ts', '../strength/turbine-game.ts', '../strength/turbine-view.ts'] },
  { name: 'Limbo Bend', prefix: 'lb', tables: LB_STRINGS, files: ['../gatepose/limbo.ts', '../gatepose/limbo-game.ts', '../gatepose/limbo-view.ts'] },
  { name: 'Pose Wall', prefix: 'pw', tables: PW_STRINGS, files: ['../gatepose/posewall.ts', '../gatepose/posewall-game.ts', '../gatepose/posewall-view.ts'] },
];

/** A source without its comments (their words are not the game's). */
const source = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

/** What stands between the brackets of every call `name(...)` in a source, the brackets matched. */
function callsOf(src: string, name: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
    let depth = 1;
    let i = (m.index as number) + m[0].length;
    const from = i;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push(src.slice(from, i - 1));
  }
  return out;
}

/** The string literals an expression can give: the whole of it, or the branches of a conditional (what follows a ? or a :). */
const branchesOf = (expr: string): string[] => [...expr.matchAll(/(?:^|[?:]\s*)\(?\s*'([^']+)'/g)].map((m) => m[1] as string);

describe.each(GAMES)('$name: the source files', (g) => {
  const sources = g.files.map(source);

  it('plays only sounds of the sound library', () => {
    const played = sources.flatMap((s) => callsOf(s, 'play').flatMap(branchesOf));
    expect(played.length, 'it plays something').toBeGreaterThan(2);
    for (const name of played) expect(SFX_NAMES, `the sound '${name}'`).toContain(name);
  });

  it('says only lines that are in its table, and every line of its table is said somewhere', () => {
    const literal = new RegExp(`'(${g.prefix}\\.(?:prompt|announce|off|fit|team)[A-Za-z0-9.]*)'`, 'g');
    const said = new Set(sources.flatMap((s) => [...s.matchAll(literal)].map((m) => m[1] as string)));
    // a line named by a template (`pw.off.${limb}`) is said by every line that begins that way
    const prefixes = sources.flatMap((s) => [...s.matchAll(new RegExp(`\`(${g.prefix}\\.[A-Za-z0-9.]*\\.)\\$\\{`, 'g'))].map((m) => m[1] as string));
    // the cues of the reason strip (`cue.<code>`, cues.ts) are said by reasonText for whichever code a detector gives: cues.test.ts walks them
    const keys = Object.keys(g.tables.en).filter((k) => !k.startsWith('cue.'));
    for (const k of said) expect(keys, `the line '${k}' of the source`).toContain(k);
    for (const k of keys) expect(said.has(k) || prefixes.some((p) => k.startsWith(p)), `the line '${k}' of the table is said`).toBe(true);
  });

  it('puts only glyphs that exist on its command plate', () => {
    const glyphs = sources.flatMap((s) => [...s.matchAll(/\bicon:\s*([^,}]+)/g)].flatMap((m) => branchesOf(m[1] as string)));
    expect(glyphs.length, 'it names a glyph').toBeGreaterThan(0);
    for (const icon of glyphs) expect(Object.keys(POSES), `the glyph '${icon}'`).toContain(icon);
  });
});
