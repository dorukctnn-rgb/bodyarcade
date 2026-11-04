// The refund policy, in English. It repeats the refund and cancellation promises of the terms of use (terms.en.ts, sections Paying and
// Refunds) in one place and adds no promise of its own; content.test.ts keeps the days and the wording of the two pages equal.
import { mail, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function refundEn(): PageSpec {
  const date = F.longDate(F.TERMS_UPDATED, 'en');
  return {
    file: 'refund.html',
    url: '/refund',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/refund' },
    title: 'Refund policy',
    description: `BodyArcade Pro refunds: ${F.REFUND_DAYS} days on the web, how to ask, how you are paid back, and how to cancel a membership or the free trial.`,
    h1: 'Refund policy',
    when: `Last updated ${date}`,
    lead: `How refunds and cancellations work for BodyArcade Pro, in one place. It says the same as the <a href="/terms">terms of use</a>.`,
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Refund policy', url: '/refund' }],
    sections: [
      {
        id: 'window',
        title: 'The refund period on the web',
        html: `<p>On the web, every plan can be refunded within ${F.REFUND_DAYS} days of buying it. It is the same promise as in the <a href="/terms#refunds">refunds section</a> of the terms of use.</p>`,
      },
      {
        id: 'ask',
        title: 'How to ask for a refund',
        html: `<p>Use the link in your receipt, or write to ${mail()} from the e-mail address you used for the purchase, and we will ask the reseller to refund it.</p>`,
      },
      {
        id: 'paid',
        title: 'How you are paid back',
        html: `<p>Our order process is conducted by our online resellers Paddle.com and Gumroad. They are the Merchant of Record for all our orders, handle payment, sales tax/VAT and refunds, and their own terms also apply to your purchase.</p>
<p>Refunds are paid back through the reseller you paid. The refund period is also shown on your receipt.</p>`,
      },
      {
        id: 'after',
        title: 'After a refund',
        html: `<p>A refunded purchase ends Pro on your devices at the next check, which the app makes about once a day while you use it.</p>`,
      },
      {
        id: 'cancel',
        title: 'Cancelling a membership',
        html: `<p>Pro monthly, Pro yearly and Family yearly renew until you cancel. Cancelling stops future payments, and Pro stays on until the end of the period you already paid for. To avoid the next payment, cancel before the membership renews.</p>
<p>On the web, cancel with the reseller you paid. On Gumroad, that is your Gumroad library (choose BodyArcade, then Manage membership); the receipt e-mail has the same link. In the Android app, cancel in Google Play subscriptions.</p>`,
      },
      {
        id: 'trial',
        title: 'The free trial',
        html: `<p>The free trial of Pro yearly lasts ${F.TRIAL_DAYS} days. Nothing is charged during the trial. If you do not cancel before it ends, the first year is charged and the plan renews every year.</p>`,
      },
      {
        id: 'android',
        title: 'The Android app',
        html: `<p>In the Android app, Google Play sells Pro. Google Play&rsquo;s refund rules apply and Google decides. Write to us if you need help.</p>`,
      },
      {
        id: 'law',
        title: 'Your rights under the law',
        html: `<p>Nothing on this page takes away a right to a refund or to cancel that the law of your country gives you as a consumer.</p>`,
      },
      {
        id: 'contact',
        title: 'Contact',
        html: `<p>Questions about refunds: ${mail()}. BodyArcade is made by ${F.STUDIO}. How your data is handled is in the <a href="/privacy">privacy policy</a>, and answers to common questions are in the <a href="/faq">FAQ</a>.</p>`,
      },
    ],
  };
}
