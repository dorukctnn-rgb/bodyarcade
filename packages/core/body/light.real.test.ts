// "Too dark" and "the light is behind you" on real pictures: the 16 x 12 brightness maps of the desk picture
// (tests/e2e/fixtures/desk-640x480.mjpeg), the same picture made very dark and the same picture made into a silhouette against
// the bright wall (desk-dark and desk-backlit), measured with ffmpeg (area average, the same as the worker's), with the landmarks
// the real model gave for the desk picture (tests/traces/video/army-desk-near-6s.trace.json; the model sees the same head and
// shoulders in the other two). The first version of the person check took the face region as wide as the shoulders, which at a
// desk takes in the bright wall beside the head: this silhouette went undetected until it was seen on the real camera path.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LightGrid } from '../types/index.ts';
import { parseTrace, traceFrames } from '../pose/trace.ts';
import { lightProblem } from './light.ts';

const frames = traceFrames(parseTrace(JSON.parse(readFileSync(new URL('../../../tests/traces/video/army-desk-near-6s.trace.json', import.meta.url), 'utf8'))));
const person = frames[30]!.landmarks!;
const aspect = 640 / 480;
const grid = (luma: number[]): LightGrid => ({ cols: 16, rows: 12, luma });

const DESK = [
  1, 0.99, 0.99, 1, 0.99, 0.99, 0.89, 0.58, 0.73, 0.97, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  1, 0.99, 0.99, 0.99, 0.99, 0.99, 0.56, 0.63, 0.66, 0.78, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  1, 1, 1, 0.99, 0.99, 0.98, 0.55, 0.5, 0.52, 0.69, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  1, 0.99, 0.99, 0.99, 0.99, 0.98, 0.6, 0.57, 0.6, 0.7, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  1, 1, 0.99, 0.99, 0.99, 0.99, 0.77, 0.52, 0.56, 0.85, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  1, 1, 1, 1, 0.99, 0.97, 0.65, 0.51, 0.55, 0.73, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
  1, 1, 1, 0.99, 0.69, 0.24, 0.12, 0.27, 0.26, 0.11, 0.3, 0.75, 0.99, 0.99, 0.99, 0.99,
  1, 1, 0.99, 0.4, 0.1, 0.1, 0.09, 0.07, 0.08, 0.09, 0.1, 0.11, 0.55, 0.99, 0.99, 0.99,
  1, 1, 0.71, 0.09, 0.09, 0.09, 0.11, 0.1, 0.12, 0.14, 0.15, 0.09, 0.15, 0.84, 0.99, 0.99,
  1, 1, 0.49, 0.06, 0.07, 0.33, 0.39, 0.61, 0.42, 0.59, 0.44, 0.07, 0.11, 0.45, 0.99, 0.99,
  1, 1, 0.22, 0.05, 0.07, 0.21, 0.22, 0.24, 0.15, 0.16, 0.18, 0.08, 0.09, 0.12, 0.9, 0.99,
  1, 0.98, 0.37, 0.05, 0.06, 0.07, 0.06, 0.06, 0.06, 0.06, 0.1, 0.07, 0.08, 0.31, 0.87, 0.99,
];
const DARK = [
  0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.01, 0.01, 0.01, 0.01, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.01, 0.01, 0.01, 0.01, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.01, 0.01, 0.01, 0.01, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.01, 0.01, 0.01, 0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.01, 0.01, 0.01, 0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.03, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.03, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.03, 0.03, 0.03,
  0.03, 0.03, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.03, 0.03,
  0.04, 0.04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.04,
  0.04, 0.04, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0.03, 0.04,
];
const BACKLIT = [
  0.97, 0.96, 0.96, 0.97, 0.96, 0.96, 0.82, 0.34, 0.46, 0.91, 0.95, 0.96, 0.96, 0.95, 0.95, 0.95,
  0.97, 0.96, 0.95, 0.95, 0.95, 0.95, 0.25, 0.12, 0.15, 0.46, 0.96, 0.96, 0.95, 0.95, 0.95, 0.95,
  0.97, 0.96, 0.96, 0.95, 0.96, 0.91, 0.09, 0.05, 0.06, 0.27, 0.95, 0.96, 0.95, 0.95, 0.95, 0.95,
  0.97, 0.96, 0.95, 0.95, 0.96, 0.92, 0.11, 0.09, 0.11, 0.27, 0.96, 0.96, 0.96, 0.96, 0.95, 0.95,
  0.97, 0.96, 0.96, 0.96, 0.95, 0.96, 0.45, 0.06, 0.08, 0.61, 0.96, 0.96, 0.96, 0.96, 0.96, 0.96,
  0.97, 0.97, 0.97, 0.96, 0.95, 0.93, 0.37, 0.05, 0.06, 0.51, 0.95, 0.96, 0.96, 0.96, 0.96, 0.96,
  0.97, 0.97, 0.96, 0.95, 0.6, 0.14, 0.01, 0.02, 0.03, 0.01, 0.18, 0.67, 0.95, 0.96, 0.96, 0.96,
  0.97, 0.97, 0.96, 0.28, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.43, 0.96, 0.96, 0.96,
  0.97, 0.97, 0.65, 0.01, 0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.03, 0.01, 0.02, 0.78, 0.96, 0.96,
  0.97, 0.97, 0.42, 0.01, 0.01, 0.1, 0.12, 0.22, 0.14, 0.22, 0.15, 0.01, 0.01, 0.36, 0.96, 0.96,
  0.97, 0.96, 0.14, 0, 0.01, 0.05, 0.06, 0.06, 0.03, 0.04, 0.04, 0.01, 0.01, 0.03, 0.83, 0.95,
  0.97, 0.94, 0.25, 0, 0, 0.01, 0, 0, 0, 0, 0.01, 0.01, 0.01, 0.2, 0.8, 0.95,
];

describe('the light check on real pictures of a person at a desk', () => {
  it('the real model found the person in these pictures: the nose is in the middle, the shoulders wide', () => {
    expect(person[0]!.x).toBeGreaterThan(0.4);
    expect(person[0]!.x).toBeLessThan(0.6);
    expect(person[0]!.visibility).toBeGreaterThan(0.9);
    expect(Math.abs(person[11]!.x - person[12]!.x)).toBeGreaterThan(0.35);
  });

  it('a person in front of a bright wall, the face lit: no problem, with the person and with nobody found', () => {
    expect(lightProblem(grid(DESK), person, aspect)).toBeNull();
    expect(lightProblem(grid(DESK), null, aspect)).toBeNull();
  });

  it('the same picture very dark: too dark', () => {
    expect(lightProblem(grid(DARK), person, aspect)).toBe('too_dark');
    expect(lightProblem(grid(DARK), null, aspect)).toBe('too_dark');
  });

  it('the same person as a silhouette against the bright wall: the light is behind them, found or not', () => {
    expect(lightProblem(grid(BACKLIT), person, aspect)).toBe('backlit');
    expect(lightProblem(grid(BACKLIT), null, aspect)).toBe('backlit');
  });
});
