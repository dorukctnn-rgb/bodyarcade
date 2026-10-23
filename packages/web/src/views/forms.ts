// Form pieces shared by the setup window, the settings page and the paywall: a segmented choice made of real radio
// buttons (arrow keys, labels and groups come from the browser) and a switch row made of a real checkbox.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';

export interface SegOption {
  value: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  /** Shows a lock: the choice exists but is part of Pro. */
  lock?: boolean;
  hint?: string;
}

/** A group of radio buttons drawn as a segmented control. `legend` names the group for assistive technology. */
export function segmented(name: string, legend: string, options: readonly SegOption[], o: { hideLegend?: boolean; describedBy?: string } = {}): SafeHtml {
  return html`<fieldset class="ba-fieldset"${attr('aria-describedby', o.describedBy)}>
    <legend class="${o.hideLegend ? 'ba-visually-hidden' : 'ba-legend'}">${legend}</legend>
    <div class="ba-seg" role="presentation">${options.map((opt) => html`<label class="ba-seg-opt"><input type="radio" name="${name}" value="${opt.value}" data-key="${name}-${opt.value}"${attr('checked', opt.checked)}${attr('disabled', opt.disabled)}><span>${opt.lock ? icon('lock') : ''}${opt.label}</span></label>`)}</div>
  </fieldset>`;
}

export interface SwitchRowOptions {
  name: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  id: string;
}

/** A label with a hint and a switch on the right. The hint is tied to the checkbox for screen readers. */
export function switchRow(o: SwitchRowOptions): SafeHtml {
  const hintId = `${o.id}-hint`;
  return html`<div class="ba-row-setting">
    <label class="ba-row-label" for="${o.id}"><span class="ba-row-title">${o.label}</span>${o.hint ? html`<span class="ba-small" id="${hintId}">${o.hint}</span>` : ''}</label>
    <span class="ba-switch"><input type="checkbox" id="${o.id}" name="${o.name}" data-key="${o.name}"${attr('checked', o.checked)}${attr('disabled', o.disabled)}${attr('aria-describedby', o.hint ? hintId : false)}><span aria-hidden="true"></span></span>
  </div>`;
}
