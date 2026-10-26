// The moment a frame of a WebGL stage can be copied. A WebGL canvas keeps its picture only until the browser has shown the frame
// (its drawing buffer is cleared then, unless the context asks to keep it, which costs a phone speed), so a copy made on a timer, or in
// any task but the one that drew, is a blank picture. The kit says when it has drawn one, in the same task, and whoever wants a copy
// of the picture (the highlight clip of a round: a smaller picture with the score and the time on it) takes it in that call.

const taps = new WeakMap<object, Set<() => void>>();

/** Calls `cb` right after every frame the kit draws on this canvas, in the task that drew it; the returned function stops it. */
export function tapFrames(canvas: object, cb: () => void): () => void {
  let set = taps.get(canvas);
  if (!set) { set = new Set(); taps.set(canvas, set); }
  set.add(cb);
  return () => { set?.delete(cb); };
}

/** The kit calls this when it has drawn a frame on `canvas`. A tap that throws never stops the round or the other taps. */
export function frameDrawn(canvas: object): void {
  const set = taps.get(canvas);
  if (!set || set.size === 0) return;
  for (const cb of [...set]) {
    try { cb(); } catch { /* a copy that failed is a frame less in a clip */ }
  }
}
