// Checks a list of game manifests against the JSON Schema and against the rules a schema cannot say: unique ids,
// slugs and orders, related games that exist, notes only where the game has the variant, copy rules, text lengths,
// and (when asked) a translation for every required language. Node only (the schema validator is a build tool).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { LocalizedString } from '../../core/types/index.ts';
import { LANGS, type Lang } from '../../core/ui/i18n/index.ts';
import { copyProblems } from './copy.ts';
import type { CatalogueProblem, GameEntry } from './types.ts';

const schema = JSON.parse(readFileSync(new URL('./manifest.schema.json', import.meta.url), 'utf8')) as object;
const validateSchema = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);

export interface ValidateOptions {
  /** Languages every localized field must have. English is always required by the schema. */
  requiredLangs?: readonly Lang[];
  /** Folder with the tile art; when given, every `tile` must exist as <tile>.webp there. */
  tilesDir?: string;
}

const MAX = { title: 40, tagline: 90, about: 420, how: 170, measures: 140, note: 170 } as const;

function texts(ls: LocalizedString): [string, string][] {
  return typeof ls === 'string' ? [['en', ls]] : Object.entries(ls);
}

function checkText(where: string, field: string, ls: LocalizedString, max: number, langs: readonly Lang[], out: CatalogueProblem[]): void {
  // Plain text is the same in every language (a game name); only per-language objects can lack a language.
  const have = new Set(texts(ls).map(([l]) => l));
  if (typeof ls !== 'string') for (const l of langs) if (!have.has(l)) out.push({ where, message: `${field} has no ${l} text` });
  for (const [l, t] of texts(ls)) {
    if (t.length > max) out.push({ where, message: `${field} (${l}) is ${t.length} characters, the limit is ${max}` });
    for (const p of copyProblems(t)) out.push({ where, message: `${field} (${l}) ${p}` });
  }
}

/** Schema and rule checks for one entry. */
export function checkEntry(raw: unknown, label: string, o: ValidateOptions = {}): { entry: GameEntry | null; problems: CatalogueProblem[] } {
  const problems: CatalogueProblem[] = [];
  if (!validateSchema(raw)) {
    for (const e of validateSchema.errors ?? []) problems.push({ where: label, message: `${e.instancePath || '/'} ${e.message ?? 'is invalid'}` });
    return { entry: null, problems };
  }
  const e = raw as unknown as GameEntry;
  const langs = [...new Set(['en', ...(o.requiredLangs ?? [])])].filter((l): l is Lang => (LANGS as readonly string[]).includes(l));
  const c = e.catalogue;
  checkText(label, 'title', e.title, MAX.title, langs, problems);
  checkText(label, 'tagline', c.tagline, MAX.tagline, langs, problems);
  checkText(label, 'about', c.about, MAX.about, langs, problems);
  c.how.forEach((s, i) => checkText(label, `how[${i}]`, s, MAX.how, langs, problems));
  c.measures.forEach((s, i) => checkText(label, `measures[${i}]`, s, MAX.measures, langs, problems));
  if (e.seated && !c.seatedNote) problems.push({ where: label, message: 'the game has a seated version but no seatedNote' });
  if (!e.seated && c.seatedNote) problems.push({ where: label, message: 'seatedNote on a game without a seated version' });
  if (e.silentSafe && !c.quietNote) problems.push({ where: label, message: 'the game can be played quietly but has no quietNote' });
  if (!e.silentSafe && c.quietNote) problems.push({ where: label, message: 'quietNote on a game that cannot be played quietly' });
  if (c.seatedNote) checkText(label, 'seatedNote', c.seatedNote, MAX.note, langs, problems);
  if (c.quietNote) checkText(label, 'quietNote', c.quietNote, MAX.note, langs, problems);
  if (c.related?.includes(e.id)) problems.push({ where: label, message: 'related lists the game itself' });
  if (o.tilesDir && !existsSync(join(o.tilesDir, `${c.tile}.webp`))) problems.push({ where: label, message: `tile art ${c.tile}.webp is missing` });
  return { entry: problems.length === 0 ? e : null, problems };
}

/** Checks every entry and the rules across entries. Returns the entries that passed everything. */
export function checkCatalogue(items: readonly { label: string; data: unknown }[], o: ValidateOptions = {}): { entries: GameEntry[]; problems: CatalogueProblem[] } {
  const problems: CatalogueProblem[] = [];
  const entries: GameEntry[] = [];
  for (const it of items) {
    const r = checkEntry(it.data, it.label, o);
    problems.push(...r.problems);
    if (r.entry) entries.push(r.entry);
  }
  const dup = (key: string, pick: (e: GameEntry) => string | number): void => {
    const seen = new Map<string | number, string>();
    for (const e of entries) {
      const k = pick(e);
      const prev = seen.get(k);
      if (prev) problems.push({ where: e.id, message: `${key} ${String(k)} is also used by ${prev}` });
      else seen.set(k, e.id);
    }
  };
  dup('id', (e) => e.id);
  dup('slug', (e) => e.seo.slug);
  dup('order', (e) => e.catalogue.order);
  const ids = new Set(entries.map((e) => e.id));
  for (const e of entries) {
    for (const r of e.catalogue.related ?? []) if (!ids.has(r)) problems.push({ where: e.id, message: `related game ${r} does not exist in this catalogue` });
  }
  return { entries: entries.slice().sort((a, b) => a.catalogue.order - b.catalogue.order), problems };
}
