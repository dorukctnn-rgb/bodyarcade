// What must hold before a target is deployed, besides the build itself, and what must hold for its secrets as a whole.
// Used by release/deploy.ts only. The production gate is kept out of release/build.ts and out of CI on purpose: it fails
// until the Gumroad products exist (RELEASE NEEDS 3, Doruk creates them), and a CI that is red for that reason would hide
// real failures. The preview has no gate.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { TargetId } from './site.ts';

export interface Gate {
  name: string;
  cmd: string;
  args: string[];
  /** What a failure means and what to do, for the person who reads the deploy output. */
  why: string;
}

/** The gates of a target, in the order they run. Production: the Gumroad catalog (builder S's check) must hold no placeholder. */
export function gatesFor(id: TargetId, root: string): Gate[] {
  if (id !== 'production') return [];
  return [{
    name: 'Gumroad catalog',
    cmd: process.execPath,
    args: [join(root, 'tools', 'entitlements', 'check-catalog.mjs'), '--release'],
    why: 'a plan still has a placeholder where its Gumroad product belongs. Create the four products in Gumroad and put their ids and links in packages/core/entitlements/catalog.ts (RELEASE NEEDS 3); the live site is not replaced before that.',
  }];
}

/** Runs one command; true when it exits with 0. Replaceable in tests. */
export type GateRunner = (cmd: string, args: string[], cwd: string) => boolean;

const spawnRunner: GateRunner = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: 'inherit', windowsHide: true }).status === 0;

/** Runs the gates in order and stops at the first that fails; null when all pass. */
export function runGates(gates: readonly Gate[], cwd: string, run: GateRunner = spawnRunner): Gate | null {
  for (const g of gates) {
    console.log(`gate: ${g.name}`);
    if (!run(g.cmd, g.args, cwd)) return g;
  }
  return null;
}

/** Problems with the secrets as a set (each of them alone is optional); empty when all is well. */
export function secretProblems(secrets: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const token = !!secrets['ENT_MAIL_TOKEN'];
  const from = !!secrets['ENT_MAIL_FROM'];
  // The Worker reads them as a pair: with one of them the reminder box stays off and the Worker reports a problem.
  if (token !== from) out.push('ENT_MAIL_TOKEN and ENT_MAIL_FROM go together: set both (the trial reminder e-mail) or neither');
  return out;
}
