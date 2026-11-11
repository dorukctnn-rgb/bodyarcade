// The card of the vertical clip on the results screen (app/story-clip.ts makes the file). It starts as one button; while the clip is
// made it shows how far it is, and then the clip itself with a way to share it and to save it. The app fills the parts in place
// (data-story-*), so the page is not drawn again while the nine seconds are recorded.
import { html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import type { ViewContext } from '../context.ts';

export function storyCard(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  return html`<section class="k-card k-story" aria-labelledby="story-h" data-story="idle">
    <h2 class="k-h3" id="story-h">${t.t('story.title')}</h2>
    <p class="k-sub">${t.t('story.lead')}</p>
    <div class="k-storyframe" data-story-frame hidden><video class="k-storyvideo" playsinline muted loop controls preload="metadata" aria-label="${t.t('story.alt')}"></video></div>
    <div class="k-storyprogress" data-story-progress hidden><progress max="100" value="0" aria-labelledby="story-progress-text"></progress><span class="ba-small" id="story-progress-text" data-story-progress-text role="status">${t.t('story.making', { n: 0 })}</span></div>
    <div class="k-clipactions">
      <button type="button" class="ba-btn ba-btn--primary" data-action="story-make">${icon('star')}<span>${t.t('story.make')}</span></button>
      <button type="button" class="ba-btn ba-btn--primary" data-action="story-share" hidden>${icon('share')}<span>${t.t('story.share')}</span></button>
      <a class="ba-btn ba-btn--secondary" data-story-save hidden>${icon('download')}<span>${t.t('story.save')}</span></a>
    </div>
    <p class="k-fine" data-story-note>${t.t('story.note')}</p>
  </section>`;
}
