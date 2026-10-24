// The paywall in every place it can run, and the notice of a free trial: what is on the page and what is not, and that every
// button on it does something. A plan with no real checkout address is not on the page; where nothing can be bought the page
// says so and keeps the licence key box and the way back; the Android app never says a word about another shop; Family has
// no free trial, whatever a config says; and the reminder is promised only where a trial is on offer.
import { describe, expect, it } from 'vitest';
import { GUMROAD_CHECKOUT } from '../../core/entitlements/catalog.ts';
import { paywallModel, type PaywallMode, type PaywallModel } from '../../core/entitlements/paywall.ts';
import { PLANS, SOLD_PLAN_IDS, playProductOf, type PlayItemDetails } from '../../core/entitlements/plans.ts';
import { textOf } from '../../core/ui/html.ts';
import type { Lang } from '../../core/ui/i18n/index.ts';
import type { PaywallInfo, PlanId } from '../../core/ui/plans.ts';
import { loadCatalogue } from '../catalogue/load.ts';
import { copyProblems } from '../catalogue/copy.ts';
import { trialNotice } from './views/chrome.ts';
import { makeContext } from './make-context.ts';
import { renderPage, EMPTY_STATE } from './pages.ts';
import { router } from './routes.ts';
import { defaultPaywallState, paywallPage, trialBlock, type PaywallState } from './views/paywall.ts';
import type { TrialNotice, TrialView } from '../../core/entitlements/trial.ts';

const games = loadCatalogue({ fixtures: 'only', requiredLangs: ['en', 'tr'] }).catalogue.games;
const LANGS: Lang[] = ['en', 'tr'];

const REAL = {
  'pro-monthly': 'https://bodyarcade.gumroad.com/l/pro-monthly',
  'pro-yearly': 'https://bodyarcade.gumroad.com/l/pro-yearly',
  'family-yearly': 'https://bodyarcade.gumroad.com/l/family-yearly',
  lifetime: 'https://bodyarcade.gumroad.com/l/lifetime',
} as const;

const DETAILS: PlayItemDetails[] = SOLD_PLAN_IDS.map((id) => ({
  itemId: playProductOf(id),
  price: { currency: 'EUR', value: String(PLANS[id].price) },
  ...(id === 'pro-yearly' ? { freeTrialPeriod: 'P7D' } : {}),
}));

const infoOf = (m: PaywallModel, preview = false): PaywallInfo => ({ mode: m.mode, note: m.note, keyEntry: m.keyEntry, manageUrl: m.manageUrl, preview });

function page(lang: Lang, m: PaywallModel, o: { preview?: boolean; selected?: PlanId; plan?: 'free' | 'pro'; state?: Partial<PaywallState> } = {}): string {
  const url = lang === 'en' ? '/pro/' : `/${lang}/pro/`;
  const ctx = makeContext({ lang, games, url, plans: m.plans, paywall: infoOf(m, o.preview), ...(o.plan ? { plan: o.plan } : {}) });
  return paywallPage(ctx, { ...defaultPaywallState(ctx), ...(o.selected ? { selected: o.selected } : {}), ...o.state }).value;
}

const web = (checkout: Partial<Record<keyof typeof REAL, string>> = REAL, more: { trialEligible?: boolean; family?: boolean } = {}): PaywallModel =>
  paywallModel('web', { checkout, family: more.family ?? true, ...(more.trialEligible !== undefined ? { trialEligible: more.trialEligible } : {}) });
const play = (details: readonly PlayItemDetails[] = DETAILS): PaywallModel => paywallModel('play', { details, family: true });

const actions = (html: string): string[] => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1] as string);

