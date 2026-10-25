import { describe, expect, it } from 'vitest';
import type { Namespace, Schema } from '../types/index.ts';
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

  it('the way to play without the camera is a setting: off to begin with, kept when it is on, and a damaged value is the camera', () => {
    expect(DEFAULT_SETTINGS.controls).toBe('camera');
    expect(sanitizeSettings({ controls: 'keyboard' }).controls).toBe('keyboard');
    for (const bad of ['mouse', 1, null, true, {}]) expect(sanitizeSettings({ controls: bad }).controls).toBe('camera');
    const ns = memoryNamespace();
    const store = createSettingsStore(ns);
    store.set({ controls: 'keyboard' });
    expect(createSettingsStore(ns).get().controls).toBe('keyboard');
    store.reset();
    expect(store.get().controls).toBe('camera');
  });

  it('the clips are on to begin with; a damaged value is the default', () => {
    expect(DEFAULT_SETTINGS.clips).toBe(true);
    expect(sanitizeSettings({ clips: false }).clips).toBe(false);
    for (const bad of ['no', 0, null, {}]) expect(sanitizeSettings({ clips: bad }).clips).toBe(true);
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

