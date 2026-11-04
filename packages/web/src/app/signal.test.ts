import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIGNAL_URL, countsAsPlay, sendSignal, type SignalWindow } from './signal.ts';

interface Sent { url: string; body: string; type: string }

/** A window whose navigator remembers what sendBeacon was given. */
function win(o: { webdriver?: boolean; beacon?: boolean; accepts?: boolean; throws?: boolean } = {}): { w: SignalWindow; sent: Sent[] } {
  const sent: Sent[] = [];
  const navigator = {
    ...(o.webdriver !== undefined ? { webdriver: o.webdriver } : {}),
    ...(o.beacon === false ? {} : {
      sendBeacon: (url: string, data?: BodyInit | null): boolean => {
        if (o.throws) throw new Error('blocked');
        const blob = data as Blob;
        // a Blob's text is async: the type and the size are what the browser sees; the body is read below through the stored blob
        sent.push({ url, body: '', type: blob.type });
        pending.push(blob.text().then((t) => { sent[sent.length - 1]!.body = t; }));
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
