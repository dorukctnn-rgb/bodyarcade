import { describe, expect, it } from 'vitest';
import { afterCrash, crashed, isCrashMessage } from './crash.ts';

const crash = { errors: 1, warnings: 0, messages: ['could not check the page: page.waitForSelector: Page crashed'] };
const clean = { errors: 0, warnings: 2, messages: ['console.warn: a'] };

describe('page crash on a screen', () => {
  it('knows the words of Playwright for a crashed page', () => {
    expect(isCrashMessage('could not check the page: page.waitForSelector: Page crashed')).toBe(true);
    expect(isCrashMessage('could not check the page: page.goto: Target crashed')).toBe(true);
    expect(isCrashMessage('could not check the page: page.waitForSelector: Timeout 20000ms exceeded')).toBe(false);
    expect(isCrashMessage('console.error: the page crashed the cache')).toBe(false);
    expect(crashed(crash)).toBe(true);
    expect(crashed(clean)).toBe(false);
  });
  it('a clean second try keeps its own numbers and adds one warning that names the first crash', () => {
    const a = afterCrash(crash, clean);
    expect(a.errors).toBe(0);
    expect(a.warnings).toBe(3);
    expect(a.messages).toHaveLength(2);
    expect(a.messages[1]).toMatch(/^console\.warn: the page crashed on the first try \(page\.waitForSelector: Page crashed\) and was fine on the second/);
  });
  it('a second crash stays an error and says it happened twice', () => {
    const a = afterCrash(crash, { ...crash });
    expect(a.errors).toBe(1);
    expect(a.warnings).toBe(0);
    expect(a.messages.at(-1)).toMatch(/crashed on both tries \(page\.waitForSelector: Page crashed\)/);
  });
  it('a second try with a problem of its own keeps it next to the warning', () => {
    const a = afterCrash(crash, { errors: 1, warnings: 0, messages: ['HTTP 500: /x'] });
    expect(a.errors).toBe(1);
    expect(a.warnings).toBe(1);
    expect(a.messages[0]).toBe('HTTP 500: /x');
  });
});
