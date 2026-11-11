// The form coach page, behind ?form=1 (like the Worlds page): not linked from the site until the whole catalogue of SPEC.md is
// built and tested (no partial launch). The SAME camera and pose services as the games; the picture never leaves the device.
//   ?form=1&move=<a move id of packages/core/form/moves/index.ts>&lang=tr
//   ?form=1&trace=/tests/traces/form/<id>.trace.json   (developers and tests: a recorded landmark trace instead of the camera)
import { browserServices } from '../../../core/loop/browser.ts';
import { POSE_MODEL, WASM_BASE } from '../../../core/pose/assets.ts';
import { parseTrace, traceSource } from '../../../core/pose/trace.ts';
import { createFormCoach, type FormCoach } from '../../../core/form/coach.ts';
import { FORM_MOVES, FORM_MOVE_IDS, REAL_VIDEO_CHECKED, isFormMove } from '../../../core/form/moves/index.ts';
import type { CoachState, FormMoveId, GuideCheck, MoveGroup, MoveLabel } from '../../../core/form/types.ts';
import { drawFormBody, type FormCtx, type PictureRect } from '../../../core/render2d/form-overlay.ts';
import { detectLang, LANG_INFO, type Lang } from '../../../core/ui/i18n/index.ts';
import type { CameraLease, PoseFrame } from '../../../core/types/index.ts';
import { FORM_WORDS, fill, type FormWords } from './strings.ts';

const CSS = `
.fc{--fc-bg:#140F27;--fc-panel:#1C1433;--fc-line:#31285A;--fc-text:#F4F2F8;--fc-muted:#A79FBE;--fc-ok:#22C383;--fc-tip:#FFC53A;--fc-bad:#F23A5C;
  min-height:100vh;background:var(--fc-bg);color:var(--fc-text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  display:grid;grid-template-columns:minmax(0,1fr) 380px;grid-template-rows:auto 1fr;gap:16px;padding:16px;box-sizing:border-box}
.fc *{box-sizing:border-box}
.fc-top{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px}
.fc-top a{color:var(--fc-text);font-weight:800;text-decoration:none;font-size:18px}
.fc-top h1{margin:0;font-size:22px;font-weight:700}
.fc-top p{margin:0;color:var(--fc-muted);font-size:14px}
.fc-moves{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto;font-weight:700}
.fc-moves select{font:inherit;font-weight:700;border-radius:12px;border:1px solid var(--fc-line);background:var(--fc-panel);color:var(--fc-text);padding:10px 14px;min-height:44px;max-width:100%}
.fc-btn{font:inherit;font-weight:700;border-radius:12px;border:1px solid var(--fc-line);background:var(--fc-panel);color:var(--fc-text);padding:10px 14px;cursor:pointer;min-height:44px}
.fc-btn--primary{background:#FF4F6E;border-color:#C8264A;color:#1C1433}
.fc-stage{position:relative;background:#000;border-radius:16px;overflow:hidden;min-height:60vh}
.fc-video,.fc-canvas{position:absolute;inset:0;width:100%;height:100%}
.fc-video{object-fit:cover;transform:scaleX(-1)}
.fc-hud{position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;pointer-events:none}
.fc-num{background:rgba(20,15,39,.78);border-radius:14px;padding:8px 14px;text-align:center;min-width:92px}
.fc-num b{display:block;font-size:44px;line-height:1.05;font-variant-numeric:tabular-nums}
.fc-num span{font-size:13px;color:var(--fc-muted);font-weight:600}
.fc-cue{position:absolute;left:12px;right:12px;bottom:12px;margin:0;background:rgba(20,15,39,.85);border-radius:14px;padding:14px 16px;font-size:clamp(20px,3.2vw,30px);font-weight:800;text-align:center;min-height:1.4em;border-left:8px solid transparent}
.fc-cue:empty{display:none}
.fc-cue[data-sev=error]{border-left-color:var(--fc-bad)}
.fc-cue[data-sev=tip]{border-left-color:var(--fc-tip)}
.fc-guide{position:absolute;left:50%;top:104px;transform:translateX(-50%);background:rgba(20,15,39,.9);border-radius:16px;padding:16px 20px;max-width:min(92%,460px)}
.fc-guide[hidden]{display:none}
.fc-guide ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:17px;font-weight:600}
.fc-guide li::before{content:"\\2022";display:inline-block;width:1.2em;color:var(--fc-tip)}
.fc-guide li[data-ok=true]::before{content:"\\2713";color:var(--fc-ok)}
.fc-side{display:grid;gap:16px;align-content:start}
.fc-card,.fc-summary{background:var(--fc-panel);border:1px solid var(--fc-line);border-radius:16px;padding:16px}
.fc-card h2,.fc-summary h2{margin:0 0 8px;font-size:20px}
.fc-chip{display:inline-block;font-size:13px;font-weight:700;border-radius:999px;padding:3px 10px;background:#0E7A4E;color:#D6F5E7;margin:0 6px 8px 0}
.fc-chip--trial{background:#8A5A00;color:#FFF1CC}
.fc-chip--count{background:#31285A;color:#F4F2F8}
.fc-num[hidden]{display:none}
.fc-card p{margin:0 0 10px;line-height:1.45}
.fc-card h3{margin:12px 0 6px;font-size:14px;color:var(--fc-muted);text-transform:uppercase;letter-spacing:.04em}
.fc-card ul{margin:0;padding-left:18px;line-height:1.5}
.fc-legend{display:flex;flex-wrap:wrap;gap:10px 14px;margin-top:12px;font-size:13px;color:var(--fc-muted)}
.fc-legend i{display:inline-block;width:28px;height:0;border-top:5px solid;vertical-align:middle;margin-right:6px}
.fc-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.fc-actions label{display:flex;gap:6px;align-items:center;font-size:15px;min-height:44px}
.fc-status{margin:0;color:var(--fc-muted);font-size:14px}
.fc-dots{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.fc-dots span{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;color:#140F27}
.fc-dots .ok{background:var(--fc-ok)} .fc-dots .bad{background:var(--fc-bad)}
@media (max-width:900px){.fc{grid-template-columns:1fr}.fc-moves{margin-left:0}.fc-stage{min-height:56vh}}
`;