describe('where nothing can be bought, no button pretends it can', () => {
  it('the Gumroad products that do not exist yet are not offered: no plan, no buy button, the note, the key box and the way back', () => {
    const m = web(GUMROAD_CHECKOUT);
    expect(m.plans.offers).toEqual([]);
    for (const lang of LANGS) {
      const html = page(lang, m);
      expect(actions(html), lang).not.toContain('buy');
      expect(html, lang).not.toContain('name="plan"');
      expect(html, lang).toContain('data-paywall-note');
      expect(html, lang).toContain('id="pw-key"');
      expect(actions(html), lang).toContain('close-paywall');
    }
    expect(textOf(page('en', m))).toContain('Pro cannot be bought here right now. If you already have a license key, enter it below.');
    expect(textOf(page('tr', m))).toContain('Pro şu an buradan satın alınamıyor. Lisans anahtarın varsa aşağıya gir.');
  });

  it('a plan with no real address is left out and the others stay: nothing shows a price it cannot sell', () => {
    const m = web({ 'pro-monthly': REAL['pro-monthly'], lifetime: REAL.lifetime }, {});
    expect(m.plans.offers.map((o) => o.id)).toEqual(['pro-monthly', 'lifetime']);
    const html = page('en', m);
    expect(html).toContain('value="pro-monthly"');
    expect(html).toContain('value="lifetime"');
    expect(html).not.toContain('value="pro-yearly"');
    expect(html).not.toContain('value="family-yearly"');
  });

  it('a page drawn without a visitor (the generator) has no plans and no button to press', () => {
    const ctx = makeContext({ lang: 'en', games, url: '/pro/', server: true });
    const r = renderPage(ctx, router.match('/pro/'), EMPTY_STATE);
    const html = r.body.value;
    expect(actions(html)).not.toContain('buy');
    expect(html).not.toContain('name="plan"');
    expect(textOf(html)).toContain('Checking what you can buy here.');
    expect(html).not.toContain('id="pw-key"');
  });

  it('the Android app that cannot sell says so and offers no shop; a page still checking says that', () => {
    const unsupported = paywallModel('play-unsupported');
    expect(textOf(page('en', unsupported))).toContain('Buying needs a newer version of Chrome');
    expect(textOf(page('tr', unsupported))).toContain('daha yeni bir Chrome sürümü');
    expect(actions(page('en', unsupported))).not.toContain('buy');
    const checking = paywallModel('neutral');
    expect(textOf(page('en', checking))).toContain('Checking what you can buy here.');
    expect(page('en', checking)).not.toContain('id="pw-key"');
  });

  it('Google Play with no answer about its products offers nothing and says so', () => {
    const m = play([]);
    expect(m.plans.offers).toEqual([]);
    expect(actions(page('en', m))).not.toContain('buy');
    expect(page('en', m)).toContain('data-paywall-note');
  });
});

