import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSignal } from '../../../server/src/site/ping.ts';
import { ROUND_WORD_EVENTS, SIGNAL_URL, countsAsPlay, errorWord, roundWord, sendSignal, type SignalWindow } from './signal.ts';

interface Sent { url: string; body: string; type: string }

/** A window whose navigator remembers what sendBeacon was given. */
function win(o: { webdriver?: boolean; beacon?: boolean; accepts?: boolean; throws?: boolean; userAgent?: string } = {}): { w: SignalWindow; sent: Sent[] } {
  const sent: Sent[] = [];
  const navigator = {
    ...(o.webdriver !== undefined ? { webdriver: o.webdriver } : {}),
    ...(o.userAgent !== undefined ? { userAgent: o.userAgent } : {}),
    ...(o.beacon === false ? {} : {
      sendBeacon: (url: string, data?: BodyInit | null): boolean => {
        if (o.throws) throw new Error('blocked');
        const blob = data as Blob;
        // a Blob's text is async: the type and the size are what the browser sees; the body is read below through the stored blob
        const item = { url, body: '', type: blob.type };
        sent.push(item);
        pending.push(blob.text().then((t) => { item.body = t; }));
        return o.accepts !== false;
      },
    }),
  } as unknown as SignalWindow['navigator'];
  return { w: { navigator }, sent };
}
const pending: Promise<void>[] = [];
const settle = async (): Promise<void> => { await Promise.all(pending.splice(0)); };

describe('countsAsPlay', () => {
  it('counts a round with the camera, and the stand-in body of a development build, but not the keyboard or touch of a published one', () => {
    expect(countsAsPlay('camera', false)).toBe(true);
    expect(countsAsPlay('keyboard', true)).toBe(true);
    expect(countsAsPlay('keyboard', false)).toBe(false);
    expect(countsAsPlay('touch', false)).toBe(false);
  });

  it('is what the play controller asks before it signals either event', () => {
    const play = readFileSync(new URL('./play.ts', import.meta.url), 'utf8');
    expect(play).toContain('countsAsPlay(this.setup.input, this.o.simulatedBody === true)');
    expect(play).toContain("if (this.countsAsPlay()) this.host.signal?.('run_finished', this.game);");
    expect(play).toContain("if (this.countsAsPlay()) this.host.signal?.('game_start', this.game);");
    expect(play).toContain("if (this.countsAsPlay()) { this.opened = true; this.host.signal?.('play_open', this.game); }");
    expect(play).toContain("if (this.countsAsPlay()) this.host.signal?.('tracking_ready', this.game);");
    expect(play).toContain("if (this.countsAsPlay() && !this.errorsSent.has(word))");
  });
});

describe('sendSignal', () => {
  it('hands one JSON message with the event and the game id, and nothing else, to sendBeacon on our own address', async () => {
    const { w, sent } = win();
    expect(sendSignal(w, 'game_start', 'road-run')).toBe(true);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/ping');
    expect(SIGNAL_URL).toBe('/api/ping');
    expect(sent[0]!.type).toBe('application/json');
    expect(JSON.parse(sent[0]!.body)).toEqual({ e: 'game_start', g: 'road-run' });
    expect(Object.keys(JSON.parse(sent[0]!.body))).toEqual(['e', 'g']);
  });

  it('sends nothing from a browser that says it is automated, unless a test asks for it', async () => {
    const a = win({ webdriver: true });
    expect(sendSignal(a.w, 'run_finished', 'road-run')).toBe(false);
    expect(a.sent).toEqual([]);
    const b = win({ webdriver: true });
    expect(sendSignal(b.w, 'run_finished', 'road-run', { allowAutomated: true })).toBe(true);
    await settle();
    expect(JSON.parse(b.sent[0]!.body)).toEqual({ e: 'run_finished', g: 'road-run' });
    const c = win({ webdriver: false });
    expect(sendSignal(c.w, 'run_finished', 'road-run')).toBe(true);
    await settle();
  });

  it('adds the one word of a step where there is one, and the server takes every step the page sends', async () => {
    const { w, sent } = win();
    expect(sendSignal(w, 'game_start', 'road-run', { detail: 'first' })).toBe(true);
    expect(sendSignal(w, 'play_left', 'star-catch', { detail: 'calibrating' })).toBe(true);
    expect(sendSignal(w, 'play_error', 'squat-flap', { detail: errorWord('denied') })).toBe(true);
    expect(sendSignal(w, 'paywall_view', 'results')).toBe(true);
    expect(sendSignal(w, 'buy_click', 'pro-yearly', { detail: 'paddle' })).toBe(true);
    expect(sendSignal(w, 'checkout_open', 'pro-yearly', { detail: 'paddle' })).toBe(true);
    expect(sendSignal(w, 'checkout_done', 'pro-yearly', { detail: 'paddle' })).toBe(true);
    expect(sendSignal(w, 'play_left', 'squat-flap', { detail: 'keyboard' })).toBe(true);
    await settle();
    const bodies = sent.map((x) => JSON.parse(x.body) as Record<string, string>);
    expect(bodies[0]).toEqual({ e: 'game_start', g: 'road-run', x: 'first' });
    expect(bodies[3]).toEqual({ e: 'paywall_view', g: 'results' });
    for (const b of bodies) expect(parseSignal(b), JSON.stringify(b)).not.toBeNull();
  });

  it('says first until this device has finished a round, and turns an odd error code into "other"', () => {
    expect(roundWord(0)).toBe('first');
    expect(roundWord(1)).toBe('again');
    expect(roundWord(40)).toBe('again');
    expect([...ROUND_WORD_EVENTS].sort()).toEqual(['game_start', 'play_open', 'run_finished', 'tracking_ready']);
    expect(errorWord('not_found')).toBe('not_found');
    expect(errorWord('pose_load')).toBe('pose_load');
    expect(errorWord('NotAllowedError')).toBe('other');
    expect(errorWord('camera failed: x')).toBe('other');
    expect(errorWord('x'.repeat(25))).toBe('other');
  });

  it('sends nothing from a crawler that runs the page', () => {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 HeadlessChrome/141.0', 'Chrome-Lighthouse']) {
      const { w, sent } = win({ userAgent: ua });
      expect(sendSignal(w, 'game_start', 'road-run'), ua).toBe(false);
      expect(sent).toEqual([]);
    }
    expect(sendSignal(win({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }).w, 'game_start', 'road-run')).toBe(true);
  });

  it('is quiet when the browser has no sendBeacon, refuses the message or throws', () => {
    expect(sendSignal(win({ beacon: false }).w, 'game_start', 'road-run')).toBe(false);
    expect(sendSignal(win({ accepts: false }).w, 'game_start', 'road-run')).toBe(false);
    expect(sendSignal(win({ throws: true }).w, 'game_start', 'road-run')).toBe(false);
  });

  it('keeps no cookie, storage or timer and uses no other network call: sendBeacon is its only way out', () => {
    const code = readFileSync(new URL('./signal.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'setTimeout', 'setInterval', 'Date.now']) {
      expect(code.includes(word), word).toBe(false);
    }
    expect(code).toContain('sendBeacon(');
  });
});
