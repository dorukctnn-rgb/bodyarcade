// Framing profiles: what the camera managed to measure of the player (types/body.ts FramingProfile) and which kinds of
// games each one can run. Pure helpers shared by the calibrator, the session and the UI.
import type { Framing, FramingProfile, GameKind, ProfileSupport } from '../types/index.ts';

/**
 * Torso length (shoulder midpoint to hip midpoint) over shoulder width, landmark to landmark, measured on the two real
 * recordings (U.S. Army standing 1.43, jumping jacks clip 1.51). Used when the hips are not in view (a desk).
 */
export const TORSO_PER_SHOULDER = 1.45;

/** Nose to ankle over shoulder width on the same recordings (4.23 and 4.57); only for distance advice. */
export const SPAN_PER_SHOULDER = 4.3;

/** How much a profile measures: 1 head and shoulders, 2 plus the hips, 3 the whole body. 'side' stands apart. */
export type Rank = 1 | 2 | 3;

export const RANK_OF: Readonly<Record<'upper' | 'seated' | 'full', Rank>> = { upper: 1, seated: 2, full: 3 };
export const PROFILE_OF: Readonly<Record<Rank, 'upper' | 'seated' | 'full'>> = { 1: 'upper', 2: 'seated', 3: 'full' };

const NONE: ProfileSupport = { full: false, upper: false, seated: false, side: false };

/**
 * Which game kinds a profile can run (null: nothing is measured, nothing can). Seated and upper-body games need only
 * the head, shoulders and arms; a full-body game needs the 'full' profile, a side game the 'side' one.
 */
export function supportOf(profile: FramingProfile | null): ProfileSupport {
  switch (profile) {
    case 'full': return { full: true, upper: true, seated: true, side: false };
    case 'seated': case 'upper': return { full: false, upper: true, seated: true, side: false };
    case 'side': return { full: false, upper: false, seated: false, side: true };
    default: return { ...NONE };
  }
}

/** The kind of a game for this run: its manifest framing, or 'seated' when the player plays it seated. */
export function gameKindOf(framing: Framing, seated: boolean): GameKind {
  return seated ? 'seated' : framing;
}

export function profileSupports(profile: FramingProfile | null, kind: GameKind): boolean {
  return supportOf(profile)[kind];
}

/** The Framing a profile is stored under (BodyProfile.framing): what the feature extractor and the presence gate go by. */
export function framingOf(profile: FramingProfile): Framing {
  return profile === 'full' ? 'full' : profile === 'side' ? 'side' : 'upper';
}

/** The profile a BodyProfile is (older ones carry only `framing`). */
export function kindOf(p: { framing: Framing; kind?: FramingProfile }): FramingProfile {
  return p.kind ?? p.framing;
}
