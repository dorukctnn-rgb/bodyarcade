// The layout check of the screen layout rule (packages/web/tools/layout-check.ts, used by the release checks at the ten sizes and by
// the shell's e2e) judges what is drawn. The links of a closed <details> are not drawn, but the engines keep their boxes (the closed
// part is content-visibility: hidden in Chromium, WebKit and Firefox), right over the text that follows: the terms page's closed
// "On this page" list was read as its "Play safely" link lying on the e-mail address under it (final test rehearsal, 25 Oct, 768 x 1024).
import { expect, test, type Page } from '@playwright/test';
import { checkPage } from '../../packages/web/tools/layout-check.ts';

const page = (o: { open: boolean; pull: string }): string => `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<style>body{margin:0;font:16px/1.5 Arial,Helvetica,sans-serif}main{padding:16px}ol{margin:0;padding-left:24px}a{display:inline-block;padding:12px 0}</style></head>
<body><main><details${o.open ? ' open' : ''}><summary>On this page</summary><ol><li><a href="#who">Who we are</a></li><li><a href="#safe">Play safely</a></li></ol></details>
<p style="margin:${o.pull} 0 0">Write to <a href="mailto:info@example.com">info@example.com</a> or <a href="#faq">read the questions</a>.</p></main></body></html>`;

async function check(p: Page, html: string): Promise<string[]> {
  await p.setViewportSize({ width: 768, height: 1024 });
  await p.setContent(html);
  return checkPage(p);
}

test('the links of a closed details are not on the screen: nothing overlaps them', async ({ page: p }) => {
  expect(await check(p, page({ open: false, pull: '0' }))).toEqual([]);
});

test('an open details is on the screen: a line pulled over its links overlaps them', async ({ page: p }) => {
  const found = await check(p, page({ open: true, pull: '-5em' }));
  expect(found.some((f) => /"(Who we are|Play safely)" overlaps a "(info@example\.com|read the questions)"|"(info@example\.com|read the questions)" overlaps a "(Who we are|Play safely)"/.test(f)), found.join('\n')).toBe(true);
});
