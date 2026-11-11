// The home page's before/after band (coordinator decision 11 Nov 17:00, takip/devir/bodyarcade-sprint-11kas/FIKIRLER-ALINAN.md):
// no photo of a real-looking person and no invented "same person lost weight" picture. The progress coach's own 3D twin
// shows one body moving between two sets of tape measures, and next to it the real comparison tools: the earlier shape
// as a ghost and the change as a heat map. A corner label says "illustration"; the text names features, never results
// (no kilos, weeks or percentages). Light: nothing heavy loads until the band is near the screen; with reduced motion
// each view draws one still frame and the WebGL contexts are released (the still stays as an image).
//   import { mountBeforeAfterBand } from './growth/before-after-band.ts';
//   mountBeforeAfterBand(hostElement, { lang: 'tr', href: '/?gelisim=1' });
import type { Lang } from '../../../core/ui/i18n/index.ts';
import type { Tape } from '../../../core/growth/twin/model.ts';

const WORDS: Record<Lang, { title: string; text: string; label: string; before: string; after: string; ghost: string; heat: string; cta: string; slider: string }> = {
  en: { title: 'Track your own before and after', text: 'Your photos stay on your device. A 3D twin shaped by your own tape measures shows what changed, with a ghost of the earlier shape and a heat map.', label: 'illustration', before: 'Before', after: 'After', ghost: 'Ghost', heat: 'Heat map', cta: 'Open the progress coach', slider: 'Before to after' },
  tr: { title: 'Kendi önce ve sonranı takip et', text: 'Fotoğrafların cihazında kalır. Kendi mezura ölçülerinle şekillenen 3D ikizin neyin değiştiğini gösterir: önceki hâlin hayaleti ve bir ısı haritası.', label: 'temsili görsel', before: 'Önce', after: 'Sonra', ghost: 'Hayalet', heat: 'Isı haritası', cta: 'Gelişim koçunu aç', slider: 'Önceden sonraya' },
  de: { title: 'Verfolge dein eigenes Vorher und Nachher', text: 'Deine Fotos bleiben auf deinem Gerät. Ein 3D-Zwilling aus deinen eigenen Maßband-Werten zeigt, was sich verändert hat, mit einem Geist der früheren Form und einer Wärmekarte.', label: 'Illustration', before: 'Vorher', after: 'Nachher', ghost: 'Geist', heat: 'Wärmekarte', cta: 'Fortschritts-Coach öffnen', slider: 'Vorher bis nachher' },
  es: { title: 'Sigue tu propio antes y después', text: 'Tus fotos se quedan en tu dispositivo. Un gemelo 3D formado con tus propias medidas muestra lo que cambió, con un fantasma de la forma anterior y un mapa de calor.', label: 'ilustración', before: 'Antes', after: 'Después', ghost: 'Fantasma', heat: 'Mapa de calor', cta: 'Abrir el coach de progreso', slider: 'De antes a después' },
  fr: { title: 'Suis ton propre avant et après', text: 'Tes photos restent sur ton appareil. Un jumeau 3D formé par tes propres mesures montre ce qui a changé, avec le fantôme de la forme d’avant et une carte de chaleur.', label: 'illustration', before: 'Avant', after: 'Après', ghost: 'Fantôme', heat: 'Carte de chaleur', cta: 'Ouvrir le coach de progrès', slider: 'D’avant à après' },
};

/** Illustrative tapes for one body (not a person's data, not a result anyone is promised). */
export const BAND_TAPES: { height: number; before: Tape; after: Tape } = {
  height: 178,
  before: { neck: 41, chest: 110, waist: 104, hips: 108, thighL: 62, thighR: 62, calfL: 39, calfR: 39, upperArmL: 33, upperArmR: 33 },
  after: { neck: 39, chest: 106, waist: 92, hips: 101, thighL: 58, thighR: 58, calfL: 38, calfR: 38, upperArmL: 34, upperArmR: 34 },
};

const CSS = `
.bab{--bab-bg:#140F27;--bab-panel:#1C1433;--bab-line:#31285A;--bab-text:#F4F2F8;--bab-muted:#A79FBE;
  background:var(--bab-bg);color:var(--bab-text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:stretch;padding:24px clamp(16px,4vw,48px);box-sizing:border-box;width:100%}
.bab *{box-sizing:border-box}
.bab-copy{display:flex;flex-direction:column;justify-content:center;gap:12px}
.bab-copy h2{margin:0;font-size:clamp(24px,3vw,38px);line-height:1.12;font-weight:800}
.bab-copy p{margin:0;color:var(--bab-muted);font-size:clamp(15px,1.4vw,18px);line-height:1.5}
.bab-copy a{align-self:flex-start;font-weight:800;color:#140F27;background:#22C383;border-radius:12px;padding:12px 18px;text-decoration:none;min-height:44px}
.bab-card{position:relative;background:var(--bab-panel);border:1px solid var(--bab-line);border-radius:18px;overflow:hidden;min-height:340px;display:flex;flex-direction:column}
.bab-stage{position:relative;flex:1;min-height:280px}
.bab-stage canvas,.bab-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.bab-tag{position:absolute;top:10px;right:10px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--bab-muted);background:rgba(20,15,39,.8);border-radius:999px;padding:3px 9px}
.bab-foot{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:14px;font-weight:700}
.bab-foot input{flex:1;accent-color:#22C383;min-height:32px}
.bab-key{display:flex;gap:12px;flex-wrap:wrap;color:var(--bab-muted);font-weight:600}
.bab-key i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}
@media (max-width:900px){.bab{grid-template-columns:1fr 1fr}.bab-copy{grid-column:1/-1}}
@media (max-width:560px){.bab{grid-template-columns:1fr}.bab-card{min-height:300px}}
`;

