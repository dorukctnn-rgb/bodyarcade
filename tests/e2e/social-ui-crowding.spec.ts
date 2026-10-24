// The crowding check of the friends screens (crowding() in social-ui-support.ts) is test equipment too: it has to see what it was made
// for (words over words, a picture over a control, a paragraph in a sliver, each found first by opening a screenshot) and leave an
// ordinary page alone. Plain pages made on the spot; no server.
import { chromium, expect, test, type Browser } from '@playwright/test';
import { baseLaunchOptions } from './support/browser.ts';
import { crowding } from './social-ui-support.ts';

let browser: Browser;
test.beforeAll(async () => { browser = await chromium.launch({ ...baseLaunchOptions, headless: true }); });
test.afterAll(async () => { await browser?.close().catch(() => undefined); });

async function found(body: string, css = ''): Promise<string[]> {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px/1.4 sans-serif}${css}</style>${body}`);
    return await crowding(page);
  } finally {
    await page.close();
  }
}

test('words over words, a picture over a control and a paragraph in a sliver are found', async () => {
  const over = await found('<div style="position:absolute;left:10px;top:10px">Under 16</div><ul style="position:absolute;left:10px;top:12px;margin:0"><li>No online profile and no friend code</li></ul>');
  expect(over.join('\n')).toMatch(/texts overlap/);

  const picture = await found('<button type="button" style="position:absolute;left:10px;top:120px;width:200px;height:48px">Share invite link</button><span class="ba-qr" style="position:absolute;left:150px;top:100px;width:100px;height:100px;background:#000"></span>');
  expect(picture.join('\n')).toMatch(/(control and picture|picture and control) overlap/);

  const hint = await found('<p style="position:absolute;left:10px;top:10px;margin:0;width:200px">Friends add you with this code, your invite link or the QR code.</p><span class="ba-qr" style="position:absolute;left:150px;top:10px;width:100px;height:100px;background:#000"></span>');
  expect(hint.join('\n')).toMatch(/(text and picture|picture and text) overlap/);

  const sliver = await found('<div style="width:64px"><small>Wants to be friends. Added your code.</small></div>');
  expect(sliver.join('\n')).toMatch(/squeezed into a column \d+px wide/);

  const buttons = await found('<button type="button" style="position:absolute;left:10px;top:10px;width:120px;height:44px">One</button><button type="button" style="position:absolute;left:100px;top:20px;width:120px;height:44px">Two</button>');
  expect(buttons.join('\n')).toMatch(/controls overlap/);
});

test('an ordinary page is left alone: wrapped lines, a name that ends in dots, a link in a paragraph, bars fixed to the screen, a window over the page', async () => {
  const page = await found(`
    <main>
      <h1 style="line-height:1;margin:0 0 8px">A title that wraps onto more than one line because it is long enough to</h1>
      <p style="margin:0 0 8px">Plain words that wrap over a few lines in a narrow paragraph, one line after another, the way every page does.</p>
      <ul style="list-style:none;margin:0;padding:0"><li style="display:flex;gap:8px"><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A very long display name that does not fit in the row and ends in dots</b><span>4,820</span></li></ul>
      <p>A <a href="#">link inside</a> a paragraph and <button type="button">a button</button> after it.</p>
    </main>
    <nav class="ba-tabbar" style="position:fixed;left:0;right:0;bottom:0;height:80px;background:#eee"><a href="#">Games</a> <a href="#">Friends</a></nav>
    <div class="ba-invites" style="position:fixed;top:0;left:0;right:0;height:60px"><button type="button">Join</button></div>`);
  expect(page).toEqual([]);

  // a window is open: only the window counts, and the page under it is not looked at
  const window = await found('<p style="margin:0;position:absolute;left:10px;top:10px">Words under the window</p><button type="button" style="position:absolute;left:10px;top:10px">Under</button><dialog open style="position:fixed;top:200px;left:10px;margin:0"><p>The window</p><button type="button">Close</button></dialog>');
  expect(window).toEqual([]);
});
