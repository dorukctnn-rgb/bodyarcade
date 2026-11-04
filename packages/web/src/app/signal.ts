// The game signal of the page: one small message to our own server when a round really starts (the camera and the pose model
// are ready and the countdown is over) and one when a round finishes. The body is the event and the game id, nothing else:
// {"e":"game_start"|"run_finished","g":"road-run"}. No cookie, no id of the player, no timing, no picture; the server keeps the
// event, the game and the day (packages/server/src/site/ping.ts). The privacy policy says the same in words.
//
// It is sent with navigator.sendBeacon, which hands the message to the browser and lets the page carry on (or close). A browser
// that automates itself (navigator.webdriver: our own test runs against the live site) sends nothing, so the numbers are people's.

export type SignalEvent = 'game_start' | 'run_finished';

export const SIGNAL_URL = '/api/ping';

/**
 * Is this round a play for the signal? A round that moves a body is: the camera, or the stand-in body of the practice session of development and test
 * builds (a published build never has one). The keyboard and touch are practice, as they are for the record of the player's results (app.ts finishRound).
 */
export function countsAsPlay(input: string, simulatedBody: boolean): boolean {
  return input === 'camera' || simulatedBody;
}

/** The parts of the window this module touches (a test passes its own). */
export interface SignalWindow {
  navigator: Pick<Navigator, 'sendBeacon'> & { webdriver?: boolean };
}

/** Sends the signal once. Returns whether the browser took it (false: automated browser, no sendBeacon, or the browser refused). */
export function sendSignal(win: SignalWindow, event: SignalEvent, game: string, o: { allowAutomated?: boolean } = {}): boolean {
  try {
    const nav = win.navigator;
    if (nav.webdriver === true && o.allowAutomated !== true) return false;
    if (typeof nav.sendBeacon !== 'function') return false;
    return nav.sendBeacon(SIGNAL_URL, new Blob([JSON.stringify({ e: event, g: game })], { type: 'application/json' }));
  } catch {
    // a signal is never worth an error on the player's screen
    return false;
  }
}
