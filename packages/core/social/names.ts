// Display names. Under-18 players cannot type a name: they get a preset one ("Swift Falcon 42", presets.ts), so a name
// never carries a contact detail or an insult. Adults choose a name that passes the same filter the Room uses
// (core/net/chat-filter.ts checkName: 1-20 letters, digits, spaces and . _ -, no links, numbers, handles or insults).
import { checkName, type FilterReason } from '../net/chat-filter.ts';
import { policyFor } from './age.ts';
import { cryptoRandomBytes, type RandomBytes } from './codes.ts';
import { isPresetName, randomPresetName } from './presets.ts';
import type { AgeBand } from './types.ts';

export type NameRejection = FilterReason | 'preset_only' | 'bad_type';
export type NameResult = { ok: true; name: string } | { ok: false; reason: NameRejection };

/**
 * The name a player of `band` may carry. `requested` is what the person asked for:
 *   nothing (undefined, null or blank)  a random preset name for everyone (an adult may change it later)
 *   under 18                            only a preset name is accepted (a new random one is made on the server)
 *   adult                               a free name that passes the filter
 */
export function resolveName(band: AgeBand, requested: unknown, rb: RandomBytes = cryptoRandomBytes): NameResult {
  if (requested === undefined || requested === null || (typeof requested === 'string' && requested.trim() === '')) {
    return { ok: true, name: randomPresetName(rb) };
  }
  if (typeof requested !== 'string') return { ok: false, reason: 'bad_type' };
  if (policyFor(band).presetNameOnly) {
    return isPresetName(requested) ? { ok: true, name: requested } : { ok: false, reason: 'preset_only' };
  }
  const r = checkName(requested);
  return r.ok ? { ok: true, name: r.text } : { ok: false, reason: r.reason };
}

/** When a player steps down to an under-18 band the old free name must go: a preset name replaces it. */
export function nameAfterBandChange(newBand: AgeBand, currentName: string, rb: RandomBytes = cryptoRandomBytes): string {
  if (!policyFor(newBand).presetNameOnly) return currentName;
  return isPresetName(currentName) ? currentName : randomPresetName(rb);
}
