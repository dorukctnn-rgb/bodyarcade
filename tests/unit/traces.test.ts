// Every committed trace file is valid: JSON schema, parser, monotonic times, and a person in most frames.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseTrace } from '../../packages/core/pose/trace.ts';

const root = fileURLToPath(new URL('../traces/', import.meta.url));
const schema = JSON.parse(readFileSync(new URL('../../packages/core/types/trace.schema.json', import.meta.url), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : n.endsWith('.trace.json') ? [p] : [];
  });
}

const files = walk(root);

describe('committed traces', () => {
  it('there are traces to check', () => { expect(files.length).toBeGreaterThan(0); });

  it.each(files.map((f) => [f.slice(root.length)]))('%s is a valid trace', (name) => {
    const json: unknown = JSON.parse(readFileSync(join(root, name), 'utf8'));
    expect(validate(json), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
    const t = parseTrace(json);
    expect(name.split(/[\\/]/).pop()).toBe(`${t.meta.id}.trace.json`);
    const withPerson = t.frames.filter((f) => f.lm !== null).length;
    expect(withPerson / t.frames.length).toBeGreaterThan(0.5);
    if (t.meta.origin !== 'synthetic') expect(t.meta.notes ?? '', 'real traces say where they came from').not.toBe('');
  });
});
