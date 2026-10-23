// Shared primitive types used by every module of the contract.

/** Calling it removes the listener. Calling it twice is harmless. */
export type Unsubscribe = () => void;

export type Vec2 = { x: number; y: number };

/** Plain text, or text per language code ('en', 'tr', 'de', 'es', 'fr'). */
export type LocalizedString = string | Record<string, string>;

/** The player's own left and right (anatomical), never the screen side. */
export type Side = 'L' | 'R';

export type JointName = 'nose' | 'shoulder' | 'elbow' | 'wrist' | 'hand' | 'hip' | 'knee' | 'ankle' | 'foot';

/** Groups of landmarks that framing checks and detectors ask about. */
export type BodyPart = 'head' | 'shoulders' | 'elbows' | 'hands' | 'hips' | 'knees' | 'ankles' | 'feet';

/** Milliseconds on the performance.now() clock (monotonic). Never Date.now() in simulation or input code. */
export type Ms = number;
