// The settings page (design/ui-kit/settings.html): grouped rows with an icon, a title and a hint on the left and the
// control on the right. Every control is a real form control with a label; changes apply as they are made.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon, type IconName } from '../../../core/ui/icons.ts';
import { LANG_INFO } from '../../../core/ui/i18n/index.ts';
import { rulesOf } from '../app/profiles-model.ts';
import { hasPro, type ViewContext } from '../context.ts';
import { chrome } from './chrome.ts';
import { segmented } from './forms.ts';

export interface SettingsViewOptions {
  /** The effective reduced-motion state: the setting, or the device when the setting follows it. */
  reducedMotion: boolean;
}

interface RowOptions { icon?: IconName; title: string; hint?: string | undefined; control: SafeHtml | string; wrap?: boolean; labelFor?: string }

function row(o: RowOptions): SafeHtml {
  const text = html`<b>${o.title}</b>${o.hint ? html`<small>${o.hint}</small>` : ''}`;
  return html`<li${o.wrap ? html` class="wrap"` : ''}>${o.icon ? html`<span class="ico">${icon(o.icon)}</span>` : ''}${o.labelFor ? html`<label class="grow" for="${o.labelFor}">${text}</label>` : html`<div class="grow">${text}</div>`}${o.control}</li>`;
}

function toggle(id: string, name: string, on: boolean): SafeHtml {
  return html`<span class="ba-switch"><input type="checkbox" id="${id}" name="${name}" data-key="${name}"${attr('checked', on)}><span aria-hidden="true"></span></span>`;
}

function link(ic: IconName, title: string, hint: string, href: string): SafeHtml {
  return html`<li class="is-link"><a href="${href}"><span class="ico">${icon(ic)}</span><div class="grow"><b>${title}</b>${hint ? html`<small>${hint}</small>` : ''}</div><span class="chev">${icon('chevron')}</span></a></li>`;
}

/** The corner picker: a small screen with the four corners as buttons, and Hidden as a fifth choice under it. */
function pipPicker(ctx: ViewContext): SafeHtml {
  const t = ctx.i18n;
  const s = ctx.settings.pipCorner;
  const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  return html`<div class="k-pipwrap"><div class="k-pip" role="radiogroup" aria-label="${t.t('settings.pip')}"><span class="hud"></span><span class="score"></span>${corners.map((c) => html`<label><input type="radio" name="pipCorner" value="${c}" data-key="pip-${c}" aria-label="${t.tx(`settings.pip.${c}`)}"${attr('checked', s === c)}></label>`)}</div>
    <label class="k-check ba-small"><input type="radio" name="pipCorner" value="hidden" data-key="pip-hidden"${attr('checked', s === 'hidden')}>${t.t('settings.pip.hidden')}</label></div>`;
}

