// WCAG contrast check for the token pairs the UI actually uses.
// node design/tools/contrast.mjs   (exits 1 if a pair fails its target)
import { themes, hud, palette } from '../tokens/tokens.mjs';

const lum = (hex) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const pairs = [];
for (const [name, t] of Object.entries(themes)) {
  pairs.push(
    [`${name}: text on bg`, t.text, t.bg, 4.5],
    [`${name}: text on surface`, t.text, t.surface, 4.5],
    [`${name}: muted text on bg`, t['text-muted'], t.bg, 4.5],
    [`${name}: muted text on surface`, t['text-muted'], t.surface, 4.5],
    [`${name}: on-accent on accent (buttons)`, t['on-accent'], t.accent, 4.5],
    [`${name}: accent text on bg`, t['accent-text'], t.bg, 4.5],
    [`${name}: accent text on surface`, t['accent-text'], t.surface, 4.5],
    [`${name}: hit text on surface`, t['hit-text'], t.surface, 4.5],
    [`${name}: reward text on surface`, t['reward-text'], t.surface, 4.5],
    [`${name}: info on surface`, t.info, t.surface, 4.5],
    [`${name}: focus ring on bg (non-text)`, t.focus, t.bg, 3],
    [`${name}: accent fill on bg (non-text)`, t.accent, t.bg, 2.5],
  );
}
pairs.push(
  ['hud: command text on command plate', hud['command-text'], hud['command-bg'], 4.5],
  ['hud: plate text on solid ink', hud['plate-text'], palette.ink[900], 7],
  ['hud: ink on sun (left hand chip)', palette.ink[900], palette.sun[400], 4.5],
  ['hud: ink on sky (right hand chip)', palette.ink[900], palette.sky[400], 4.5],
  ['hud: ink on go (hit chip)', palette.ink[900], palette.go[400], 4.5],
);

let failed = 0;
for (const [label, fg, bg, target] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= target;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)}  (needs ${target})  ${label}  ${fg} on ${bg}`);
}
if (failed) { console.log(`${failed} pair(s) below target`); process.exit(1); }
