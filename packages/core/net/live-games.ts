// Which games a live room may not play for free: the Pro games (the manifests' `free: false`). The Room (packages/server/src/live)
// and the pages read the same list, so the server's answer and the shell's lock icon cannot drift apart. The paywall promises "rooms
// where everyone plays the Pro games the host picks": a room may start a Pro game only while a Pro entitlement that the Worker verified
// stands behind it (the host's, when the game was picked); the players in the room never need one.
//
// The list is the Pro games, not the free ones: an id nobody knows (the practice ids of tests, a game that does not exist yet) is not a
// game anybody can play, so it is not locked. live-games.test.ts reads every manifest in packages/games and fails when a manifest
// says Pro and this list does not (or the other way round), so a new Pro game cannot ship open to everyone.
export const PRO_GAMES: ReadonlySet<string> = new Set(['limbo-bend', 'pad-work', 'reaction-tag']);

/** Does a room need a Pro entitlement behind it to start this game? */
export const isProGame = (gameId: string): boolean => PRO_GAMES.has(gameId);