export function settingsPage(ctx: ViewContext, o: SettingsViewOptions): SafeHtml {
  const t = ctx.i18n;
  const s = ctx.settings;
  const free = ctx.games.filter((g) => g.free).length;

  const goals = s.regions.length > 0
    ? `${ctx.i18n.list(s.regions.map((r) => t.tx(`region.${r}`)))}. ${t.tx(`onboarding.level.${s.level}`)}.`
    : t.t('settings.goals.none');

  // Release 1 is English and Turkish. A draft language (its shell words are partly English) is not offered; only the player whose
  // setting already is one (a development build) still sees it, marked as a draft, so the select never shows a value it has no option for.
  const offered = LANG_INFO.filter((l) => l.status !== 'draft' || l.code === s.lang);
  const langSelect = html`<select class="k-select" name="lang" id="set-lang" data-key="lang">
    <option value="auto"${attr('selected', s.lang === 'auto')}>${t.t('settings.lang.auto')}</option>
    ${offered.map((l) => html`<option value="${l.code}" lang="${l.tag}"${attr('selected', s.lang === l.code)}>${l.name}${l.status === 'draft' ? ` (${t.t('settings.lang.draftBadge')})` : ''}</option>`)}
  </select>`;

  // What a round starts with: the camera, or no camera (the keyboard on a laptop, swipes and taps on a phone). Each game's page can still choose.
  const controls = segmented('controls', t.t('settings.controls'), [
    { value: 'camera', label: t.t('setup.input.camera'), checked: s.controls === 'camera' },
    { value: 'keyboard', label: t.t('setup.input.keyboard'), checked: s.controls === 'keyboard' },
  ], { hideLegend: true });

  const theme = segmented('theme', t.t('settings.theme'), [
    { value: 'system', label: t.t('settings.theme.system'), checked: s.theme === 'system' },
    { value: 'light', label: t.t('settings.theme.light'), checked: s.theme === 'light' },
    { value: 'dark', label: t.t('settings.theme.dark'), checked: s.theme === 'dark' },
  ], { hideLegend: true });

  const left = html`<div class="k-stack">
    <section class="k-setgroup" aria-labelledby="s-play"><h2 id="s-play">${t.t('settings.section.play')}</h2><ul class="k-set">
      ${row({ icon: 'chair', title: t.t('settings.seated'), hint: t.t('settings.seated.hint'), control: toggle('set-seated', 'seated', s.seated), labelFor: 'set-seated' })}
      ${row({ icon: 'quiet', title: t.t('settings.quiet'), hint: t.t('settings.quiet.hint'), control: toggle('set-quiet', 'quiet', s.quiet), labelFor: 'set-quiet' })}
      ${row({ icon: 'cameraOff', title: t.t('settings.controls'), hint: t.t('settings.controls.hint'), control: controls, wrap: true })}
      ${row({ icon: 'camera', title: t.t('settings.pip'), hint: t.t('settings.pip.hint'), control: pipPicker(ctx), wrap: true })}
      ${row({ icon: 'user', title: t.t('settings.skeleton'), control: toggle('set-skeleton', 'skeleton', s.skeleton), labelFor: 'set-skeleton' })}
      ${row({ icon: 'replay', title: t.t('settings.clips'), hint: t.t('settings.clips.hint'), control: toggle('set-clips', 'clips', s.clips), labelFor: 'set-clips' })}
    </ul></section>
    <section class="k-setgroup" aria-labelledby="s-you"><h2 id="s-you">${t.t('settings.section.body')}</h2><ul class="k-set">
      ${row({ icon: 'trophy', title: t.t('settings.goals'), hint: goals, control: html`<a class="ba-link" href="${ctx.href('welcome')}">${t.t('settings.change')}</a>` })}
      ${rulesOf(ctx.player).calories ? row({ icon: 'info', title: t.t('settings.weight'), hint: t.t('settings.weight.hint'), wrap: true, labelFor: 'set-weight',
        control: html`<span class="k-weight"><input class="ba-input" id="set-weight" name="weightKg" data-key="weightKg" type="text" inputmode="decimal" autocomplete="off"${attr('value', s.weightKg ?? false)}><span class="ba-small">${t.t('settings.weight.unit')}</span></span>` }) : ''}
      ${ctx.player && (ctx.player.capacity.max > 1 || ctx.player.players > 1)
        ? row({ icon: 'users', title: t.t('settings.profiles'), hint: t.t('settings.profiles.hint', ctx.player.capacity), control: html`<a class="ba-link" href="${ctx.href('profiles', { query: { manage: '1' } })}">${t.t('settings.profiles.manage')}</a>` }) : ''}
    </ul></section>
  </div>`;

  const right = html`<div class="k-stack">
    <section class="k-setgroup" aria-labelledby="s-disp"><h2 id="s-disp">${t.t('settings.section.display')}</h2><ul class="k-set">
      ${row({ icon: 'globe', title: t.t('settings.lang'), control: langSelect, labelFor: 'set-lang' })}
      ${row({ title: t.t('settings.theme'), control: theme, wrap: true })}
      ${row({ title: t.t('settings.motion'), hint: t.t('settings.motion.hint'), control: toggle('set-motion', 'motion', o.reducedMotion), labelFor: 'set-motion' })}
      ${row({ icon: 'tv', title: t.t('settings.bigText'), hint: t.t('settings.bigText.hint'), control: toggle('set-bigtext', 'bigText', s.bigText), labelFor: 'set-bigtext' })}
      ${row({ icon: 'sound', title: t.t('settings.sound'), control: toggle('set-sound', 'sound', s.sound), labelFor: 'set-sound' })}
    </ul></section>
    <section class="k-setgroup" aria-labelledby="s-pro"><h2 id="s-pro">${t.t('settings.section.pro')}</h2><ul class="k-set">
      ${hasPro(ctx)
        ? row({ icon: 'star', title: t.t('paywall.active'), control: '' })
        : row({ icon: 'star', title: t.t('settings.pro.free'), hint: t.t('settings.pro.freeCount', { n: free }), control: html`<a class="ba-btn ba-btn--secondary" href="${ctx.href('pro')}">${t.t('settings.pro.see')}</a>` })}
    </ul></section>
    <section class="k-setgroup" aria-labelledby="s-data"><h2 id="s-data">${t.t('settings.section.data')}</h2><ul class="k-set">
      ${row({ icon: 'lock', title: t.t('settings.section.data'), hint: t.t('settings.data.body'), wrap: true, control: html`<button class="ba-btn ba-btn--quiet k-danger" type="button" data-action="clear-data">${icon('trash')}${t.t('settings.data.clear')}</button>` })}
      ${ctx.flags.social ? link('shield', t.t('settings.safety'), t.t('settings.safety.hint'), ctx.href('safety')) : ''}
      ${link('play', t.t('settings.tour'), t.t('settings.version', { v: ctx.version }), ctx.href('welcome'))}
    </ul></section>
  </div>`;

  const main = html`
    <div class="ba-pagehead"><h1 class="ba-h1" data-main-heading>${t.t('settings.title')}</h1></div>
    <form data-form="settings" novalidate><div class="k-cols k-cols--even">${left}${right}</div></form>`;
  return chrome(ctx, { tab: 'settings', main, mainClass: 'ba-page--settings' });
}
