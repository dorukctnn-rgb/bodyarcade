// The QA tools open browsers and run simulations for minutes. On a machine that other people work on, they run at a lower
// priority (the browsers they start inherit it), one browser at a time unless asked otherwise.
import { constants, setPriority } from 'node:os';

export function beNice(): void {
  try { setPriority(constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on at the normal priority */ }
}
