// The production check of the Gumroad catalog: it fails a release while a placeholder is left, whatever else is true, and it
// says which ones. The catalog in the repository changes the day the products exist, so nothing here depends on its state.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUMROAD_CATALOG, placeholdersIn, type GumroadListing } from '../../packages/core/entitlements/catalog.ts';
import { GUMROAD_LEGACY_PRODUCTS, SOLD_PLAN_IDS, type SoldPlanId } from '../../packages/core/entitlements/plans.ts';

type Catalog = Readonly<Record<SoldPlanId, GumroadListing>>;
interface Problems { placeholders: string[]; malformed: string[]; clashes: string[] }
interface Tool {
  problemsOf(c?: Catalog): Problems;
  report(p: Problems, o?: { release?: boolean }): { lines: string[]; fails: boolean };
}
const toolUrl = new URL('./check-catalog.mjs', import.meta.url);
const tool = (): Promise<Tool> => import(/* @vite-ignore */ toolUrl.href) as Promise<Tool>;

const real = (): Catalog => Object.fromEntries(SOLD_PLAN_IDS.map((id, i) => [id, { productId: `RealProductId${i}==`, checkout: `https://dorukctn.gumroad.com/l/real${i}` }])) as unknown as Catalog;
const with1 = (id: SoldPlanId, l: GumroadListing): Catalog => ({ ...real(), [id]: l });

describe('tools/entitlements/check-catalog.mjs', () => {
  it('finds nothing wrong with four real listings, and the release check passes them', async () => {
    const t = await tool();
    const p = t.problemsOf(real());
    expect(p).toEqual({ placeholders: [], malformed: [], clashes: [] });
    expect(t.report(p, { release: true })).toMatchObject({ fails: false });
    expect(t.report(p).lines.at(-1)).toContain('all four listings are real');
  });

  it('fails a release for one placeholder, by plan and field, and does not fail a preview for it', async () => {
    const t = await tool();
    const p = t.problemsOf(with1('lifetime', { productId: '<GUMROAD_PRODUCT_ID_LIFETIME>', checkout: 'https://dorukctn.gumroad.com/l/life' }));
    expect(p.placeholders).toEqual(['lifetime.productId']);
    const release = t.report(p, { release: true });
    expect(release.fails).toBe(true);
    expect(release.lines.join('\n')).toContain('lifetime.productId');
    expect(t.report(p).fails).toBe(false);
  });

  it('counts an empty value as a placeholder', async () => {
    const t = await tool();
    expect(t.problemsOf(with1('pro-yearly', { productId: '', checkout: '' })).placeholders).toEqual(['pro-yearly.productId', 'pro-yearly.checkout']);
  });

  it('fails even a preview for a value that is filled in wrongly', async () => {
    const t = await tool();
    const p = t.problemsOf(with1('pro-monthly', { productId: 'has spaces', checkout: 'http://dorukctn.gumroad.com/l/x' }));
    expect(p.malformed).toEqual(['pro-monthly.productId', 'pro-monthly.checkout']);
    expect(t.report(p).fails).toBe(true);
    const evil = t.problemsOf(with1('family-yearly', { productId: 'RealProductId9==', checkout: 'https://gumroad.com.evil.net/l/x' }));
    expect(evil.malformed).toEqual(['family-yearly.checkout']);
  });

  it('fails for an id used twice and for an id of a product sold before v2', async () => {
    const t = await tool();
    const twice = t.problemsOf({ ...real(), 'pro-yearly': { ...real()['pro-monthly'], checkout: 'https://dorukctn.gumroad.com/l/other' } });
    expect(twice.clashes).toEqual(['pro-yearly.productId is the same as pro-monthly.productId']);
    const old = Object.keys(GUMROAD_LEGACY_PRODUCTS)[0] as string;
    const reused = t.problemsOf(with1('lifetime', { productId: old, checkout: 'https://dorukctn.gumroad.com/l/life' }));
    expect(reused.clashes).toEqual(['lifetime.productId is the id of a product sold before v2']);
    expect(t.report(reused).fails).toBe(true);
  });

  it('judges the catalog of the repository the same way as the release test of catalog.test.ts', async () => {
    const t = await tool();
    const mine = t.problemsOf(GUMROAD_CATALOG);
    expect(mine.placeholders).toEqual(placeholdersIn());
    expect(mine.malformed).toEqual([]);
    expect(mine.clashes).toEqual([]);
  });

  it('as a command: --release exits 1 exactly while a placeholder is left, a plain run exits 0 for a catalog that is not wrong', () => {
    const file = fileURLToPath(toolUrl);
    const run = (...args: string[]) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 30_000 });
    const open = placeholdersIn().length > 0;
    const release = run('--release');
    expect(release.status).toBe(open ? 1 : 0);
    expect(release.stdout).toContain('Gumroad catalog:');
    if (open) expect(release.stdout).toContain(placeholdersIn()[0]);
    expect(run().status).toBe(0);
  }, 40_000);
});
