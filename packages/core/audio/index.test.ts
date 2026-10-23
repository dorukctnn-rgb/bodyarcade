// The public surface keeps its names: games import these, and the kit satisfies the contract's AudioApi.
import { describe, expect, it } from 'vitest';
import type { AudioApi } from '../types/index.ts';
import * as kit from './index.ts';

describe('audio public surface', () => {
  it('exports what games and the shell use', () => {
    for (const name of ['createAudio', 'buildMaster', 'createAudioClock', 'createLatencyCalibrator', 'judgeTapMs', 'SFX', 'SFX_NAMES']) {
      expect((kit as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it('an audio kit is an AudioApi (unlock, play, clock)', () => {
    const audio: AudioApi = kit.createAudio({ visibility: null, createContext: () => { throw new Error('none'); }, onError: () => undefined });
    expect(typeof audio.unlock).toBe('function');
    expect(typeof audio.play).toBe('function');
    expect(typeof audio.clock().now()).toBe('number');
    expect(audio.clock().latencyMs).toBe(0);
  });
});
