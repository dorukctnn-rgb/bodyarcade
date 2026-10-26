// The self-hosted pose files are the pinned ones: package version, model bytes and hash, every WASM file present.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEDIAPIPE_VERSION, POSE_MODEL, WASM_BASE, WASM_FILES } from './assets.ts';
import { poseAssetFiles } from './vite-plugin.ts';

describe('pose assets', () => {
  it('the code and package.json pin the same tasks-vision version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION);
    const installed = JSON.parse(readFileSync(new URL('../../../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')) as { version: string };
    expect(installed.version).toBe(MEDIAPIPE_VERSION);
  });

  it('the committed model file is the pinned one', () => {
    const file = new URL(`./assets/${POSE_MODEL.file}`, import.meta.url);
    const bytes = readFileSync(file);
    expect(bytes.length).toBe(POSE_MODEL.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(POSE_MODEL.sha256);
  });

  it('every served file exists, under versioned URLs', () => {
    const files = poseAssetFiles();
    expect(files.size).toBe(WASM_FILES.length + 1);
    for (const [url, path] of files) {
      expect(url.startsWith('/vendor/mediapipe/')).toBe(true);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(1000);
    }
    expect([...files.keys()].filter((u) => u.startsWith(WASM_BASE)).length).toBe(WASM_FILES.length);
    expect(WASM_BASE).toContain(MEDIAPIPE_VERSION);
  });
});