export interface BandHandle { dispose(): void; ready: Promise<void>; root: HTMLElement }

export function mountBeforeAfterBand(host: HTMLElement, o: { lang: Lang; href?: string; eager?: boolean }): BandHandle {
  const W = WORDS[o.lang] ?? WORDS.en;
  const doc = host.ownerDocument;
  if (!doc.getElementById('bab-css')) { const s = doc.createElement('style'); s.id = 'bab-css'; s.textContent = CSS; doc.head.append(s); }
  const root = doc.createElement('section'); root.className = 'bab'; root.setAttribute('aria-label', W.title);
  const copy = doc.createElement('div'); copy.className = 'bab-copy';
  const h = doc.createElement('h2'); h.textContent = W.title;
  const p = doc.createElement('p'); p.textContent = W.text;
  const a = doc.createElement('a'); a.href = o.href ?? '/?gelisim=1'; a.textContent = W.cta;
  copy.append(h, p, a);
  const mk = (): { card: HTMLElement; stage: HTMLElement; foot: HTMLElement } => {
    const card = doc.createElement('figure'); card.className = 'bab-card'; card.style.margin = '0';
    const stage = doc.createElement('div'); stage.className = 'bab-stage';
    const tag = doc.createElement('span'); tag.className = 'bab-tag'; tag.textContent = W.label;
    const foot = doc.createElement('figcaption'); foot.className = 'bab-foot';
    card.append(stage, tag, foot);
    return { card, stage, foot };
  };
  const left = mk(), right = mk();
  const range = doc.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.value = '0'; range.setAttribute('aria-label', W.slider);
  const bLab = doc.createElement('span'); bLab.textContent = W.before; const aLab = doc.createElement('span'); aLab.textContent = W.after;
  left.foot.append(bLab, range, aLab);
  const key = doc.createElement('div'); key.className = 'bab-key';
  for (const [c, t] of [['#7FD8FF', W.ghost], ['#3FA9F5', `${W.heat} −`], ['#FF9F43', `${W.heat} +`]] as const) { const s = doc.createElement('span'); const i = doc.createElement('i'); i.style.background = c; s.append(i, doc.createTextNode(t)); key.append(s); }
  right.foot.append(key);
  root.append(copy, left.card, right.card);
  host.append(root);

  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let disposed = false;
  let stop = (): void => undefined;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((r) => { resolveReady = r; });

  async function start(): Promise<void> {
    const { createTwinView } = await import('./twin-view.ts');
    if (disposed) return;
    const morphView = createTwinView(left.stage, { interactive: true });
    const cmpView = createTwinView(right.stage, { interactive: true });
    const t = BAND_TAPES;
    await morphView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, morph: 0 });
    await cmpView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, ghost: true, heat: true });
    if (disposed) { morphView.dispose(); cmpView.dispose(); return; }
    root.dataset.ready = 'true';
    resolveReady();
    if (reduce) {
      // still frames only: keep them as images, release the GL contexts
      const still = (v: typeof morphView, stage: HTMLElement): void => { const img = doc.createElement('img'); img.alt = W.label; img.src = v.canvas.toDataURL('image/png'); v.dispose(); stage.append(img); };
      range.value = '100';
      await morphView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, morph: 1 });
      still(morphView, left.stage); still(cmpView, right.stage);
      range.disabled = true;
      return;
    }
    let userAt = -1e9, raf = 0;
    const set = (m: number): void => { void morphView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, morph: m }); };
    range.addEventListener('input', () => { userAt = performance.now(); set(Number(range.value) / 100); });
    const loop = (ms: number): void => {
      raf = requestAnimationFrame(loop);
      if (ms - userAt < 4000) return;
      // a slow ping-pong: 3 s each way, 1 s rest at each end
      const c = (ms / 1000) % 8, m = c < 3 ? c / 3 : c < 4 ? 1 : c < 7 ? 1 - (c - 4) / 3 : 0;
      const e = m * m * (3 - 2 * m);
      range.value = String(Math.round(e * 100));
      if (Math.round(ms / 33) % 2 === 0) set(e);
    };
    raf = requestAnimationFrame(loop);
    stop = () => { cancelAnimationFrame(raf); morphView.dispose(); cmpView.dispose(); };
  }

  if (o.eager || typeof IntersectionObserver === 'undefined') void start();
  else {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); void start(); } }, { rootMargin: '200px' });
    io.observe(root);
    const prev = stop; stop = () => { io.disconnect(); prev(); };
  }
  return { root, ready, dispose(): void { disposed = true; stop(); root.remove(); } };
}
