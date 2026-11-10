// The games that have catalogue art (keep in step with TILE_ART in tiles.mjs; this file has
// no three.js import so Node tools can read it).
export const TILE_IDS = ['squat-flap', 'knee-sprint', 'road-run', 'star-catch', 'pad-work', 'reaction-tag', 'firework-jacks', 'twist-turbine', 'summit-climb', 'limbo-bend', 'pose-wall'];

// The tiles that are frames of the game itself (design/tools/hero-frames.mjs --tiles), not dioramas: render-tiles.mjs leaves
// them alone unless it is asked for one of them with --only.
export const FRAME_TILES = ['squat-flap', 'road-run', 'pose-wall', 'star-catch'];
