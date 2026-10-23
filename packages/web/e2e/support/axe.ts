// axe-core inside the page under test: WCAG 2.2 A and AA plus its best practices, one readable line per problem.
import axe, { type AxeResults } from 'axe-core';
import type { Page } from '@playwright/test';

declare global {
  interface Window { axe: { run(context: Document, options: object): Promise<AxeResults> } }
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Runs axe on the page as it is now. The source is evaluated as an expression, which a strict content security policy does not block. */
export async function scan(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const res = await page.evaluate(async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }), TAGS);
  return res.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.help}: ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ')}${v.nodes.length > 4 ? ` and ${v.nodes.length - 4} more` : ''}`);
}
