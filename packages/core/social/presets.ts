// Preset messages, reactions and preset names: the only words strangers and under-18 players can use.
//
// The message and reaction ids are the ones of the Room protocol (core/types/net.ts PRESETS and REACTIONS), re-exported
// here so the lobby code never keeps a second list. The interface translates the ids and draws reactions as icons,
// never as raw emoji characters in interface text.
import { PRESETS, REACTIONS, type PresetId, type ReactionId } from '../types/net.ts';
import { cryptoRandomBytes, type RandomBytes } from './codes.ts';

export const PRESET_MESSAGES = PRESETS;
export type PresetMessageId = PresetId;

export const REACTION_IDS = REACTIONS;
export type ReactionIdOf = ReactionId;

export const isPresetMessage = (x: unknown): x is PresetMessageId => typeof x === 'string' && (PRESET_MESSAGES as readonly string[]).includes(x);
export const isReaction = (x: unknown): x is ReactionIdOf => typeof x === 'string' && (REACTION_IDS as readonly string[]).includes(x);

// ───────── preset names for under-18 players ─────────
// "Swift Falcon 42": an adjective, an animal and a number from 10 to 99. Nothing a child types ever becomes a name, so
// a name can never carry a contact detail or an insult. Names are not unique; the friend code identifies a person.

export const NAME_ADJECTIVES = [
  'Swift', 'Brave', 'Calm', 'Bright', 'Bold', 'Cosmic', 'Lucky', 'Mighty', 'Nimble', 'Quick', 'Sunny', 'Steady',
  'Witty', 'Zesty', 'Fierce', 'Gentle', 'Happy', 'Jolly', 'Keen', 'Lively', 'Merry', 'Noble', 'Proud', 'Rapid',
  'Sharp', 'Silent', 'Smooth', 'Snappy', 'Spry', 'Wild', 'Agile', 'Daring',
] as const;

export const NAME_ANIMALS = [
  'Falcon', 'Otter', 'Panda', 'Tiger', 'Fox', 'Lynx', 'Heron', 'Koala', 'Gecko', 'Bison', 'Eagle', 'Wolf',
  'Seal', 'Orca', 'Moose', 'Raven', 'Cobra', 'Crane', 'Dingo', 'Gazelle', 'Hare', 'Ibis', 'Jaguar', 'Lemur',
  'Marten', 'Newt', 'Osprey', 'Puma', 'Quail', 'Robin', 'Stork', 'Yak',
] as const;

export const NAME_NUMBER_MIN = 10;
export const NAME_NUMBER_MAX = 99;

export interface PresetNameParts { adjective: number; animal: number; number: number }

export function presetName(p: PresetNameParts): string {
  const a = NAME_ADJECTIVES[p.adjective];
  const b = NAME_ANIMALS[p.animal];
  if (!a || !b || !Number.isInteger(p.number) || p.number < NAME_NUMBER_MIN || p.number > NAME_NUMBER_MAX) {
    throw new RangeError('presetName: parts out of range');
  }
  return `${a} ${b} ${p.number}`;
}

/** The parts of a preset name, or null when the text is not exactly one (case and spacing must match). */
export function parsePresetName(name: unknown): PresetNameParts | null {
  if (typeof name !== 'string') return null;
  const m = /^([A-Z][a-z]+) ([A-Z][a-z]+) (\d{2})$/.exec(name);
  if (!m) return null;
  const adjective = (NAME_ADJECTIVES as readonly string[]).indexOf(m[1] ?? '');
  const animal = (NAME_ANIMALS as readonly string[]).indexOf(m[2] ?? '');
  const number = Number(m[3]);
  if (adjective < 0 || animal < 0 || number < NAME_NUMBER_MIN || number > NAME_NUMBER_MAX) return null;
  return { adjective, animal, number };
}

export const isPresetName = (name: unknown): boolean => parsePresetName(name) !== null;

export function randomPresetName(rb: RandomBytes = cryptoRandomBytes): string {
  const b = rb(4);
  // 256 is not a multiple of 90, so take the number from two bytes to keep the bias below 0.2%.
  const n = (((b[2] ?? 0) << 8) | (b[3] ?? 0)) % (NAME_NUMBER_MAX - NAME_NUMBER_MIN + 1);
  return presetName({ adjective: (b[0] ?? 0) & 31, animal: (b[1] ?? 0) & 31, number: NAME_NUMBER_MIN + n });
}
