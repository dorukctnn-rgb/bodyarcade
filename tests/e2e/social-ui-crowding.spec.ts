// The crowding check of the friends screens (crowding() in social-ui-support.ts) is test equipment too: it has to see what it was made
// for (words over words, a picture over a control, a paragraph in a sliver, each found first by opening a screenshot) and leave an
// ordinary page alone. Plain pages made on the spot; no server.
import { chromium, expect, test, type Browser } from '@playwright/test';
import { baseLaunchOptions } from './support/browser.ts';
import { scan } from '../../packages/web/e2e/support/axe.ts';
import { axeScan, crowding } from './social-ui-support.ts';

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

  // an icon with no size fills its box: a star as big as the window; the QR code, the figures of the players and a drawing that has a width and a height of its own are pictures
  const big = await found('<div style="display:flex;width:300px"><svg viewBox="0 0 24 24" style="flex:1"><path d="M12 0l4 12-4 12-4-12z"/></svg><h2 style="margin:0">Title</h2></div>');
  expect(big.join('\n')).toMatch(/is a picture of \d+ by \d+ where an icon should be/);
  expect(await found('<span class="ba-qr" style="display:block;width:200px"><svg viewBox="0 0 24 24" style="width:200px;height:200px"><path d="M0 0h24v24z"/></svg></span><span class="ba-avatar" style="display:block;width:120px"><svg viewBox="0 0 24 24" style="width:120px;height:120px"><path d="M0 0h24v24z"/></svg></span><svg viewBox="0 0 24 24" style="width:24px;height:24px"><path d="M0 0h24v24z"/></svg><svg viewBox="0 0 100 100" width="120" height="120"><path d="M0 0h100v100z"/></svg>')).toEqual([]);

  // iPhone Safari zooms the page into a field whose text is under 16px (and does not zoom out again)
  const small = await found('<input type="text" aria-label="Friend code" style="font-size:14px;width:200px"><select aria-label="Region" style="font-size:12px"><option>Europe</option></select>');
  expect(small.join('\n')).toMatch(/has text of 14px[\s\S]*has text of 12px/);
  expect(await found('<input type="text" aria-label="Friend code" style="font-size:17px;width:200px"><input type="radio" style="font-size:10px">')).toEqual([]);
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

  // a window taller than the screen: its words scroll under the buttons at its foot, which stay there (sticky) as a page's action bar
  // does; the same words under buttons that are not the window's foot are found
  const tall = (foot: string): Promise<string[]> => found(`<dialog open style="position:fixed;top:0;left:0;margin:0;width:300px;max-height:240px;overflow:auto;padding:0"><div class="k-sheet"><ul style="margin:0">${Array.from({ length: 12 }, (_, i) => `<li>Line ${i + 1} of the rules of the room</li>`).join('')}</ul><div class="${foot}" style="position:sticky;bottom:0;background:#fff"><button type="button" style="width:100%;height:48px">Continue</button></div></div></dialog>`);
  expect(await tall('btns')).toEqual([]);
  expect((await tall('foot')).join('\n')).toMatch(/text and control overlap: li "Line \d+ of the rules of the[^"]*" over button "Continue"/);
});

test('axe and the window\'s own bar: a target partly under the sticky buttons of a tall window is judged with the window at its end; any other button over it is found', async () => {
  const window = async (foot: string): Promise<{ plain: string[]; ruled: string[] }> => {
    const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
    try {
      const options = Array.from({ length: 8 }, (_, i) => `<label style="display:flex;align-items:center;gap:8px;height:44px"><input type="radio" name="why" value="v${i}" style="width:24px;height:24px;margin:0">Reason ${i + 1}</label>`).join('');
      await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Report</title><style>body{margin:0;font:16px/1.4 sans-serif}</style><main><h1>Friends</h1></main><dialog aria-label="Report" style="position:fixed;top:0;left:0;margin:0;width:400px;max-height:240px;overflow:auto;padding:0"><div class="k-sheet"><p style="margin:0;height:38px">Why do you report this player?</p>${options}<div class="${foot}" style="position:sticky;bottom:0;background:#fff"><button type="button" style="width:100%;height:48px">Send report</button></div></div></dialog>`);
      await page.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).showModal());
      return { plain: await scan(page), ruled: await axeScan(page) };
    } finally {
      await page.close();
    }
  };
  const own = await window('btns');
  expect(own.plain.join('\n')).toMatch(/^target-size /m);
  expect(own.ruled.join('\n')).not.toMatch(/^target-size /m);
  const other = await window('foot');
  expect(other.ruled.join('\n')).toMatch(/^target-size /m);
});
