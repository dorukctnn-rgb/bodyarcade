// The checks of the ten screens (BUILD-PLAN "Screen layout rule", LAYOUT.md section 9) for a game's view on the recording scene:
// nothing the game wrote runs off the screen, and its hero stands clear of the HUD plates and of the self view. The width of a
// text is the recorder's (0.55 em a character), the same one the view wraps its lines by.
import type { TestScene } from './scene.ts';

export interface Hero { x: number; y: number; r: number }

const sizeOf = (font: string): number => Number.parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '10');

const overlaps = (c: Hero, r: { x: number; y: number; w: number; h: number }): boolean => {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r;
};

/** What is wrong with the picture just drawn on this scene, as a list of sentences; empty when nothing is. */
export function screenProblems(scene: TestScene, hero: Hero | null, label: string): string[] {
  const out: string[] = [];
  const { width: w, height: h } = scene.size;
  for (const t of scene.ctx.texts) {
    const px = sizeOf(t.font);
    const width = t.text.length * 0.55 * px;
    const x0 = t.align === 'center' ? t.x - width / 2 : t.align === 'right' || t.align === 'end' ? t.x - width : t.x;
    if (x0 < -2 || x0 + width > w + 2) out.push(`${label}: "${t.text}" runs off the screen (${Math.round(x0)} to ${Math.round(x0 + width)} of ${w})`);
    if (t.y < -2 || t.y > h + 2) out.push(`${label}: "${t.text}" is off the screen (y ${Math.round(t.y)} of ${h})`);
  }
  if (hero) {
    const r = scene.kit.rects;
    if (hero.x < r.play.x || hero.x > r.play.x + r.play.w || hero.y < r.play.y || hero.y > r.play.y + r.play.h) out.push(`${label}: the hero is outside the play area`);
    const plates = [...(r.pip ? [['self view', r.pip] as const] : []), ...Object.entries(r.hud).map(([k, v]) => [k, v] as const)];
    for (const [name, rect] of plates) if (overlaps(hero, rect)) out.push(`${label}: the hero is under the ${name} plate`);
  }
  return out;
}
