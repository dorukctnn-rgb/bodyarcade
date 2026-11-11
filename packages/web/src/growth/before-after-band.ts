// The home page's before/after band (coordinator decision 11 Nov 17:00, takip/devir/bodyarcade-sprint-11kas/FIKIRLER-ALINAN.md):
// no photo of a real-looking person and no invented "same person lost weight" picture. The progress coach's own 3D twin
// shows one body moving between two sets of tape measures, and next to it the real comparison tools: the earlier shape
// as a ghost and the change as a heat map. A corner label says "illustration"; the text names features, never results
// (no kilos, weeks or percentages). Light: nothing heavy loads until the band is near the screen; with reduced motion
// each view draws one still frame and the WebGL contexts are released (the still stays as an image).
// The markup (bandMarkup) is drawn by the page itself (the home page, views/home-sections.ts), so it is there before any script,
// with a still of each view; mountBeforeAfterBand brings it to life. Its styles are styles/band.css.
//   import { mountBeforeAfterBand } from './growth/before-after-band.ts';
//   mountBeforeAfterBand(hostElement, { lang: 'tr', href: '/tr/progress/' });
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

/** The stills of the two views (made from the views themselves with reduced motion; design/art/hero, served like the home page's pictures). */
export const BAND_STILLS = { morph: { file: 'band-morph-800.webp', width: 800, height: 536 }, compare: { file: 'band-compare-800.webp', width: 800, height: 568 } } as const;

const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The words of the band in a language (the home page's tests read them). */
export const bandWords = (lang: Lang): (typeof WORDS)[Lang] => WORDS[lang] ?? WORDS.en;

/**
 * The band as markup: the words, the two views (each with its still, when there is one, and the "illustration" label), the slider
 * under the first and the key under the second. `href` is the progress coach's address in the page's language.
 */
export function bandMarkup(lang: Lang, o: { href: string; stills?: { morph: string; compare: string } | null }): string {
  const W = bandWords(lang);
  const still = (view: 'morph' | 'compare', src: string | undefined): string => (src ? `<img src="${esc(src)}" alt="" width="${BAND_STILLS[view].width}" height="${BAND_STILLS[view].height}" loading="lazy" decoding="async" data-band-still>` : '');
  const card = (view: 'morph' | 'compare', foot: string): string => `<figure class="bab-card" style="margin:0"><div class="bab-stage" data-band-stage="${view}">${still(view, o.stills?.[view])}</div><span class="bab-tag">${esc(W.label)}</span><figcaption class="bab-foot">${foot}</figcaption></figure>`;
  const key = ([['#7FD8FF', W.ghost], ['#3FA9F5', `${W.heat} −`], ['#FF9F43', `${W.heat} +`]] as const).map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('');
  return `<section class="bab" aria-label="${esc(W.title)}" data-band><div class="bab-copy"><h2>${esc(W.title)}</h2><p>${esc(W.text)}</p><a href="${esc(o.href)}" data-native>${esc(W.cta)}</a></div>`
    + card('morph', `<span>${esc(W.before)}</span><input type="range" min="0" max="100" value="0" aria-label="${esc(W.slider)}"><span>${esc(W.after)}</span>`)
    + card('compare', `<div class="bab-key">${key}</div>`)
    + '</section>';
}

export interface BandHandle { dispose(): void; ready: Promise<void>; root: HTMLElement }

/**
 * Brings the band to life: the markup already on the page (host is the band, or holds it), or, when there is none (the test page),
 * the markup drawn here. `motion: false` (reduced motion, saving data, a test run) keeps a band that has stills as it is.
 */
export function mountBeforeAfterBand(host: HTMLElement, o: { lang: Lang; href?: string; eager?: boolean; motion?: boolean }): BandHandle {
  const W = bandWords(o.lang);
  const doc = host.ownerDocument;
  const drawnBefore = host.matches('[data-band]') || !!host.querySelector('[data-band]');
  if (!drawnBefore) host.insertAdjacentHTML('beforeend', bandMarkup(o.lang, { href: o.href ?? '/progress/' }));
  const band = (host.matches('[data-band]') ? host : host.querySelector<HTMLElement>('[data-band]')) as HTMLElement;
  const leftStage = band.querySelector<HTMLElement>('[data-band-stage="morph"]') as HTMLElement;
  const rightStage = band.querySelector<HTMLElement>('[data-band-stage="compare"]') as HTMLElement;
  const range = band.querySelector<HTMLInputElement>('input[type="range"]') as HTMLInputElement;

  const reduce = o.motion === false || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hasStills = !!leftStage.querySelector('img') && !!rightStage.querySelector('img');
  let disposed = false;
  let stop = (): void => undefined;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((r) => { resolveReady = r; });

  if (reduce && hasStills) {
    // the stills are the band: nothing to load
    range.value = '100'; range.disabled = true;
    band.dataset.ready = 'true';
    resolveReady();
    return { root: band, ready, dispose(): void { disposed = true; } };
  }

  async function start(): Promise<void> {
    const { createTwinView } = await import('./twin-view.ts');
    if (disposed) return;
    const morphView = createTwinView(leftStage, { interactive: true });
    const cmpView = createTwinView(rightStage, { interactive: true });
    const t = BAND_TAPES;
    await morphView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, morph: 0 });
    await cmpView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, ghost: true, heat: true });
    if (disposed) { morphView.dispose(); cmpView.dispose(); return; }
    // the live views take the place of the stills
    for (const img of band.querySelectorAll('[data-band-still]')) img.remove();
    band.dataset.ready = 'true';
    resolveReady();
    if (reduce) {
      // still frames only: keep them as images, release the GL contexts
      const still = (v: typeof morphView, stage: HTMLElement): void => { const img = doc.createElement('img'); img.alt = W.label; img.src = v.canvas.toDataURL('image/png'); v.dispose(); stage.append(img); };
      range.value = '100';
      await morphView.update({ base: 'male', heightCm: t.height, now: t.after, then: t.before, morph: 1 });
      still(morphView, leftStage); still(cmpView, rightStage);
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
    io.observe(band);
    const prev = stop; stop = () => { io.disconnect(); prev(); };
  }
  // markup drawn here goes with the band; the page's own markup stays the page's
  return { root: band, ready, dispose(): void { disposed = true; stop(); if (!drawnBefore) band.remove(); } };
}
