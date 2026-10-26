// A page that crashes under the checker (the engine's page process died: "page.waitForSelector: Page crashed") says something about the engine on this
// machine and nothing about the page it was showing, until it does it twice. One screen of one run on the Safari engine did it (QA run 40210252167,
// the Turkish ten-size check, web:calibrate:squat-flap at 1440 x 900, 6.8 s in; the English run of the same screen, five other runs of it and the
// repeats of that page were clean): the screen is looked at once more in a new context. A second answer that is clean keeps its numbers and gets a
// warning that says the first try crashed (so the report still shows how often it happens); a second crash is an error like any other.

interface Answer { errors: number; warnings: number; messages: string[] }

/** A message of a screen that says the page's process crashed (Playwright: "Page crashed", "Target crashed"). */
export const isCrashMessage = (m: string): boolean => /^could not check the page: .*\b(page|target) crashed\b/i.test(m);

/** The answer is the crash of the page itself. */
export const crashed = (a: Pick<Answer, 'messages'>): boolean => a.messages.some(isCrashMessage);

/** The answer to give for a screen whose first try crashed, from the second try. */
export function afterCrash<T extends Answer>(first: T, second: T): T {
  const was = first.messages.find(isCrashMessage)?.replace(/^could not check the page: /, '') ?? 'the page crashed';
  if (crashed(second)) return { ...second, messages: [...second.messages, `the page crashed on both tries (${was})`] };
  return { ...second, warnings: second.warnings + 1, messages: [...second.messages, `console.warn: the page crashed on the first try (${was}) and was fine on the second: the engine's page process died, the page did not`] };
}
