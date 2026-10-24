// The release Worker configs (wrangler.jsonc = preview, wrangler.prod.jsonc = production) must bind everything the
// Worker exports and everything the development config of the server binds, so a module added in packages/server
// (a Durable Object, a database) cannot ship without its binding. A builder who adds one adds it to both files here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);
const jsonc = (file: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(file, ROOT), 'utf8').replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>;

interface Cfg {
  main: string;
  durable_objects?: { bindings: { name: string; class_name: string }[] };
  migrations?: { tag: string; new_sqlite_classes?: string[] }[];
  d1_databases?: { binding: string; database_name: string; database_id: string }[];
  assets?: { directory: string; binding: string; not_found_handling: string };
  compatibility_date: string;
}

/** Bindings the release cannot have yet, with the reason; the list must only shrink. */
const PENDING: Readonly<Record<string, string>> = {};   // none: the social module's tables are inside its Durable Object (SOCIAL), so there is no database to wait for

const server = jsonc('packages/server/wrangler.jsonc') as unknown as Cfg;
const entry = readFileSync(new URL('packages/server/src/index.ts', ROOT), 'utf8');
const exported = [...entry.matchAll(/^export \{ (\w+) \} from/gm)].map((m) => m[1] as string);

for (const file of ['wrangler.jsonc', 'wrangler.prod.jsonc']) {
  describe(file, () => {
    const cfg = jsonc(file) as unknown as Cfg;

    it('runs the one Worker entry with the release folder as its assets and the app\'s 404 page', () => {
      expect(cfg.main).toBe('packages/server/src/index.ts');
      expect(cfg.assets).toMatchObject({ directory: './dist', binding: 'ASSETS', not_found_handling: '404-page' });
      expect(cfg.compatibility_date).toBe(server.compatibility_date);
    });

    it('binds every Durable Object class the Worker exports, with the same migrations as the server config', () => {
      const bound = (cfg.durable_objects?.bindings ?? []).map((b) => b.class_name).sort();
      expect(bound).toEqual([...exported].sort());
      expect(cfg.durable_objects?.bindings).toEqual(server.durable_objects?.bindings);
      expect(cfg.migrations).toEqual(server.migrations);
    });

    it('binds every database of the server config (or lists why not yet)', () => {
      const have = new Set((cfg.d1_databases ?? []).map((d) => d.binding));
      const missing = (server.d1_databases ?? []).map((d) => d.binding).filter((b) => !have.has(b));
      expect(missing.filter((b) => !(b in PENDING))).toEqual([]);
      for (const d of cfg.d1_databases ?? []) expect(d.database_id, d.binding).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
}