interface Snapshot { reps: number; clean: number; holdMs: number; cue: string | null; view: string | null; ready: boolean; segments: Record<string, string>; frames: number; move: FormMoveId }

const GROUPS: readonly [MoveGroup, 'grpSquat' | 'grpLunge' | 'grpCardio' | 'grpStanding' | 'grpFloor' | 'grpDumbbell'][] = [
  ['squat', 'grpSquat'], ['lunge', 'grpLunge'], ['cardio', 'grpCardio'], ['standing', 'grpStanding'], ['floor', 'grpFloor'], ['dumbbell', 'grpDumbbell'],
];
const LABEL_KEY: Record<MoveLabel, 'formCount' | 'holdForm' | 'countOnly' | 'timeOnly'> = { F: 'formCount', H: 'holdForm', S: 'countOnly', T: 'timeOnly' };

function pickLang(win: Window): Lang {
  const q = new URLSearchParams(win.location.search).get('lang');
  const known = LANG_INFO.map((l) => l.code) as string[];
  if (q && known.includes(q)) return q as Lang;
  const seg = win.location.pathname.split('/')[1] ?? '';
  if (known.includes(seg)) return seg as Lang;
  return detectLang(win.navigator.languages);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function bootFormCoach(win: Window = window): () => void {
  const doc = win.document;
  const params = new URLSearchParams(win.location.search);
  const lang = pickLang(win);
  const W: FormWords = FORM_WORDS[lang];
  const tag = LANG_INFO.find((l) => l.code === lang)?.tag ?? 'en';
  doc.documentElement.lang = tag;
  doc.title = `${W.ui.title} · BodyArcade`;
  let move: FormMoveId = isFormMove(params.get('move')) ? (params.get('move') as FormMoveId) : 'squat';
  let coach: FormCoach = createFormCoach(move);
  let last: CoachState | null = null;
  let frames = 0;

  const style = el('style'); style.textContent = CSS; doc.head.append(style);
  const root = el('main', 'fc');
  const top = el('header', 'fc-top');
  const brand = el('a', '', 'BodyArcade'); brand.href = '/';
  const h1 = el('h1', '', W.ui.title);
  const privacy = el('p', '', W.ui.privacy);
  const tabs = el('label', 'fc-moves');
  const picker = el('select'); picker.dataset.movePicker = '';
  tabs.append(doc.createTextNode(W.ui.pickMove), picker);
  picker.addEventListener('change', () => { if (isFormMove(picker.value)) selectMove(picker.value); });
  top.append(brand, h1, privacy, tabs);
  const stage = el('section', 'fc-stage');
  const video = el('video', 'fc-video'); video.muted = true; video.playsInline = true; video.setAttribute('aria-hidden', 'true');
  const canvas = el('canvas', 'fc-canvas'); canvas.setAttribute('aria-hidden', 'true');
  const hud = el('div', 'fc-hud');
  const repsBox = el('div', 'fc-num'); const repsN = el('b', '', '0'); repsN.dataset.reps = ''; const repsLabel = el('span', '', W.ui.reps); repsBox.append(repsN, repsLabel);
  const cleanBox = el('div', 'fc-num'); const cleanN = el('b', '', '0'); cleanN.dataset.clean = ''; cleanBox.append(cleanN, el('span', '', W.ui.clean));
  hud.append(repsBox, cleanBox);
  const cue = el('p', 'fc-cue'); cue.setAttribute('aria-live', 'polite'); cue.dataset.cue = '';
  const guide = el('div', 'fc-guide'); const guideList = el('ul'); guide.append(guideList);
  stage.append(video, canvas, hud, guide, cue);
  const side = el('aside', 'fc-side');
  const card = el('section', 'fc-card');
  const actions = el('div', 'fc-actions');
  const startBtn = el('button', 'fc-btn fc-btn--primary', W.ui.start); startBtn.type = 'button';
  const finishBtn = el('button', 'fc-btn', W.ui.finish); finishBtn.type = 'button';
  const soundLabel = el('label'); const sound = el('input'); sound.type = 'checkbox'; sound.checked = true; soundLabel.append(sound, doc.createTextNode(W.ui.sound));
  const voiceLabel = el('label'); const voice = el('input'); voice.type = 'checkbox'; voice.checked = false; voiceLabel.append(voice, doc.createTextNode(W.ui.voice));
  actions.append(startBtn, finishBtn, soundLabel, voiceLabel);
  const status = el('p', 'fc-status'); status.setAttribute('role', 'status');
  const summary = el('section', 'fc-summary'); summary.hidden = true;
  side.append(actions, status, summary, card);
  root.append(top, stage, side);
  doc.body.append(root);

  function renderTabs(): void {
    picker.replaceChildren(...GROUPS.flatMap(([g, key]) => {
      const ids = FORM_MOVE_IDS.filter((id) => FORM_MOVES[id].group === g);
      if (!ids.length) return [];
      const og = el('optgroup'); og.label = W.ui[key];
      og.append(...ids.map((id) => { const o = el('option', '', W.moves[id].name); o.value = id; o.selected = id === move; return o; }));
      return [og];
    }));
    picker.value = move;
    // a held move counts seconds, not repetitions
    const held = !!FORM_MOVES[move].hold;
    repsLabel.textContent = held ? W.ui.seconds : W.ui.reps;
    cleanBox.hidden = held;
  }

  function renderCard(): void {
    const m = W.moves[move];
    const def = FORM_MOVES[move];
    const formed = def.label === 'F' || def.label === 'H';
    const chip = el('span', formed ? 'fc-chip' : 'fc-chip fc-chip--count', W.ui[LABEL_KEY[def.label]]);
    chip.dataset.label = def.label;
    const kids: Node[] = [el('h2', '', m.name), chip];
    if (!REAL_VIDEO_CHECKED[move]) kids.push(el('span', 'fc-chip fc-chip--trial', W.ui.notChecked));
    kids.push(el('p', '', m.setup));
    if (def.equipment?.length) {
      const eq = { chair: W.ui.eqChair, wall: W.ui.eqWall, step: W.ui.eqStep, dumbbell: W.ui.eqDumbbell } as const;
      kids.push(el('p', '', `${W.ui.equipment}: ${def.equipment.map((e) => eq[e]).join(', ')}`));
    }
    if (def.label === 'S') kids.push(el('p', 'fc-status', W.ui.countOnlyNote));
    if (def.label === 'T') kids.push(el('p', 'fc-status', W.ui.timeOnlyNote));
    const list = (title: string, items: string[]): Node[] => { const ul = el('ul'); ul.append(...items.map((t) => el('li', '', t))); return [el('h3', '', title), ul]; };
    kids.push(...list(W.ui.looks, m.looks), ...list(W.ui.cannot, m.cannot));
    const legend = el('div', 'fc-legend');
    for (const [k, color, dash] of [['legendOk', '#22C383', 'solid'], ['legendTip', '#FFC53A', 'dotted'], ['legendBad', '#F23A5C', 'dashed'], ['legendUnknown', '#A79FBE', 'dashed']] as const) {
      const s = el('span'); const i = el('i'); i.style.borderTopColor = color; i.style.borderTopStyle = dash; s.append(i, doc.createTextNode(W.ui[k])); legend.append(s);
    }
    kids.push(legend, el('p', 'fc-status', W.ui.tipsNote));
    card.replaceChildren(...kids);
  }

  function guideText(c: GuideCheck): string {
    switch (c.id) {
      case 'person': return W.ui.person;
      case 'parts': return fill(W.ui.parts, { parts: (c.missing.length ? c.missing : FORM_MOVES[move].parts).map((p) => W.parts[p as keyof FormWords['parts']] ?? p).join(', ') });
      case 'view': return c.want === 'side' ? W.ui.wantSide : c.want === 'front' ? W.ui.wantFront : W.ui.wantDiag;
      case 'distance': return c.hint === 'closer' ? W.ui.closer : W.ui.farther;
      case 'pose': return W.ui.lieDown;
    }
  }

  function selectMove(id: FormMoveId): void {
    move = id; coach = createFormCoach(id); last = null; summary.hidden = true;
    renderTabs(); renderCard(); updateHud(null);
    const u = new URL(win.location.href); u.searchParams.set('move', id); win.history.replaceState(null, '', u);
  }

  // ---- sound and voice ----
  let audio: AudioContext | null = null;
  function beep(good: boolean): void {
    if (!sound.checked) return;
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = good ? 880 : 440; g.gain.value = 0.0001;
      o.connect(g).connect(audio.destination);
      const t = audio.currentTime; g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    } catch { /* no audio on this device */ }
  }
  let spoken = { code: '', at: -Infinity };
  function say(code: string, t: number): void {
    if (!voice.checked || !('speechSynthesis' in win)) return;
    if (code === spoken.code && t - spoken.at < 4000) return;
    spoken = { code, at: t };
    try { const u = new SpeechSynthesisUtterance(W.cues[code] ?? ''); u.lang = tag; win.speechSynthesis.cancel(); win.speechSynthesis.speak(u); } catch { /* no speech here */ }
  }

  // ---- drawing ----
  let raf = 0, aspect = 16 / 9;
  function pictureRect(): PictureRect {
    const cw = canvas.width, ch = canvas.height;
    const vw = video.videoWidth || aspect * 1000, vh = video.videoHeight || 1000;
    const a = vw / vh;
    // the video is drawn with object-fit: cover; a trace has no video and is shown whole (contain)
    const cover = !!video.videoWidth;
    let w = cw, h = cw / a;
    if (cover ? h < ch : h > ch) { h = ch; w = ch * a; }
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, aspect: a };
  }
  function draw(): void {
    raf = 0;
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d') as FormCtx | null;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!last || !last.present) return;
    drawFormBody(ctx, last.pts, last.segments, { view: last.view, near: last.near, rect: pictureRect(), width: Math.max(4, Math.min(w, h) * 0.012) });
  }

  function updateHud(s: CoachState | null): void {
    repsN.textContent = FORM_MOVES[move].hold ? String(Math.floor((s?.holdMs ?? 0) / 1000)) : String(s?.reps ?? 0);
    cleanN.textContent = String(s?.clean ?? 0);
    const code = s?.cue ?? null;
    cue.textContent = code ? (W.cues[code] ?? '') : '';
    if (s?.cueSeverity) cue.dataset.sev = s.cueSeverity; else delete cue.dataset.sev;
    const checks = s?.guide.checks.filter((c) => !c.ok) ?? [];
    guide.hidden = !s || (s.guide.ready && s.present);
    guideList.replaceChildren(...checks.map((c) => { const li = el('li', '', guideText(c)); li.dataset.ok = 'false'; return li; }));
    if (s && !checks.length) { const li = el('li', '', W.ui.ready); li.dataset.ok = 'true'; guideList.replaceChildren(li); }
  }

  function onFrame(f: PoseFrame): void {
    aspect = f.aspect || aspect;
    const s = coach.push(f);
    last = s; frames++;
    if (s.repDone) beep(s.repDone.clean);
    if (s.cue) say(s.cue, s.t);
    updateHud(s);
    if (!raf) raf = win.requestAnimationFrame(draw);
  }

  function showSummary(): void {
    const sum = coach.summary();
    const kids: Node[] = [el('h2', '', W.ui.summaryTitle)];
    if (sum.holdMs !== undefined) {
      kids.push(el('p', '', fill(W.ui.holdLine, { s: Math.floor(sum.holdMs / 1000), best: Math.floor((sum.bestHoldMs ?? 0) / 1000) })));
      if (sum.top) kids.push(el('p', '', fill(W.ui.topError, { what: W.rules[sum.top.id] ?? sum.top.id, n: sum.top.count })));
    } else if (sum.reps === 0) kids.push(el('p', '', W.ui.noReps));
    else {
      kids.push(el('p', '', fill(W.ui.summaryLine, { reps: sum.reps, clean: sum.clean })));
      if (sum.sides) kids.push(el('p', '', fill(W.ui.sidesLine, { L: sum.sides.L, R: sum.sides.R })));
      kids.push(el('p', '', sum.top && sum.clean < sum.reps ? fill(W.ui.topError, { what: W.rules[sum.top.id] ?? sum.top.id, n: sum.top.count }) : W.ui.allClean));
      const dots = el('div', 'fc-dots');
      dots.append(...sum.list.map((r) => { const d = el('span', r.clean ? 'ok' : 'bad', String(r.n)); d.title = r.errors.map((e) => W.rules[e] ?? e).join(', '); return d; }));
      kids.push(dots);
    }
    const again = el('button', 'fc-btn', W.ui.again); again.type = 'button';
    again.addEventListener('click', () => { coach.reset(); last = null; summary.hidden = true; updateHud(null); });
    kids.push(again);
    summary.replaceChildren(...kids);
    summary.hidden = false;
  }
  finishBtn.addEventListener('click', showSummary);

  // ---- camera (or a trace) ----
  const services = browserServices();
  let lease: CameraLease | null = null, offFrame: (() => void) | null = null, offEnded: (() => void) | null = null, ac: AbortController | null = null;
  let stopTrace: (() => void) | null = null;
  function stopCamera(): void {
    ac?.abort(); ac = null; offFrame?.(); offFrame = null; offEnded?.(); offEnded = null; stopTrace?.(); stopTrace = null;
    services.pose.detach(); lease?.release(); lease = null; video.srcObject = null;
    startBtn.textContent = W.ui.start; startBtn.dataset.on = 'false';
  }
  async function startCamera(): Promise<void> {
    const c = new AbortController(); ac = c;
    startBtn.disabled = true; status.textContent = W.ui.loading;
    try {
      const traceUrl = params.get('trace');
      if (traceUrl && traceUrl.startsWith('/')) {
        const trace = parseTrace(await (await win.fetch(traceUrl)).json());
        const src = traceSource(trace);
        offFrame = services.pose.onFrame(onFrame);
        services.pose.attach(src);
        await src.start();
        stopTrace = () => src.stop();
      } else {
        lease = await services.camera.acquire({ signal: c.signal });
        if (c.signal.aborted) { lease.release(); lease = null; return; }
        await lease.start();
        video.srcObject = lease.stream; await video.play();
        await services.pose.load({ modelUrl: POSE_MODEL.url, wasmBase: WASM_BASE, prefer: 'GPU', maxHz: 30, signal: c.signal });
        await services.pose.warmUp();
        if (c.signal.aborted) return;
        offFrame = services.pose.onFrame(onFrame);
        offEnded = lease.onEnded(() => { stopCamera(); status.textContent = W.ui.cameraError; });
        services.pose.attach(lease);
      }
      status.textContent = '';
      startBtn.textContent = W.ui.stop; startBtn.dataset.on = 'true';
    } catch {
      if (!c.signal.aborted) { stopCamera(); status.textContent = W.ui.cameraError; }
    } finally { startBtn.disabled = false; }
  }
  startBtn.addEventListener('click', () => { if (startBtn.dataset.on === 'true') stopCamera(); else void startCamera(); });

  // test hook: what the page shows, without reading pixels
  (win as unknown as { __formCoach?: unknown }).__formCoach = {
    snapshot: (): Snapshot => ({ reps: last?.reps ?? 0, clean: last?.clean ?? 0, holdMs: last?.holdMs ?? 0, cue: last?.cue ?? null, view: last?.view ?? null, ready: last?.guide.ready ?? false, segments: { ...(last?.segments ?? {}) }, frames, move }),
    summary: () => coach.summary(),
  };

  renderTabs(); renderCard(); updateHud(null);
  const onResize = (): void => { if (!raf) raf = win.requestAnimationFrame(draw); };
  win.addEventListener('resize', onResize);
  const dispose = (): void => {
    stopCamera(); if (raf) win.cancelAnimationFrame(raf); win.removeEventListener('resize', onResize);
    try { void audio?.close(); } catch { /* closed */ }
    root.remove(); style.remove();
  };
  win.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
