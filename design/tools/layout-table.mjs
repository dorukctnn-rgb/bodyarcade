// Write the HUD breakpoint tables into design/LAYOUT.md (between the generated markers)
// from layout.mjs and the rendered check report (design/shots/hud/report.json).
// node design/tools/layout-table.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAKPOINTS, hudMetrics, shellGrid } from '../tokens/layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const report = JSON.parse(await readFile(path.join(root, 'shots', 'hud', 'report.json'), 'utf8'));
const find = (id, mode) => report.find((r) => r.breakpoint === id && r.mode === mode);
const rr = (o) => (o ? `${Math.round(o.w)} x ${Math.round(o.h)} at ${Math.round(o.x)}, ${Math.round(o.y)}` : 'none');
const ins = (i) => (i.top || i.right || i.bottom || i.left ? `${i.top} / ${i.right} / ${i.bottom} / ${i.left}` : '0');

const sizes = ['| Screen | Class | Safe insets (t / r / b / l) | Margin | Gap | Command | Command / height | Score and timer | Labels | Reason |', '|---|---|---|---|---|---|---|---|---|---|'];
for (const b of BREAKPOINTS) {
  const m = hudMetrics(b);
  sizes.push(`| ${b.label} | ${m.cls} | ${ins(m.insets)} | ${m.margin} | ${m.gap} | ${m.font.command} px | ${(100 * m.font.command / b.h).toFixed(1)} % | ${m.font.numeral} px | ${m.font.label} px | ${m.font.reason} px |`);
}

const place = ['| Screen | Self view (scene games) | Command row | Reason row | Live: your view | Live: friend or ghost | Mirror (target, rhythm) |', '|---|---|---|---|---|---|---|'];
for (const b of BREAKPOINTS) {
  const s = find(b.id, 'scene');
  const l = find(b.id, 'live-friend');
  const mi = find(b.id, 'mirror');
  const cmdRow = s.rects.command.y <= s.rects.statusLeft.y + 1 ? 'in the top row' : 'under the top row';
  const reasonRow = s.rects.reason.y + s.rects.reason.h <= s.rects.pip.y + 1 ? 'above the self view' : 'beside the self view';
  place.push(`| ${b.label} | ${rr(s.rects.pip)} | ${cmdRow} | ${reasonRow} | ${rr(l.rects.own)} | ${rr(l.rects.friend)} | ${mi.problems.length ? 'check failed' : 'fits the play area'} |`);
}

const checks = report.length;
const failed = report.filter((r) => r.problems.length).length;
const block = [
  '<!-- generated:hud-tables -->',
  '### Sizes',
  '',
  ...sizes,
  '',
  '### Positions (rendered, CSS px, origin top left, default corner bottom right)',
  '',
  ...place,
  '',
  `Rendered check: ${checks} layouts (10 screens x 7 modes, plus the 2-player modes on the 4 big screens), ${failed} with problems. Screenshots: \`design/shots/hud/<mode>-<screen>.webp\`.`,
  '<!-- /generated:hud-tables -->',
].join('\n');

const shell = ['| Screen | Navigation | Page gutter | Content width | Game grid | Grid gap | Game tile (art 4:3) |', '|---|---|---|---|---|---|---|'];
for (const b of BREAKPOINTS) {
  const g = shellGrid(b);
  shell.push(`| ${b.label} | ${g.nav} | ${g.gutter} | ${g.content} | ${g.cols} columns | ${g.gap} | ${g.tile} x ${g.tileArt} |`);
}
const shellBlock = ['<!-- generated:shell-table -->', ...shell, '<!-- /generated:shell-table -->'].join('\n');

const duo = ['| Screen | Shared self view | Player 1 score | Timer | Player 2 score | Command | Reasons |', '|---|---|---|---|---|---|---|'];
for (const b of BREAKPOINTS) {
  const d = find(b.id, 'duo');
  if (!d) continue;
  const R = d.rects;
  duo.push(`| ${b.label} | ${rr(R.pip)} | ${rr(R.statusP1)} | ${rr(R.timer)} | ${rr(R.statusP2)} | ${d.commandFont} px | ${R.reasonP1.y + R.reasonP1.h <= R.pip.y + 1 ? 'lifted above the self view' : 'beside the self view'} |`);
}
const duoBlock = ['<!-- generated:duo-table -->', ...duo, '', `2-player check: ${report.filter((x) => x.mode.startsWith('duo')).length} layouts (duo and the "step back in" state on the 4 big screens), ${report.filter((x) => x.mode.startsWith('duo') && x.problems.length).length} with problems.`, '<!-- /generated:duo-table -->'].join('\n');

const file = path.join(root, 'LAYOUT.md');
const md = await readFile(file, 'utf8');
const out = md.replace(/<!-- generated:hud-tables -->[\s\S]*<!-- \/generated:hud-tables -->/, block)
  .replace(/<!-- generated:shell-table -->[\s\S]*<!-- \/generated:shell-table -->/, shellBlock)
  .replace(/<!-- generated:duo-table -->[\s\S]*<!-- \/generated:duo-table -->/, duoBlock);
await writeFile(file, out);
console.log('LAYOUT.md tables updated');
