// What the app holds as its signed Pro token right now, as live play reads it. The reader is the app's own function
// (`() => entitlements.current().token`), asked at every create, join and ticket renewal. Live play must not depend on the health of the
// entitlement layer: a free game never needs a token, so a reader that throws, answers with something that is no token text or with a
// text no entitlement token can be (a body that would not fit the request) counts as "no token" and the room goes on without one.
// The text is never looked into here: the Worker is the one that checks it (packages/server/src/live/pro.ts).

/** The longest an entitlement token can be (core/entitlements/token.ts MAX_TOKEN_CHARS); a longer text is not one. */
export const MAX_PRO_TOKEN_CHARS = 2048;

export type ProTokenReader = () => string | null | undefined;

export function currentProToken(read: ProTokenReader | undefined): string | null {
  if (!read) return null;
  try {
    const t = read();
    return typeof t === 'string' && t.length > 0 && t.length <= MAX_PRO_TOKEN_CHARS ? t : null;
  } catch {
    return null;
  }
}
