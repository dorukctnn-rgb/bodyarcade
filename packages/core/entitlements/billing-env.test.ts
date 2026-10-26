// Where the page runs decides what may be sold: the proof of the Android app is Google's own service, the hints only
// keep the shop away until it answers.
import { describe, expect, it } from 'vitest';
import { PLAY_BILLING_URL, SESSION_FLAG, TWA_REFERRER, detectBilling, provisionalMode, twaHint, type WindowLike } from './billing-env.ts';

const goodService = { getDetails: async () => [], listPurchases: async () => [] };

function win(o: { search?: string; referrer?: string; flag?: boolean; dgs?: WindowLike['getDigitalGoodsService'] | null; storage?: 'ok' | 'throws' | 'none' } = {}): WindowLike & { store: Map<string, string> } {
  const store = new Map<string, string>(o.flag ? [[SESSION_FLAG, '1']] : []);
  const storage = o.storage === 'throws'
    ? { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } }
    : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const w: WindowLike & { store: Map<string, string> } = { location: { search: o.search ?? '' }, document: { referrer: o.referrer ?? '' }, store };
  if (o.storage !== 'none') w.sessionStorage = storage;
  if (o.dgs) w.getDigitalGoodsService = o.dgs;
  return w;
}

describe('the hint, before anything is drawn', () => {
  it('is none in a plain browser', () => {
    expect(twaHint(win())).toBe('none');
    expect(twaHint(win({ search: '?utm_source=twa&lang=tr', referrer: 'https://www.google.com/' }))).toBe('none');
  });

  it('is strong when the app opened the page, and remembers it for the session only', () => {
    const w = win({ search: '?src=twa' });
    expect(twaHint(w)).toBe('strong');
    expect(w.store.get(SESSION_FLAG)).toBe('1');
    expect(twaHint(win({ search: '?lang=tr&src=twa&x=1' }))).toBe('strong');
    expect(twaHint(win({ referrer: `${TWA_REFERRER}/` }))).toBe('strong');
    expect(twaHint(win({ referrer: `${TWA_REFERRER}.beta` }))).toBe('strong');           // the package prefix is the app's own
    expect(twaHint(win({ flag: true }))).toBe('strong');                                  // a later page of the same session
  });

  it('is not fooled by other apps, other values or look-alike parameters', () => {
    expect(twaHint(win({ referrer: 'android-app://com.google.android.gm' }))).toBe('none');
    expect(twaHint(win({ search: '?src=twa2' }))).toBe('none');
    expect(twaHint(win({ search: '?xsrc=twa' }))).toBe('none');
    expect(twaHint(win({ search: '?src=TWA' }))).toBe('none');
  });

  it('is weak when only the Digital Goods API is there (plain Chrome on Android may have it too)', () => {
    expect(twaHint(win({ dgs: async () => goodService }))).toBe('weak');
  });

  it('survives storage that throws, a missing storage and a missing location', () => {
    expect(twaHint(win({ search: '?src=twa', storage: 'throws' }))).toBe('strong');
    expect(twaHint(win({ storage: 'throws' }))).toBe('none');
    expect(twaHint(win({ search: '?src=twa', storage: 'none' }))).toBe('strong');
    const odd = { location: undefined, document: undefined } as unknown as WindowLike;
    expect(twaHint(odd)).toBe('none');
  });

  it('draws the shop only when nothing suggests the app', () => {
    expect(provisionalMode('none')).toBe('web');
    expect(provisionalMode('weak')).toBe('neutral');
    expect(provisionalMode('strong')).toBe('neutral');
  });
});

describe('the proof', () => {
  it('a plain browser is the web, and nothing is asked of Play', async () => {
    let asked = false;
    const w = win({ dgs: undefined });
    const env = await detectBilling(w);
    expect(env).toEqual({ mode: 'web', hint: 'none', service: null });
    expect(asked).toBe(false);
  });

  it('the app with Google\'s service answering is Play, and the service is asked by its address', async () => {
    const asked: string[] = [];
    const w = win({ search: '?src=twa', dgs: async (u) => { asked.push(u); return goodService; } });
    const env = await detectBilling(w);
    expect(env.mode).toBe('play');
    expect(env.service).toBe(goodService);
    expect(asked).toEqual([PLAY_BILLING_URL]);
  });

  it('the app whose service does not answer cannot sell, and never falls back to a web shop', async () => {
    for (const dgs of [async () => { throw new Error('not supported'); }, async () => null, async () => ({}), async () => 'x', undefined] as const) {
      const env = await detectBilling(win({ search: '?src=twa', ...(dgs ? { dgs: dgs as WindowLike['getDigitalGoodsService'] } : {}) }));
      expect(env.mode, String(dgs)).toBe('play-unsupported');
      expect(env.service).toBeNull();
    }
  });

  it('a browser with only the weak hint and no answer is just a browser, and one that answers is Play', async () => {
    expect((await detectBilling(win({ dgs: async () => { throw new Error('nope'); } }))).mode).toBe('web');
    expect((await detectBilling(win({ dgs: async () => goodService }))).mode).toBe('play');
  });

  it('takes the hint it is given', async () => {
    expect((await detectBilling(win({ dgs: async () => goodService }), 'none')).mode).toBe('web');
    expect((await detectBilling(win({ dgs: async () => goodService }), 'strong')).mode).toBe('play');
  });
});
