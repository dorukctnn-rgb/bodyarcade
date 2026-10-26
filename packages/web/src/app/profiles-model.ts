// The players screens (the Family plan's profiles) as plain rules: what to say for each failure of the profile book, how long ago
// someone played, what the rules of a profile do to the screens, and the state of the page that lists, adds, edits and removes.
// The book itself (core/store/profiles.ts) decides who may do what; this only decides how it is put into words and onto the page.
import type { AvatarId, FamilyEntry, PickerModel, ProfileRules, ProfileView } from '../../../core/store/index.ts';
import { dayOf, daysBetween } from '../../../core/store/index.ts';

// ---- what a profile does to the screens -----------------------------------------------------------------------------------

/** What the screens need to know of the player: who they are and what their rules allow. Null where there is no player (the page generator). */
export interface PlayerFacts {
  id: string;
  name: string;
  avatar: AvatarId;
  kid: boolean;
  owner: boolean;
  guarded: boolean;
  rules: ProfileRules;
  /** How many players can be played on this device (the switcher is drawn from two on). */
  players: number;
  /** The most the plan allows and how many there are, locked ones included. */
  capacity: { max: number; used: number };
}

/** The rules of a player who is the only one: everything open. A screen that has no player behaves like this. */
export const OPEN_RULES: ProfileRules = { record: true, online: true, purchase: 'open', autoPaywall: true, calories: true, ghosts: 'all', freeText: true, share: true };

export const rulesOf = (p: Pick<PlayerFacts, 'rules'> | null | undefined): ProfileRules => p?.rules ?? OPEN_RULES;

export function factsOf(active: ProfileView, o: { players: number; capacity: { max: number; used: number } }): PlayerFacts {
  return { id: active.id, name: active.name, avatar: active.avatar, kid: active.kid, owner: active.owner, guarded: active.guarded, rules: active.rules, players: o.players, capacity: o.capacity };
}

/** The switcher is drawn once there is someone to switch to. */
export const showsSwitcher = (p: PlayerFacts | null | undefined): boolean => !!p && p.players >= 2;

// ---- what to say ------------------------------------------------------------------------------------------------------------

const FAILURES: ReadonlySet<string> = new Set([
  'name_empty', 'name_long', 'name_chars', 'name_taken', 'avatar', 'plan', 'full', 'locked', 'unknown', 'confirm_required', 'frozen', 'exhausted', 'owner_kid', 'parent_gate',
]);

/** The key of the line for a code the profile book answered with: a code nobody knows is said as "that player is not here". */
export const failureKey = (code: string): string => `profile.err.${FAILURES.has(code) ? code : 'unknown'}`;

/** How long ago a profile was last used, in days of the player's own calendar: today, yesterday, n days, or never. */
export type LastPlayed = { kind: 'never' } | { kind: 'today' } | { kind: 'yesterday' } | { kind: 'days'; n: number };

export function lastPlayed(now: number, at: number | null, timeZone?: string): LastPlayed {
  if (at === null || !Number.isFinite(at)) return { kind: 'never' };
  const n = daysBetween(dayOf(at, timeZone), dayOf(now, timeZone));
  return n <= 0 ? { kind: 'today' } : n === 1 ? { kind: 'yesterday' } : { kind: 'days', n };
}

/** The wait the parent gate asks for, in the unit a person reads: seconds up to a minute, then whole minutes (rounded up). */
export function waitText(ms: number): { unit: 'sec' | 'min'; n: number } {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return sec <= 60 ? { unit: 'sec', n: sec } : { unit: 'min', n: Math.ceil(sec / 60) };
}

// ---- the page ---------------------------------------------------------------------------------------------------------------

/** What the form holds, as typed. */
export interface FormDraft { name: string; avatar: AvatarId; kid: boolean; seated: boolean }

/** A field of the form that something is said about. */
export type FormField = 'name' | 'avatar' | 'form';

export type ProfilesView =
  | { kind: 'pick' }
  | { kind: 'manage' }
  | { kind: 'form'; mode: 'create' | 'edit'; id: string | null; draft: FormDraft; error: { field: FormField; code: string } | null };

export interface ProfilesPageState {
  view: ProfilesView;
  /** Said once on the page, in the live region too (a player was added, removed, saved). */
  notice: string | null;
  /** The picker as the book answers it now (the cards, the add card, whether the list may be changed). */
  picker: PickerModel | null;
  /** The best of the family at the game the page was opened from, when it was; empty otherwise. */
  family: readonly FamilyEntry[];
  /** Where to go after a player is chosen: the address the visitor was on when the picker came up. */
  next: string | null;
}

export const NO_PROFILES_STATE: ProfilesPageState = { view: { kind: 'pick' }, notice: null, picker: null, family: [], next: null };

/** An address to go on to after the picker, from a query: only a path of this site (never another site, never a script). */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 300 || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return null;
  return raw.startsWith('/profiles') ? null : raw;
}

/** A draft for a new player: the first picture nobody has and the way the owner plays. */
export const newDraft = (avatar: AvatarId, seated: boolean): FormDraft => ({ name: '', avatar, kid: false, seated });

export const draftOf = (p: ProfileView): FormDraft => ({ name: p.name, avatar: p.avatar, kid: p.kid, seated: p.seated });
