// The settings page. Every control is a real form control with a label; changes apply as they are made.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';
import { LANG_INFO } from '../../../core/ui/i18n/index.ts';
import { PIP_PLACEMENTS } from '../../../core/ui/settings.ts';
import { hasPro, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { segmented, switchRow } from './forms.ts';

export interface SettingsViewOptions {
  /** The effective reduced-motion state: the setting, or the device when the setting follows it. */
  reducedMotion: boolean;
}

function section(id: string, title: string, body: SafeHtml): SafeHtml {
  return html`<section class="ba-block ba-settings-section" aria-labelledby="${id}"><h2 id="${id}">${title}</h2><div class="ba-panel ba-panel--flush">${body}</div></section>`;
}

export function settingsPage(ctx: ViewContext, o: SettingsViewOptions): SafeHtml {
  const t = ctx.i18n;
  const s = ctx.settings;

  const play = html`
    ${switchRow({ id: 'set-seated', name: 'seated', label: t.t('settings.seated'), hint: t.t('settings.seated.hint'), checked: s.seated })}
    ${switchRow({ id: 'set-quiet', name: 'quiet', label: t.t('settings.quiet'), hint: t.t('settings.quiet.hint'), checked: s.quiet })}
    <div class="ba-row-setting ba-row-setting--stack">
      ${segmented('pipCorner', t.t('settings.pip'), PIP_PLACEMENTS.map((p) => ({ value: p, label: t.tx(`settings.pip.${p}`), checked: s.pipCorner === p })), { describedBy: 'set-pip-hint' })}
      <p class="ba-small" id="set-pip-hint">${t.t('settings.pip.hint')}</p>
    </div>
    ${switchRow({ id: 'set-skeleton', name: 'skeleton', label: t.t('settings.skeleton'), checked: s.skeleton })}`;

  const langOptions: { value: string; label: string; checked: boolean; hint?: string | undefined }[] = [
    { value: 'auto', label: t.t('settings.lang.auto'), checked: s.lang === 'auto' },
    ...LANG_INFO.map((l) => ({ value: l.code, label: l.name, checked: s.lang === l.code, hint: l.status === 'draft' ? t.t('settings.lang.draft') : undefined })),
  ];
  const display = html`
    <div class="ba-row-setting ba-row-setting--stack">
      <fieldset class="ba-fieldset"><legend class="ba-legend">${t.t('settings.lang')}</legend>
        <ul class="ba-radiolist">${langOptions.map((l) => html`<li><label class="ba-radio"><input type="radio" name="lang" value="${l.value}" data-key="lang-${l.value}"${attr('checked', l.checked)}><span><b${attr('lang', l.value === 'auto' ? false : l.value)}>${l.label}</b>${l.hint ? html`<small>${l.hint}</small>` : ''}</span></label></li>`)}</ul>
      </fieldset>
    </div>
    <div class="ba-row-setting ba-row-setting--stack">
      ${segmented('theme', t.t('settings.theme'), [
        { value: 'system', label: t.t('settings.theme.system'), checked: s.theme === 'system' },
        { value: 'light', label: t.t('settings.theme.light'), checked: s.theme === 'light' },
        { value: 'dark', label: t.t('settings.theme.dark'), checked: s.theme === 'dark' },
      ])}
    </div>
    ${switchRow({ id: 'set-motion', name: 'motion', label: t.t('settings.motion'), hint: t.t('settings.motion.hint'), checked: o.reducedMotion })}
    ${switchRow({ id: 'set-bigtext', name: 'bigText', label: t.t('settings.bigText'), hint: t.t('settings.bigText.hint'), checked: s.bigText })}
    ${switchRow({ id: 'set-sound', name: 'sound', label: t.t('settings.sound'), checked: s.sound })}`;

  const body = html`
    <div class="ba-row-setting ba-row-setting--stack">
      <div class="ba-field"><label for="set-weight">${t.t('settings.weight')}</label>
        <div class="ba-inputunit"><input class="ba-input" id="set-weight" name="weightKg" data-key="weightKg" type="number" inputmode="decimal" min="25" max="300" step="0.1" autocomplete="off" aria-describedby="set-weight-hint"${attr('value', s.weightKg ?? false)}><span aria-hidden="true">${t.t('settings.weight.unit')}</span></div>
        <p class="ba-small" id="set-weight-hint">${t.t('settings.weight.hint')}</p>
      </div>
    </div>`;

  const pro = html`<div class="ba-row-setting ba-row-setting--stack">
    ${hasPro(ctx)
      ? html`<p class="ba-callout">${icon('check')}<span>${t.t('paywall.active')}</span></p>`
      : html`<p>${t.t('settings.pro.free')}</p><div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}" data-action="open-pro">${t.t('settings.pro.see')}</a></div>`}
  </div>`;

  const data = html`<div class="ba-row-setting ba-row-setting--stack">
    <p>${t.t('settings.data.body')}</p>
    <div class="ba-actions"><button type="button" class="ba-btn ba-btn--secondary" data-action="clear-data">${icon('trash')}<span>${t.t('settings.data.clear')}</span></button></div>
  </div>`;

  const about = html`<div class="ba-row-setting ba-row-setting--stack">
    <div class="ba-actions"><a class="ba-btn ba-btn--secondary" href="${ctx.href('welcome')}">${t.t('settings.tour')}</a></div>
    <p class="ba-small">${t.t('settings.version', { v: ctx.version })}</p>
  </div>`;

  const main = html`
    <header class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('settings.title')}</h1></header>
    <form class="ba-settings" data-form="settings" novalidate>
      ${section('s-play', t.t('settings.section.play'), play)}
      ${section('s-display', t.t('settings.section.display'), display)}
      ${section('s-body', t.t('settings.section.body'), body)}
      ${section('s-pro', t.t('settings.section.pro'), pro)}
      ${section('s-data', t.t('settings.section.data'), data)}
      ${section('s-about', t.t('settings.section.about'), about)}
    </form>`;
  return chrome(ctx, { tab: 'settings', main, mainClass: 'ba-page--settings' });
}
