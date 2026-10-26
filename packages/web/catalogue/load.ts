// Reads the catalogue from disk (Node only: the page generator, the Vite plugin and the tests).
//  - real manifests: packages/games/<id>/manifest.json, written by the game builders;
//  - development fixtures: packages/web/fixtures/manifests/<id>.json, for layouts, screenshots and tests until the
//    real games exist. A published build never uses fixtures ('none').
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lang } from '../../core/ui/i18n/index.ts';
import { checkCatalogue } from './validate.ts';
import { toShellGame, type Catalogue, type CatalogueProblem } from './types.ts';

export type FixtureMode = 'none' | 'fill' | 'only';

export interface LoadOptions {
  fixtures: FixtureMode;
  requiredLangs?: readonly Lang[];
  /** Repository root. Defaults to the checkout this file lives in. */
  root?: string;
}

export const repoRoot = (): string => fileURLToPath(new URL('../../../', import.meta.url));
export const tilesDir = (root = repoRoot()): string => join(root, 'design', 'art', 'tiles');

interface Item { label: string; id: string; data: unknown; fixture: boolean }

function readJson(path: string, label: string, problems: CatalogueProblem[]): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push({ where: label, message: `cannot read the file as JSON: ${(e as Error).message}` });
    return null;
  }
}

export function loadCatalogue(o: LoadOptions): { catalogue: Catalogue; problems: CatalogueProblem[] } {
  const root = o.root ?? repoRoot();
  const problems: CatalogueProblem[] = [];
  const items: Item[] = [];

  if (o.fixtures !== 'only') {
    const gamesDir = join(root, 'packages', 'games');
    if (existsSync(gamesDir)) {
      for (const d of readdirSync(gamesDir, { withFileTypes: true })) {
        const file = join(gamesDir, d.name, 'manifest.json');
        if (!d.isDirectory() || !existsSync(file)) continue;
        const label = `packages/games/${d.name}/manifest.json`;
        const data = readJson(file, label, problems);
        if (data === null) continue;
        const id = (data as { id?: unknown }).id;
        if (typeof id === 'string' && id !== d.name) problems.push({ where: label, message: `id ${id} must equal the folder name ${d.name}` });
        items.push({ label, id: typeof id === 'string' ? id : d.name, data, fixture: false });
      }
    }
  }

  if (o.fixtures !== 'none') {
    const fixDir = join(root, 'packages', 'web', 'fixtures', 'manifests');
    if (existsSync(fixDir)) {
      const real = new Set(items.map((i) => i.id));
      for (const f of readdirSync(fixDir).filter((n) => n.endsWith('.json')).sort()) {
        const label = `packages/web/fixtures/manifests/${f}`;
        const data = readJson(join(fixDir, f), label, problems);
        if (data === null) continue;
        const id = (data as { id?: unknown }).id;
        if (typeof id === 'string' && id !== f.replace(/\.json$/, '')) problems.push({ where: label, message: `id ${id} must equal the file name` });
        if (typeof id === 'string' && real.has(id)) continue;
        items.push({ label, id: typeof id === 'string' ? id : f, data, fixture: true });
      }
    }
  }

  const checked = checkCatalogue(items.map(({ label, data }) => ({ label, data })), {
    ...(o.requiredLangs ? { requiredLangs: o.requiredLangs } : {}),
    tilesDir: tilesDir(root),
  });
  problems.push(...checked.problems);
  const usedFixture = items.some((i) => i.fixture);
  const usedReal = items.some((i) => !i.fixture);
  return {
    catalogue: {
      version: 1,
      source: usedFixture ? (usedReal ? 'mixed' : 'fixtures') : 'games',
      games: checked.entries.map(toShellGame),
    },
    problems,
  };
}
