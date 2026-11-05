// The game signal of the page: one small message to our own server at each step a player takes towards a round and towards Pro:
// the play screen opened, the camera and the body tracking run, the round really started (the countdown is over), finished, was
// left before its end (and where) or could not start (and why); the Pro screen was shown, a buy button pressed, the checkout opened
// and said the purchase is paid. The body is the event, the game or plan, and at most one word from a fixed list:
// {"e":"game_start","g":"road-run","x":"first"}. No cookie, no id of the player, no timing, no picture; the server keeps the event,
// the key, the word and the day (packages/server/src/site/ping.ts, which lists every event and word). The privacy policy says the
// same in words. The visit of a page is counted by /assets/pro-source.js (packages/web/content/pro-source.js), the same way.
//
// It is sent with navigator.sendBeacon, which hands the message to the browser and lets the page carry on (or close). A browser
// that automates itself (navigator.webdriver: our own test runs against the live site) or names itself a crawler sends nothing,
// so the numbers are people's.

export type SignalEvent =
  | 'play_open' | 'tracking_ready' | 'game_start' | 'run_finished' | 'play_left' | 'play_error'
  | 'paywall_view' | 'buy_click' | 'checkout_open' | 'checkout_done';

export const SIGNAL_URL = '/api/ping';

/** The events of a round that say whether this device has finished a round before ("first" or "again"). */
export const ROUND_WORD_EVENTS: ReadonlySet<SignalEvent> = new Set<SignalEvent>(['play_open', 'tracking_ready', 'game_start', 'run_finished']);

/** "first" while this device has not finished a round yet, "again" after that. */
export function roundWord(finishedRounds: number): 'first' | 'again' {
  return finishedRounds > 0 ? 'again' : 'first';
}

/** Where a player left the play screen: the server takes only these words (ping.ts LEFT_AT); keyboard means "chose keyboard or touch instead". */
export type LeftAt = 'explainer' | 'loading' | 'calibrating' | 'countdown' | 'running' | 'paused' | 'error' | 'keyboard';

/** An error code as the server takes it (lowercase words joined by underscores, at most 24 letters); anything else is "other". */
export function errorWord(code: string): string {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(code) && code.length <= 24 ? code : 'other';
}

/**
 * Is this round a play for the signal? A round that moves a body is: the camera, or the stand-in body of the practice session of development and test
 * builds (a published build never has one). The keyboard and touch are practice, as they are for the record of the player's results (app.ts finishRound).
 */
export function countsAsPlay(input: string, simulatedBody: boolean): boolean {
  return input === 'camera' || simulatedBody;
}

/** Crawlers that run pages (search engines, link previews, speed tests): what they do is not what people do. */
const ROBOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit/i;

/** The parts of the window this module touches (a test passes its own). */
export interface SignalWindow {
  navigator: Pick<Navigator, 'sendBeacon'> & { webdriver?: boolean; userAgent?: string };
}

/** Sends the signal once. Returns whether the browser took it (false: automated browser or crawler, no sendBeacon, or the browser refused). */
export function sendSignal(win: SignalWindow, event: SignalEvent, key: string, o: { allowAutomated?: boolean; detail?: string } = {}): boolean {
  try {
    const nav = win.navigator;
    if (o.allowAutomated !== true && (nav.webdriver === true || ROBOT.test(nav.userAgent ?? ''))) return false;
    if (typeof nav.sendBeacon !== 'function') return false;
    const body = o.detail ? { e: event, g: key, x: o.detail } : { e: event, g: key };
    return nav.sendBeacon(SIGNAL_URL, new Blob([JSON.stringify(body)], { type: 'application/json' }));
  } catch {
    // a signal is never worth an error on the player's screen
    return false;
  }
}
