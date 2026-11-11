// The shopping list (SPEC 4.4): the chosen days' ingredients added up, grouped by aisle, rounded to what a shop sells
// (packs, pieces, or 50 g steps for loose weight). Cooked grains and pulses become their dry weight. "At home" staples
// (oil, garlic, herbs) can be ticked off. No prices, no shop links.
import { FOODS, type PlanDay } from './planner.ts';

export type Aisle = 'produce' | 'meat' | 'dairy' | 'pantry' | 'bakery' | 'frozen';
export const AISLES: readonly Aisle[] = ['produce', 'meat', 'dairy', 'pantry', 'bakery', 'frozen'];

/** cooked weight -> dry weight (the meals use cooked FDC records) */
export const DRY: Readonly<Record<string, number>> = { rice: 0.35, brownRice: 0.38, bulgur: 0.4, lentils: 0.4, pasta: 0.42, couscous: 0.4, quinoa: 0.37, eggNoodles: 0.4 };
export const STAPLES: ReadonlySet<string> = new Set(['oliveOil', 'garlic', 'honey', 'butter', 'lemon', 'parsley', 'dill', 'mint']);

export interface ShoppingItem { food: string; aisle: Aisle; needG: number; buy: { kind: 'pack'; count: number; packG: number } | { kind: 'piece'; count: number } | { kind: 'weight'; g: number }; staple: boolean }

export function shoppingList(days: readonly PlanDay[], opts: { atHome?: ReadonlySet<string> } = {}): ShoppingItem[] {
  const need = new Map<string, number>();
  for (const d of days) for (const m of d.meals) {
    if (m.leftover) continue; // cooked the day before
    for (const g of m.grams) need.set(g.food, (need.get(g.food) ?? 0) + g.g * (m.meal.twice && m.slot === 'dinner' ? 2 : 1));
  }
  const out: ShoppingItem[] = [];
  for (const [food, g0] of need) {
    if (opts.atHome?.has(food)) continue;
    const f = FOODS[food]!;
    const g = Math.round(g0 * (DRY[food] ?? 1));
    let buy: ShoppingItem['buy'];
    if (f.piece) buy = { kind: 'piece', count: Math.max(1, Math.ceil(g / f.piece)) };
    else if (f.pack) buy = { kind: 'pack', count: Math.max(1, Math.ceil(g / f.pack)), packG: f.pack };
    else buy = { kind: 'weight', g: Math.max(50, Math.ceil(g / 50) * 50) };
    out.push({ food, aisle: f.aisle as Aisle, needG: g, buy, staple: STAPLES.has(food) });
  }
  return out.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.food.localeCompare(b.food));
}
