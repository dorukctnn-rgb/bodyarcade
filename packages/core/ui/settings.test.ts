import { describe, expect, it } from 'vitest';
import type { Namespace, Schema } from '../types/index.ts';
import { local2Available, capabilitiesFrom } from './capabilities.ts';
import { applySettingsToDocument, createSettingsStore, DEFAULT_SETTINGS, sanitizeSettings, SETTINGS_SCHEMA } from './settings.ts';

function memoryNamespace(initial: Record<string, unknown> = {}): Namespace & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get<T>(key: string, s: Schema<T>, fallback: T): T {
      if (!(key in data)) return fallback;
      return s.parse(data[key]) ?? fallback;
    },
    set<T>(key: string, v: T): void { data[key] = JSON.parse(JSON.stringify(v)); },
    remove(key: string): void { delete data[key]; },
  };
}

describe('settings', () => {
  it('turns damaged values into defaults, field by field (B4)', () => {
    const s = sanitizeSettings({ lang: 'xx', theme: 'dark', seated: 'yes', pipCorner: 'middle', weightKg: 5, regions: ['legs', 'nope', 'core'], playedOnce: ['a', 3, 'a'] });
    expect(s.lang).toBe('auto');
    expect(s.theme).toBe('dark');
    expect(s.seated).toBe(false);
    expect(s.pipCorner).toBe('bottom-right');
    expect(s.weightKg).toBeNull();
    expect(s.regions).toEqual(['legs', 'core']);
    expect(s.playedOnce).toEqual(['a']);
  });

  it('a value that is not an object resets the key, nothing else', () => {
    expect(SETTINGS_SCHEMA.parse('oops')).toBeNull();
    expect(SETTINGS_SCHEMA.parse([])).toBeNull();
    const ns = memoryNamespace({ settings: 'oops' });
    expect(createSettingsStore(ns).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('saves changes, tells subscribers what changed, and ignores no-ops', () => {
    const ns = memoryNamespace();
    const store = createSettingsStore(ns);
    const seen: string[][] = [];
    const off = store.subscribe((_s, changed) => seen.push([...changed]));
    store.set({ seated: true, quiet: true });
    store.set({ seated: true });
    expect(seen).toEqual([['seated', 'quiet']]);
    expect((ns.data['settings'] as { seated: boolean }).seated).toBe(true);
    off();
    store.set({ lang: 'tr' });
    expect(seen).toHaveLength(1);
    store.reset();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(ns.data['settings']).toBeUndefined();
  });

  it('applies language, theme, motion, TV text and modes to the document', () => {
    const doc = { documentElement: { lang: '', dataset: {} as DOMStringMap } };
    applySettingsToDocument(doc, { ...DEFAULT_SETTINGS, theme: 'dark', bigText: true, seated: true }, 'tr', 'tr', true);
    expect(doc.documentElement.lang).toBe('tr');
    expect(doc.documentElement.dataset['theme']).toBe('dark');
    expect(doc.documentElement.dataset['motion']).toBe('reduce');
    expect(doc.documentElement.dataset['bigText']).toBe('1');
    expect(doc.documentElement.dataset['seated']).toBe('1');
    applySettingsToDocument(doc, { ...DEFAULT_SETTINGS }, 'en', 'en', false);
    expect(doc.documentElement.dataset['theme']).toBeUndefined();
    expect(doc.documentElement.dataset['motion']).toBe('full');
    expect(doc.documentElement.dataset['bigText']).toBeUndefined();
  });
});

describe('two players, one camera is offered only on big web screens', () => {
  const web = (w: number, h: number) => local2Available({ viewport: { w, h }, platform: 'web' });
  it('laptop, desktop, TV and tablet landscape: yes', () => {
    for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080], [1024, 768]] as const) expect(web(w, h), `${w}x${h}`).toBe(true);
  });
  it('phones in either orientation and tablet portrait: no', () => {
    for (const [w, h] of [[360, 780], [390, 844], [412, 915], [844, 390], [915, 412], [768, 1024]] as const) expect(web(w, h), `${w}x${h}`).toBe(false);
  });
  it('never inside the Android app', () => {
    expect(local2Available({ viewport: { w: 1920, h: 1080 }, platform: 'android-app' })).toBe(false);
    expect(capabilitiesFrom({ viewport: { w: 1440, h: 900 }, platform: 'android-app', touch: true, camera: true, secure: true, tv: false }).local2).toBe(false);
  });
});
