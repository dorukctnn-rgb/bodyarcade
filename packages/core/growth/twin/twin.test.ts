// The body twin is shaped only by the typed tape: every band's circumference on the shaped mesh matches the value typed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blendTape, heat, measureShaped, prepare, shapeTwin } from './deform.ts';
import { decodeTwin, TAPE_PARTS, type Tape, type TwinBase } from './model.ts';
import { ratios } from './ratios.ts';

const load = (b: TwinBase) => {
  const buf = readFileSync(fileURLToPath(new URL(`../../../web/src/growth/assets/twin-${b}.bin`, import.meta.url)));
  return prepare(decodeTwin(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
};

describe.each(['female', 'male'] as const)('twin %s', (base) => {
  const prep = load(base);
  it('decodes: a whole closed body of the right height, CC0 source named', () => {
    const h = prep.model.header;
    expect(h.vertexCount).toBeGreaterThan(10_000);
    expect(h.heightM).toBeGreaterThan(1.5);
    expect(h.source).toMatch(/CC0/);
    expect(Math.max(...prep.model.indices)).toBeLessThan(h.vertexCount);
  });

  it('without any tape it is the base shape at the person height', () => {
    const sh = shapeTwin(prep, 180, {});
    const top = Math.max(...Array.from({ length: prep.model.header.vertexCount }, (_, i) => sh.positions[i * 3 + 1]!));
    expect(top * 100).toBeCloseTo(180, 0);
    for (const p of TAPE_PARTS) expect(sh.k[p]).toBe(1);
  });

  const tapes: Tape[] = base === 'female'
    ? [{ neck: 33, chest: 92, waist: 74, hips: 100, thighL: 57, thighR: 57, calfL: 36, calfR: 36, upperArmL: 28, upperArmR: 28 },
       { neck: 36, chest: 108, waist: 96, hips: 114, thighL: 66, thighR: 65, calfL: 40, calfR: 40, upperArmL: 34, upperArmR: 34 }]
    : [{ neck: 38, chest: 100, waist: 84, hips: 98, thighL: 56, thighR: 56, calfL: 37, calfR: 37, upperArmL: 31, upperArmR: 31 },
       { neck: 43, chest: 118, waist: 108, hips: 112, thighL: 64, thighR: 64, calfL: 41, calfR: 41, upperArmL: 37, upperArmR: 37 }];
  for (const [i, tape] of tapes.entries()) {
    it(`every band matches the typed value within 3 % (tape ${i + 1})`, () => {
      const height = base === 'female' ? 166 : 181;
      const sh = shapeTwin(prep, height, tape);
      for (const p of TAPE_PARTS) {
        const got = measureShaped(prep, sh, p);
        expect(Math.abs(got - tape[p]!) / tape[p]!, `${p}: ${got.toFixed(1)} vs ${tape[p]}`).toBeLessThan(0.03);
      }
    });
  }

  it('one side typed: the other side uses it', () => {
    const sh = shapeTwin(prep, 170, { thighL: 60 });
    expect(sh.k.thighR).toBe(sh.k.thighL);
  });

  it('the heat map: a smaller waist reads as less, the arms (unchanged) as nothing', () => {
    const a = shapeTwin(prep, 170, tapes[1]!);
    const b = shapeTwin(prep, 170, { ...tapes[1]!, waist: tapes[1]!.waist! - 8 });
    const h = heat(a, b);
    const m = prep.model, waistY = (prep.bands.waist as { y: number }).y;
    let waistHeat = 0, n = 0, armMax = 0;
    for (let i = 0; i < m.header.vertexCount; i++) {
      const y = m.positions[i * 3 + 1]!;
      if (m.regA[i] === 0 && m.wA[i]! > 0.95 && Math.abs(y - waistY) < 0.01) { waistHeat += h[i]!; n++; }
      if (m.regA[i] === 7 && m.wA[i]! > 0.95) armMax = Math.max(armMax, Math.abs(h[i]!));
    }
    expect(waistHeat / n).toBeLessThan(-0.05);
    expect(armMax).toBeLessThan(0.01);
  });

  it('time-lapse blends two tapes', () => {
    expect(blendTape({ waist: 90, hips: 100 }, { waist: 80 }, 0.5)).toEqual({ waist: 85, hips: 100 });
  });
});

describe('ratios', () => {
  it('waist to height (NICE) and waist to hip (WHO) with their references', () => {
    expect(ratios({ heightCm: 170, waist: 80, hips: 100, formula: 'female' })).toEqual([
      { id: 'whtr', value: 0.47, reference: 0.5, source: 'nice-ng246' },
      { id: 'whr', value: 0.8, reference: 0.85, source: 'who-2008' },
    ]);
    expect(ratios({ heightCm: 170, waist: 80, hips: 100, formula: 'mid' }).map((r) => r.id)).toEqual(['whtr']);
    expect(ratios({})).toEqual([]);
  });
});
