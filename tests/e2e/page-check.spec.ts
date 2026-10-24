// The layout probe of tools/page-check must see real layout bugs and must not cry wolf on intentional layering.
// Each fixture is a small page with exactly one defect (or none); the expected kinds are exact.
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_PROBE, layoutProbe, type FindingKind, type ProbeOptions } from '../../tools/page-check/probe.ts';

const CSS = '*{box-sizing:border-box}body{margin:0;font:16px/1.4 Arial,Helvetica,sans-serif}button,a.btn{font:inherit;padding:12px 20px;border:1px solid #333;background:#eee;display:inline-block}';
const PIC = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100'><rect width='200' height='100' fill='%23468'/></svg>";

async function probe(page: Page, body: string, o: Partial<ProbeOptions> = {}, size = { width: 390, height: 844 }, head = ''): Promise<{ kinds: FindingKind[]; errors: FindingKind[]; text: string }> {
  await page.setViewportSize(size);
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${CSS}</style>${head}</head><body>${body}</body></html>`);
  const r = await page.evaluate(layoutProbe, { ...DEFAULT_PROBE, ...o });
  return { kinds: r.findings.map((f) => f.kind), errors: r.findings.filter((f) => f.severity === 'error').map((f) => f.kind), text: r.findings.map((f) => `${f.kind}: ${f.message}`).join('\n') };
}

test.describe('page-check probe', () => {
  test('a plain page has no findings', async ({ page }) => {
    const r = await probe(page, '<header><h1>Title</h1></header><main><p>Some text that wraps over a couple of lines so that the probe has several line rectangles to compare with each other. It is only a paragraph.</p><button>Start</button> <a class="btn" href="#x">Other</a><ul><li>One</li><li>Two</li></ul></main>');
    expect(r.text).toBe('');
  });

  test('intentional layering is allowed', async ({ page }) => {
    const r = await probe(page, `
      <div style="position:relative;width:300px;height:200px"><img alt="" src="${PIC}" style="position:absolute;inset:0;width:100%;height:100%"><h2 style="position:absolute;left:10px;top:10px;margin:0">Text over a picture</h2><button style="position:absolute;right:10px;bottom:10px">Over it</button></div>
      <p style="width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A very long single line label</p>
      <div style="width:200px;overflow-x:auto"><div style="width:600px"><button>Wide content in a scroller</button></div></div>
      <div style="position:fixed;left:-300px;top:100px;width:200px">A drawer that is closed</div>
      <div data-qa-layer style="position:absolute;left:20px;top:30px">Marked overlay text</div>
      <div aria-hidden="true" style="position:absolute;left:30px;top:40px;width:200px;height:200px;border-radius:50%;background:rgba(255,0,0,.2);pointer-events:none"></div>
      <p style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:120px">Four lines of text in a box that shows only two of them, on purpose, with an ellipsis</p>`);
    expect(r.text).toBe('');
  });

  test('two texts on top of each other overlap', async ({ page }) => {
    const r = await probe(page, '<p style="position:absolute;left:10px;top:20px;margin:0">First line of words</p><p style="position:absolute;left:30px;top:24px;margin:0">Second line of words</p>');
    expect(r.errors).toEqual(['overlap']);
  });

  test('two controls on top of each other overlap', async ({ page }) => {
    const r = await probe(page, '<button>First</button><button style="margin-left:-30px">Second</button>');
    expect(r.errors).toContain('overlap');
  });

  test('a control wider than its clipping parent is cut off', async ({ page }) => {
    const r = await probe(page, '<div style="width:100px;overflow:hidden"><button style="width:160px">Wide button</button></div>');
    expect(r.errors).toEqual(['clipped']);
  });

  test('text longer than its own clipped box is cut', async ({ page }) => {
    const r = await probe(page, '<p style="width:60px;overflow:hidden;white-space:nowrap">Some long text here</p>');
    expect(r.errors).toEqual(['text-cut']);
  });

  test('a fixed control half outside the screen is reported', async ({ page }) => {
    const r = await probe(page, '<button style="position:fixed;right:-30px;top:20px">Half out</button>');
    expect(r.errors).toEqual(['offscreen']);
  });

  test('a page wider than the screen is reported', async ({ page }) => {
    const r = await probe(page, '<p>Text</p><div style="width:900px;height:10px;background:#c00"></div><button style="width:700px">Wide</button>');
    expect(r.errors).toContain('overflow-x');
  });

  test('a picture on top of text hides it', async ({ page }) => {
    const r = await probe(page, `<p style="margin:0;padding:10px">Hidden text that is long enough</p><img alt="" src="${PIC}" style="position:absolute;top:0;left:0;width:300px;height:50px;z-index:5">`);
    expect(r.errors).toEqual(['covered']);
  });

  test('text spilling out of its pill is reported', async ({ page }) => {
    const r = await probe(page, '<span style="display:inline-block;width:60px;padding:4px;background:#ddd;white-space:nowrap">A long label that spills</span>');
    expect(r.errors).toEqual(['spill']);
  });

  test('on a screen that cannot scroll, a control below the edge is unreachable and a half one is cut', async ({ page }) => {
    const css = '<style>html,body{height:100%;overflow:hidden}</style>';
    const half = await probe(page, '<button style="position:absolute;left:10px;top:820px">Half</button>', {}, { width: 390, height: 844 }, css);
    expect(half.errors).toEqual(['offscreen']);
    const below = await probe(page, '<button style="position:absolute;left:10px;top:900px">Below</button>', {}, { width: 390, height: 844 }, css);
    expect(below.kinds).toEqual(['unreachable']);
    expect(below.errors).toEqual([]);
  });

  test('a fixed bottom bar must not hide the end of the page', async ({ page }) => {
    const bar = '<nav style="position:fixed;left:0;right:0;bottom:0;height:64px;background:#222;color:#fff;padding:20px">Tab bar</nav>';
    // The paragraph ends the page; without padding it ends under the bar.
    const bad = await probe(page, `<p style="margin:0;height:1500px;padding:16px">Top of a long page</p><p style="margin:0;padding:0 16px">The last paragraph of the page</p>${bar}`);
    expect(bad.errors).toContain('covered');
    const good = await probe(page, `<p style="margin:0;height:1500px;padding:16px">Top of a long page</p><p style="margin:0;padding:0 16px 90px">The last paragraph of the page</p>${bar}`);
    expect(good.text).toBe('');
  });

  test('a modal window hides the page under it from the checks', async ({ page }) => {
    const r = await probe(page, '<p style="position:absolute;left:20px;top:100px;margin:0">Page text under the window</p><dialog open style="position:fixed;left:10px;top:60px;width:300px;margin:0"><p style="margin:0">Window text</p><button>Close</button></dialog>');
    expect(r.text).toBe('');
  });

  test('text with a value that was never filled in is reported', async ({ page }) => {
    const r = await probe(page, '<p>Score: undefined</p><p>Best: NaN points</p><button>Hello {name}</button>');
    expect(r.errors).toEqual(['bad-text', 'bad-text', 'bad-text']);
  });

  test('a sentence that starts with a stray comma is reported, a comma after a name is not', async ({ page }) => {
    const bad = await probe(page, '<p>, step into view.</p>');
    expect(bad.errors).toEqual(['bad-text']);
    const good = await probe(page, '<p><b>Player 2</b>, step into view.</p><p>Wait... and then?</p>');
    expect(good.text).toBe('');
  });

  test('tap targets are warnings, and only on touch screens', async ({ page }) => {
    const html = '<button style="padding:0;width:16px;height:16px">x</button>';
    const touch = await probe(page, html, { touch: true });
    expect(touch.kinds).toEqual(['tap-target']);
    expect(touch.errors).toEqual([]);
    const desktop = await probe(page, html, { touch: false });
    expect(desktop.kinds).toEqual([]);
  });
});