describe('every button that is on the page is one the page can answer', () => {
  const states: [string, PaywallModel][] = [
    ['web, nothing to sell', web(GUMROAD_CHECKOUT)],
    ['web, all four plans', web()],
    ['web, a trial already used', web(REAL, { trialEligible: false })],
    ['play with products', play()],
    ['play without products', play([])],
    ['play, cannot sell', paywallModel('play-unsupported')],
    ['checking', paywallModel('neutral')],
  ];
  for (const lang of LANGS) {
    for (const [name, m] of states) {
      it(`${lang}: ${name}`, () => {
        const html = page(lang, m);
        const list = actions(html);
        for (const a of list) expect(['buy', 'close-paywall', 'activate-key', 'restore'], `${name}: ${a}`).toContain(a);
        // buy only with something to buy; restore only inside Google Play; the key box only where the model gives it
        expect(list.includes('buy'), 'buy').toBe(m.plans.offers.length > 0);
        expect(list.includes('restore'), 'restore').toBe(m.mode === 'play');
        expect(html.includes('id="pw-key"'), 'key box').toBe(m.keyEntry.visible);
        // the way back is always there
        expect(list).toContain('close-paywall');
        // radios exist exactly when there are plans, one of them checked
        expect((html.match(/name="plan"/g) ?? []).length, 'plans').toBe(m.plans.offers.length);
        if (m.plans.offers.length > 0) expect((html.match(/name="plan"[^>]*checked/g) ?? []).length, 'checked').toBe(1);
        const text = textOf(html);
        expect(text).not.toMatch(/undefined|\[object|NaN|\{[a-z]+\}/);
        expect(copyProblems(text.replace(/\s{2,}/g, ' ')), text).toEqual([]);
      });
    }
  }
});

describe('Google Play policy: nothing in the app names another way to pay', () => {
  for (const lang of LANGS) {
    for (const mode of ['play', 'play-unsupported', 'neutral'] as PaywallMode[]) {
      it(`${lang}: ${mode} has no word about Gumroad, a shop or a web address of checkout`, () => {
        const m = mode === 'play' ? play() : paywallModel(mode);
        const html = page(lang, m);
        expect(html, mode).not.toMatch(/gumroad|checkout\.invalid|gumroad\.com/i);
        expect(textOf(html), mode).not.toMatch(/gumroad/i);
      });
    }
  }

  it('the prices on the Play page are Google\'s, in its currency, and there is a way to manage the plan', () => {
    const html = page('en', play());
    expect(textOf(html)).toContain('€39.99');
    expect(html).toContain('play.google.com/store/account/subscriptions');
    expect(actions(html)).toContain('restore');
  });
});

describe('the free trial is promised where there is one', () => {
  /** Words of a trial, a reminder or a day count: none of them may stand near a plan that has no trial. */
  const TRIALISH = /d+ days? free|Try d+ days?|remind|d+ gün ücretsiz|d+ gün dene|hatırlat/i;
  /** What sits under the plans: the button of the chosen plan and the note about the trial, the cancelling and the reminder. */
  const bar = (m: PaywallModel, id: PlanId, lang: Lang = 'en'): string => textOf(page(lang, m, { selected: id }).split('<div class="k-actionbar">')[1] ?? '');
  /** The row of one plan in the list. */
  const row = (m: PaywallModel, id: PlanId, lang: Lang = 'en'): string => {
    const html = page(lang, m);
    const at = html.indexOf(`value="${id}"`);
    const from = html.lastIndexOf('<label class="k-plan">', at);
    return textOf(html.slice(from, html.indexOf('</label>', at)));
  };

  it('Pro yearly has the trial and says so, with the reminder; every other plan says nothing about one', () => {
    const m = web();
    expect(row(m, 'pro-yearly')).toContain('7 days free, then $39.99 a year');
    expect(bar(m, 'pro-yearly')).toContain('Try 7 days free');
    expect(bar(m, 'pro-yearly')).toContain('7 days free, then $39.99 a year');
    expect(bar(m, 'pro-yearly')).toContain('We remind you two days before the trial ends: in the app, and by e-mail if you leave an address.');
    for (const id of ['pro-monthly', 'family-yearly', 'lifetime'] as PlanId[]) {
      expect(bar(m, id), id).not.toMatch(TRIALISH);
      expect(bar(m, id), id).not.toContain('remind you two days');
      expect(row(m, id), id).not.toMatch(/free|trial/i);
    }
  });

  it('Family has no trial, even when a config hands it one', () => {
    const m = web();
    const withTrial = { ...m, plans: { ...m.plans, offers: m.plans.offers.map((o) => (o.id === 'family-yearly' ? { ...o, trialDays: 7 } : o)) } };
    for (const lang of LANGS) {
      expect(bar(withTrial, 'family-yearly', lang), lang).not.toMatch(TRIALISH);
      expect(row(withTrial, 'family-yearly', lang), lang).not.toMatch(TRIALISH);
      expect(row(withTrial, 'family-yearly', lang), lang).toContain('6');
    }
  });

  it('a player who used a trial already is offered none and promised no reminder', () => {
    const m = web(REAL, { trialEligible: false });
    expect(bar(m, 'pro-yearly')).not.toMatch(/7 days free|Try 7 days|remind you/);
    expect(bar(m, 'pro-yearly')).toContain('Choose this plan');
    expect(row(m, 'pro-yearly')).not.toMatch(/free/i);
  });

  it('in Google Play the reminder says Google sends its own too, and nothing about e-mail', () => {
    const text = bar(play(), 'pro-yearly');
    expect(text).toContain('Google Play sends its own reminder too');
    expect(text).not.toMatch(/e-mail/);
    expect(bar(play(), 'pro-yearly', 'tr')).toContain('Google Play da kendi hatırlatmasını gönderir');
  });

  it('a preview build says that nothing can be bought in it', () => {
    const html = page('en', web(), { preview: true });
    expect(html).toContain('data-paywall-preview');
    expect(textOf(html)).toContain('Preview build: the checkout link is not set yet, so nothing can be bought here.');
    expect(page('en', web())).not.toContain('data-paywall-preview');
  });
});

describe('the notice in the last two days of a trial', () => {
  const notice = (o: Partial<TrialNotice> = {}): TrialNotice => ({ endsAt: Date.UTC(2026, 9, 26, 12), msLeft: 30 * 3_600_000, dayOffset: 1, where: 'web', cancelled: false, ...o });
  const draw = (lang: Lang, n: TrialNotice | null): string => {
    const ctx = makeContext({ lang, games, url: lang === 'en' ? '/' : `/${lang}/`, trial: n });
    return trialNotice(ctx).value;
  };

  it('says on which day the trial ends and where to cancel, in English and Turkish', () => {
    expect(textOf(draw('en', notice({ dayOffset: 0 })))).toContain('Your free trial ends today.');
    expect(textOf(draw('en', notice({ dayOffset: 1 })))).toContain('Your free trial ends tomorrow.');
    expect(textOf(draw('en', notice({ dayOffset: 2 })))).toContain('Your free trial ends the day after tomorrow.');
    expect(textOf(draw('en', notice()))).toContain('cancel in your Gumroad library');
    expect(textOf(draw('en', notice({ where: 'play' })))).toContain('cancel in Google Play subscriptions');
    expect(textOf(draw('tr', notice({ dayOffset: 1 })))).toContain('Ücretsiz denemen yarın bitiyor.');
    expect(textOf(draw('tr', notice({ where: 'play' })))).toContain('Google Play aboneliklerinden iptal et');
  });

  it('a membership cancelled already says nothing will be charged, and does not tell the player to cancel', () => {
    const text = textOf(draw('en', notice({ cancelled: true })));
    expect(text).toContain('You already cancelled, so nothing will be charged.');
    expect(text).not.toContain('To stop it');
    expect(textOf(draw('tr', notice({ cancelled: true })))).toContain('ücret alınmayacak');
  });

  it('is one landmark with a name, a way to the page of the plan and a way to close it; there is none outside the last two days', () => {
    const html = draw('en', notice());
    expect(html).toContain('<aside');
    expect(html).toMatch(/aria-label="Free trial"/);
    expect(html).toContain('href="/pro/"');
    expect(html).toContain('data-action="trial-dismiss"');
    expect(draw('en', null)).toBe('');
  });

  it('shows in the frame of the pages and not on the stage of a round', () => {
    const ctx = makeContext({ lang: 'en', games, url: '/', trial: notice() });
    expect(renderPage(ctx, router.match('/'), EMPTY_STATE).body.value).toContain('data-trial-notice');
    const play = renderPage(makeContext({ lang: 'en', games, url: '/play/squat-flap/', trial: notice() }), router.match('/play/squat-flap/'), EMPTY_STATE);
    expect(play.body.value).not.toContain('data-trial-notice');
  });
});

describe('the free trial of an active membership, and the one reminder e-mail', () => {
  const view = (o: Partial<TrialView> = {}): TrialView => ({ trialEnds: Date.UTC(2026, 9, 27, 12), notice: null, email: 'offer', masked: null, sendAt: null, ...o });
  const block = (lang: Lang, v: TrialView | null, st: Partial<PaywallState> = {}): string => {
    const ctx = makeContext({ lang, games, url: lang === 'en' ? '/pro/' : `/${lang}/pro/`, plan: 'pro' });
    return trialBlock(ctx, { trial: v, emailBusy: false, emailNote: null, ...st }).value;
  };

  it('offers the box for an address, with a label, an explanation and a button that does something', () => {
    const html = block('en', view());
    expect(html).toContain('data-trial-email="offer"');
    expect(html).toContain('for="tr-email"');
    expect(html).toContain('type="email"');
    expect(html).toContain('data-action="trial-email"');
    expect(textOf(html)).toContain('We delete the address as soon as it is sent.');
    expect(textOf(block('tr', view()))).toContain('Adresi gönderir göndermez sileriz.');
  });

  it('when an address was left it shows only a masked form and a way to take it back', () => {
    const html = block('en', view({ email: 'set', masked: 'a***@example.com', sendAt: Date.UTC(2026, 9, 25, 12) }));
    expect(html).toContain('data-trial-email="set"');
    expect(textOf(html)).toContain('a***@example.com');
    expect(html).toContain('data-action="trial-clear"');
    expect(html).not.toContain('id="tr-email"');
  });

  it('shows no box where none is offered (Google Play, a cancelled membership, a server without mail) and nothing without a trial', () => {
    expect(block('en', view({ email: 'none' }))).not.toContain('data-trial-email');
    expect(block('en', view({ email: 'none' }))).toContain('data-trial');
    expect(block('en', view({ trialEnds: null, email: 'none' }))).toBe('');
    expect(block('en', null)).toBe('');
  });

  it('tells the player what happened, in words, never a code', () => {
    for (const lang of LANGS) {
      for (const code of ['bad_email', 'not_offered', 'no_trial', 'unavailable', 'rate_limited', 'network', 'something_new']) {
        const text = textOf(block(lang, view(), { emailNote: { kind: 'error', code } }));
        expect(text, `${lang} ${code}`).not.toMatch(/bad_email|not_offered|no_trial|rate_limited|trial\.email|something_new/);
        expect(text.length).toBeGreaterThan(40);
      }
      expect(textOf(block(lang, view(), { emailNote: { kind: 'saved' } }))).toMatch(lang === 'en' ? /reminder is set/ : /Hatırlatma ayarlandı/);
    }
  });

  it('the active page shows the block, and the manage link only inside Google Play', () => {
    const m = play();
    const ctx = makeContext({ lang: 'en', games, url: '/pro/', plan: 'pro', paywall: infoOf(m) });
    const html = paywallPage(ctx, { ...defaultPaywallState(ctx), trial: view() }).value;
    expect(html).toContain('data-trial');
    expect(html).toContain('href="https://play.google.com/store/account/subscriptions?package=com.peakapps.bodyarcade"');
    const onWeb = paywallPage(makeContext({ lang: 'en', games, url: '/pro/', plan: 'pro', paywall: infoOf(web()) }), { ...defaultPaywallState(ctx), trial: view() }).value;
    expect(onWeb).not.toContain('play.google.com');
  });
});
