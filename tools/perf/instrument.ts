// The page-side counters of the frame-budget and leak runners. The script is added to every page before it loads and
// wraps the browser calls that hand out things which must be given back: WebGL objects, event listeners on the page
// itself, timers and animation callbacks, workers, audio contexts and camera tracks. It does not know the game, so it
// counts what any game does. Everything is read back with window.__qa.snapshot().
//
// Nothing here changes what the page does; the wrappers call the original and note the result. Counting listeners
// is limited to the long-lived targets (window, document, <html>, <body>, the camera device list, media query lists):
// a listener on a node that is thrown away goes with the node, but a listener left on the document is a leak.

export interface QaSnapshot {
  /** WebGL objects alive now, by kind, and how many were created and deleted in all. */
  gl: { live: Record<string, number>; created: number; deleted: number; contexts: number; contextsLost: number };
  /** Listeners alive on the long-lived targets, as "target:type" keys. */
  listeners: { total: number; byKey: Record<string, number> };
  timers: { intervals: number; timeouts: number; raf: number };
  workers: { live: number; created: number };
  audio: { contexts: number; closed: number };
  tracks: { live: number; opened: number };
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** Frame intervals (ms) since the frame meter was started; empty when it was not. */
  frames: number[];
  errors: string[];
}

export const QA_SCRIPT = `(() => {
  if (window.__qa) return;
  const errors = [];
  const guard = (f) => { try { return f(); } catch (e) { errors.push(String(e && e.message || e)); } };

  // ---- WebGL: every create has a delete ----
  const gl = { live: {}, created: 0, deleted: 0, contexts: 0, contextsLost: 0 };
  const alive = new WeakSet();
  const KINDS = ['Texture', 'Buffer', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer', 'VertexArray', 'Sampler', 'Query', 'TransformFeedback'];
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!P) continue;
    const proto = P.prototype;
    for (const kind of KINDS) {
      const make = proto['create' + kind];
      const drop = proto['delete' + kind];
      if (typeof make === 'function') proto['create' + kind] = function (...a) {
        const o = make.apply(this, a);
        if (o && !alive.has(o)) { alive.add(o); gl.live[kind] = (gl.live[kind] || 0) + 1; gl.created++; }
        return o;
      };
      if (typeof drop === 'function') proto['delete' + kind] = function (o) {
        if (o && alive.has(o)) { alive.delete(o); gl.live[kind] = (gl.live[kind] || 1) - 1; gl.deleted++; }
        return drop.call(this, o);
      };
    }
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = getContext.call(this, type, ...rest);
    if (c && /webgl/.test(String(type)) && !this.__qaGl) {
      this.__qaGl = true;
      gl.contexts++;
      this.addEventListener('webglcontextlost', () => { gl.contextsLost++; });
    }
    return c;
  };

  // ---- event listeners on the long-lived targets ----
  const targets = new Set([window, document]);
  guard(() => { if (document.documentElement) targets.add(document.documentElement); });
  guard(() => { if (navigator.mediaDevices) targets.add(navigator.mediaDevices); });
  guard(() => { if (window.visualViewport) targets.add(window.visualViewport); });
  const nameOf = (t) => t === window ? 'window' : t === document ? 'document' : t === document.documentElement ? 'html' : t === document.body ? 'body' : t === (navigator.mediaDevices || null) ? 'mediaDevices' : t === window.visualViewport ? 'visualViewport' : 'target';
  const reg = new Map();
  const key = (t, type, cap) => nameOf(t) + ':' + type + (cap ? ':capture' : '');
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const tracked = (t) => targets.has(t) || t === document.body || (t && t.matches && t.matches('html,body'));
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    guard(() => {
      // A listener that removes itself (once) or goes with an AbortSignal is not a leak: it is not counted.
      if (fn && tracked(this) && !(opts && typeof opts === 'object' && (opts.once || opts.signal))) {
        const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
        const k = key(this, type, cap);
        let m = reg.get(this); if (!m) { m = new Map(); reg.set(this, m); }
        let set = m.get(k); if (!set) { set = new Set(); m.set(k, set); }
        set.add(fn);
      }
    });
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    guard(() => {
      if (fn && tracked(this)) {
        const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
        const m = reg.get(this); const set = m && m.get(key(this, type, cap)); if (set) set.delete(fn);
      }
    });
    return remove.call(this, type, fn, opts);
  };

  // ---- timers and animation callbacks ----
  const timers = { intervals: 0, timeouts: 0, raf: 0 };
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout, raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  const intervals = new Set(), timeouts = new Set(), rafs = new Set();
  window.setInterval = function (f, ms, ...a) { const id = si.call(window, f, ms, ...a); intervals.add(id); return id; };
  window.clearInterval = function (id) { intervals.delete(id); return ci.call(window, id); };
  window.setTimeout = function (f, ms, ...a) {
    const id = st.call(window, typeof f === 'function' ? function (...x) { timeouts.delete(id); return f.apply(this, x); } : f, ms, ...a);
    timeouts.add(id); return id;
  };
  window.clearTimeout = function (id) { timeouts.delete(id); return ct.call(window, id); };
  window.requestAnimationFrame = function (f) {
    const id = raf.call(window, function (t) { rafs.delete(id); return f(t); });
    rafs.add(id); return id;
  };
  window.cancelAnimationFrame = function (id) { rafs.delete(id); return caf.call(window, id); };

  // ---- workers, audio, camera tracks ----
  const workers = { live: 0, created: 0 };
  const W = window.Worker;
  if (W) {
    window.Worker = function (...a) {
      const w = new W(...a); workers.live++; workers.created++;
      const t = w.terminate; let ended = false;
      w.terminate = function () { if (!ended) { ended = true; workers.live--; } return t.call(w); };
      return w;
    };
    window.Worker.prototype = W.prototype;
  }
  const audio = { contexts: 0, closed: 0 };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const A = window[name];
    if (!A) continue;
    const proto = A.prototype;
    const close = proto.close;
    window[name] = function (...a) { const c = new A(...a); audio.contexts++; return c; };
    window[name].prototype = proto;
    proto.close = function () { audio.closed++; return close.call(this); };
  }
  const tracks = { live: 0, opened: 0 };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = async function (c) {
      const s = await gum(c);
      for (const t of s.getTracks()) {
        tracks.live++; tracks.opened++;
        let done = false;
        const end = () => { if (!done) { done = true; tracks.live--; } };
        t.addEventListener('ended', end);
        const stop = t.stop; t.stop = function () { end(); return stop.call(t); };
      }
      return s;
    };
  }

  // ---- long tasks and frame intervals ----
  const long = { count: 0, totalMs: 0, maxMs: 0 };
  guard(() => new PerformanceObserver((l) => { for (const e of l.getEntries()) { long.count++; long.totalMs += e.duration; long.maxMs = Math.max(long.maxMs, e.duration); } }).observe({ entryTypes: ['longtask'] }));
  let frames = [];
  let meter = false;
  let last = 0;
  const tick = (t) => { if (!meter) return; if (last) frames.push(t - last); last = t; raf.call(window, tick); };

  window.__qa = {
    startFrames() { frames = []; last = 0; if (!meter) { meter = true; raf.call(window, tick); } },
    stopFrames() { meter = false; const f = frames; frames = []; return f; },
    snapshot() {
      let total = 0; const byKey = {};
      for (const m of reg.values()) for (const [k, set] of m) { if (set.size) { byKey[k] = (byKey[k] || 0) + set.size; total += set.size; } }
      return {
        gl: { live: { ...gl.live }, created: gl.created, deleted: gl.deleted, contexts: gl.contexts, contextsLost: gl.contextsLost },
        listeners: { total, byKey },
        timers: { intervals: intervals.size, timeouts: timeouts.size, raf: rafs.size },
        workers: { ...workers }, audio: { ...audio }, tracks: { ...tracks }, longTasks: { ...long }, frames: frames.slice(), errors: errors.slice(),
      };
    },
  };
})();`;
