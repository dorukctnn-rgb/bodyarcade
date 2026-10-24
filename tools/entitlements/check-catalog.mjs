// The production check of the Gumroad catalog (packages/core/entitlements/catalog.ts): are the four plans that are sold
// really in Gumroad yet, or is one of them still a <PLACEHOLDER>?
//
//   node tools/entitlements/check-catalog.mjs             print the state of the four listings; exit 1 only for a listing that is
//                                                         wrong (a malformed id or link, an id used twice, an old product reused)
//   node tools/entitlements/check-catalog.mjs --release   the same, and exit 1 while ANY placeholder is left: the line the
//                                                         production deploy runs before it replaces the live site
//
// A placeholder never sells or grants anything (the server asks Gumroad only about real ids, the paywall offers only plans with
// a real link), so shipping one cannot go wrong quietly; it ships a paywall that lacks a plan. That is what this stops.
// The same gate lives in catalog.test.ts (BA_RELEASE=1 npx vitest run packages/core/entitlements/catalog.test.ts).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUMROAD_CATALOG, PRODUCT_ID_PATTERN, checkoutOf, isPlaceholder, placeholdersIn } from '../../packages/core/entitlements/catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, SOLD_PLAN_IDS } from '../../packages/core/entitlements/plans.ts';

/**
 * What is wrong with a catalog, in three lists of "plan.field" (or a sentence for the duplicates):
 *   placeholders  still <LIKE_THIS> or empty: Doruk has not created the product yet
 *   malformed     filled in but not what Gumroad gives (the id's characters, a link that is not on gumroad.com over https)
 *   clashes       an id used for two plans, or one of the two products sold before v2
 */
export function problemsOf(catalog = GUMROAD_CATALOG) {
  const placeholders = placeholdersIn(catalog);
  const malformed = [];
  const clashes = [];
  const links = checkoutOf(catalog);
  for (const id of SOLD_PLAN_IDS) {
    const l = catalog[id];
    if (!placeholders.includes(`${id}.productId`) && !PRODUCT_ID_PATTERN.test(l.productId)) malformed.push(`${id}.productId`);
    if (!placeholders.includes(`${id}.checkout`) && links[id] === undefined) malformed.push(`${id}.checkout`);
  }
  const seen = new Map();
  for (const id of SOLD_PLAN_IDS) {
    const v = catalog[id].productId;
    if (v === '' || isPlaceholder(v)) continue;
    if (Object.hasOwn(GUMROAD_LEGACY_PRODUCTS, v)) clashes.push(`${id}.productId is the id of a product sold before v2`);
    if (seen.has(v)) clashes.push(`${id}.productId is the same as ${seen.get(v)}.productId`);
    else seen.set(v, id);
  }
  return { placeholders, malformed, clashes };
}

/** The lines the command prints and whether it fails. */
export function report(problems, { release = false } = {}) {
  const lines = [];
  const { placeholders, malformed, clashes } = problems;
  for (const id of SOLD_PLAN_IDS) {
    const state = [`${id}.productId`, `${id}.checkout`].map((f) => (placeholders.includes(f) ? 'placeholder' : malformed.includes(f) ? 'malformed' : 'ok'));
    lines.push(`  ${id.padEnd(14)} product id: ${state[0]}, checkout link: ${state[1]}`);
  }
  for (const m of malformed) lines.push(`  malformed: ${m}`);
  for (const c of clashes) lines.push(`  clash: ${c}`);
  const wrong = malformed.length + clashes.length > 0;
  const open = placeholders.length > 0;
  let fails = wrong;
  if (open && release) {
    fails = true;
    lines.push(`  RELEASE: ${placeholders.length} placeholder(s) left (${placeholders.join(', ')}). Create the products in Gumroad and replace them in packages/core/entitlements/catalog.ts.`);
  } else if (open) {
    lines.push(`  ${placeholders.length} placeholder(s) left; fine for a preview, not for production (--release fails on them).`);
  }
  if (!wrong && !open) lines.push('  all four listings are real');
  return { lines, fails };
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(here).href) {
  const out = report(problemsOf(), { release: process.argv.includes('--release') });
  console.log('Gumroad catalog:');
  for (const line of out.lines) console.log(line);
  process.exit(out.fails ? 1 : 0);
}
