// Form pieces shared by the game page, the settings page and the paywall: a segmented choice made of real radio buttons
// (arrow keys, labels and groups come from the browser) and a switch row made of a real checkbox.
import { attr, html, type SafeHtml } from '../../../core/ui/html.ts';
import { icon } from '../../../core/ui/icons.ts';

export interface SegOption {
  value: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  /** Shows a lock: the choice exists but is part of Pro. */
  lock?: boolean;
}

export interface SegmentedOptions {
  hideLegend?: boolean;
  describedBy?: string;
  /** Class of the legend (the art director's `k-label` on the game page). */
  legendClass?: string;
  /** Extra class on the fieldset (`k-block` for the spacing of the game page). */
  className?: string;
}

/** A group of radio buttons drawn as a segmented control. `legend` names the group for assistive technology. */
export function segmented(name: string, legend: string, options: readonly SegOption[], o: SegmentedOptions = {}): SafeHtml {
  const legendClass = o.hideLegend ? 'ba-visually-hidden' : (o.legendClass ?? 'ba-legend');
  return html`<fieldset class="ba-fieldset${o.className ? ` ${o.className}` : ''}"${attr('aria-describedby', o.describedBy)}>
    <legend class="${legendClass}">${legend}</legend>
    <div class="ba-seg">${options.map((opt) => html`<label class="ba-seg-opt"><input type="radio" name="${name}" value="${opt.value}" data-key="${name}-${opt.value}"${attr('checked', opt.checked)}${attr('disabled', opt.disabled)}><span>${opt.label}${opt.lock ? icon('lock') : ''}</span></label>`)}</div>
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
  return html`<div class="k-rowset">
    <label class="ba-row-label" for="${o.id}"><span>${o.label}</span>${o.hint ? html`<small id="${hintId}">${o.hint}</small>` : ''}</label>
    <span class="ba-switch"><input type="checkbox" id="${o.id}" name="${o.name}" value="1" data-key="${o.name}"${attr('checked', o.checked)}${attr('disabled', o.disabled)}${attr('aria-describedby', o.hint ? hintId : false)}><span aria-hidden="true"></span></span>
  </div>`;
}
