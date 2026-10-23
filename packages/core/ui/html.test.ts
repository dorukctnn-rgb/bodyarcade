import { describe, expect, it } from 'vitest';
import { cx, escapeHtml, html, jsonForScript, raw, textOf } from './html.ts';

describe('html templating', () => {
  it('escapes every interpolated string', () => {
    const evil = `<img src=x onerror="alert(1)"> & 'quote'`;
    const out = html`<p title="${evil}">${evil}</p>`.toString();
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quote&#39;');
  });

  it('passes nested templates and raw markup through once', () => {
    const inner = html`<b>${'a & b'}</b>`;
    expect(html`<i>${inner}</i>`.toString()).toBe('<i><b>a &amp; b</b></i>');
    expect(html`${raw('<svg></svg>')}`.toString()).toBe('<svg></svg>');
  });

  it('renders arrays, numbers, and drops null, undefined, false and true', () => {
    expect(html`${[html`<a>1</a>`, html`<a>2</a>`]}`.toString()).toBe('<a>1</a><a>2</a>');
    expect(html`${0}|${null}|${undefined}|${false}|${true}|${12.5}`.toString()).toBe('0|||||12.5');
    const cond = false as boolean;
    expect(html`<p>${cond && html`<b>x</b>`}</p>`.toString()).toBe('<p></p>');
  });

  it('cx joins truthy class names only', () => {
    const off = false as boolean;
    expect(cx('a', off && 'b', '', null, 'c')).toBe('a c');
  });

  it('jsonForScript cannot close the script tag', () => {
    const s = jsonForScript({ t: '</script><script>alert(1)</script>', u: ' ' });
    expect(s).not.toContain('</script>');
    expect(JSON.parse(s)).toEqual({ t: '</script><script>alert(1)</script>', u: ' ' });
  });

  it('textOf strips markup and decodes entities', () => {
    expect(textOf(html`<h1>Squat &amp; jump</h1><script>x()</script><p>a   b</p>`)).toBe('Squat & jump a b');
  });

  it('escapeHtml handles non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});
