// Ratios from the person's own tape and height, each with its published reference (numbers and source ids only; the page
// words them as general information, never as a diagnosis). Sources:
//   whtr: NICE guideline NG246, "Overweight and obesity management" (2025): waist-to-height ratio, boundary 0.5.
//         https://www.nice.org.uk/guidance/ng246
//   whr:  WHO, "Waist circumference and waist-hip ratio: report of a WHO expert consultation" (2008, published 2011):
//         0.90 (men) and 0.85 (women). https://www.who.int/publications/i/item/9789241501491
export type RatioId = 'whtr' | 'whr';
export interface Ratio { id: RatioId; value: number; reference: number; source: 'nice-ng246' | 'who-2008' }

export const SOURCES = {
  'nice-ng246': 'https://www.nice.org.uk/guidance/ng246',
  'who-2008': 'https://www.who.int/publications/i/item/9789241501491',
} as const;

/** formula: the energy formula the person picked ('mid' gives no sex-specific reference for the hip ratio). */
export function ratios(o: { heightCm?: number | null; waist?: number | null; hips?: number | null; formula?: 'female' | 'male' | 'mid' | null }): Ratio[] {
  const out: Ratio[] = [];
  const round = (v: number): number => Math.round(v * 100) / 100;
  if (o.heightCm && o.waist && o.heightCm > 50 && o.waist > 20) out.push({ id: 'whtr', value: round(o.waist / o.heightCm), reference: 0.5, source: 'nice-ng246' });
  if (o.waist && o.hips && o.hips > 20 && (o.formula === 'female' || o.formula === 'male')) out.push({ id: 'whr', value: round(o.waist / o.hips), reference: o.formula === 'female' ? 0.85 : 0.9, source: 'who-2008' });
  return out;
}
