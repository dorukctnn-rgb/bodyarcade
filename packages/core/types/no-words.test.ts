// The platform (camera, pose, body, loop, input, device) produces no words for players, only codes and numbers (24 Oct: "no
// player-facing English from the platform"). The screen turns codes into sentences in the player's language. This guard reads
// the sources: nothing in them writes text to a screen, announces, or hands a sentence to the player; errors carry a code and a
// developer's detail. The behaviour is tested where it happens (session.test.ts: "the platform says codes, never words").
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const core = fileURLToPath(new URL('..', import.meta.url));
const FOLDERS = ['camera', 'pose', 'body', 'loop', 'input', 'device'];

const sources = FOLDERS.flatMap((d) =>
  readdirSync(join(core, d))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: `${d}/${f}`, text: readFileSync(join(core, d, f), 'utf8') })));

/** Code only: comments are not what a player sees. */
const codeOf = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

describe('the platform writes no text for the player', () => {
  it('has sources to look at', () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it('never announces, toasts, writes to the page or opens a dialog', () => {
    const sinks = /\.(announce|toast)\(|\b(textContent|innerText|innerHTML|outerHTML|insertAdjacentHTML)\b|\b(alert|confirm|prompt)\(|document\.(title|write)\b/;
    for (const s of sources) expect(codeOf(s.text), s.file).not.toMatch(sinks);
  });

  it('the session emits an error only as a code, the shell\'s own text (when it made one) and the developer detail', () => {
    const session = codeOf(sources.find((s) => s.file === 'loop/session.ts')!.text);
    const emits = [...session.matchAll(/emit\('error',[^)]*\)/g)].map((m) => m[0]);
    expect(emits).toEqual(["emit('error', { code, message: shown, detail })"]);
    // `shown` is empty unless the shell's own factory threw text in the player's language
    expect(session).toMatch(/function fail\(r: Run, code: SessionErrorCode, detail: string, shown = ''\)/);
    const calls = [...session.matchAll(/\bfail\(r, '([a-z_0-9]+)', ([^)]*(?:\([^)]*\))?[^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(c[1], 'a code, not a sentence').toMatch(/^[a-z_0-9]+$/);
  });

  it('the calibrators put only codes in their statuses: no string field in them is a sentence', () => {
    for (const f of ['body/calibrator.ts', 'body/calibrator2.ts', 'body/reading.ts', 'body/headroom.ts', 'body/guidance.ts', 'body/light.ts']) {
      const text = codeOf(sources.find((s) => s.file === f)!.text);
      // a single-quoted string (the style of these files) with two words in it is what a sentence looks like
      const sentences = [...text.matchAll(/'([^'\\\n]*)'/g)].map((m) => m[1] as string).filter((t) => /[a-z]+ [a-z]+/i.test(t));
      expect(sentences, f).toEqual([]);
    }
  });
});
