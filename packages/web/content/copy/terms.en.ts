// The terms of use, in English. Prices, limits and ages come from facts.ts (content.test.ts compares them with the code); the games
// and their counts come from the catalogue (copy/games.ts). Written to be read: short sentences, what happens and what we ask.
import { mail, note, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, titlesOf } from './games.ts';

export function termsEn(): PageSpec {
  const date = F.longDate(F.UPDATED, 'en');
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const free = titlesOf((g) => g.free, 'en');
  const pro = titlesOf((g) => !g.free, 'en');
  const $ = (n: number): string => F.usd(n, 'en');
  const memberships = F.FAMILY_PLAN ? 'a Pro monthly, Pro yearly or Family yearly' : 'a Pro monthly or Pro yearly';
  return {
    file: 'terms.html',
    url: '/terms',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/terms' },
    title: 'Terms of use',
    description: 'The terms for playing BodyArcade: exercise safety, playing with others, the free plan, Pro prices, the free trial, cancelling, refunds and license keys.',
    h1: 'Terms of use',
    when: `Last updated ${date}`,
    lead: `These terms cover your use of BodyArcade, its online features and its paid plans. By playing, you agree to them. If you do not agree, please do not use BodyArcade. How your data is handled is explained in the <a href="/privacy">privacy policy</a>.`,
    brief: {
      title: 'In short',
      items: [
        `<strong>Free to play.</strong> ${c.free} of ${c.total} games are free, with their seated and quiet versions, and there are no ads. In Road Run, ${W.free} of its ${W.total} worlds are free. You can play each Pro game once for free.`,
        '<strong>Exercise at your own pace.</strong> Clear some space, warm up, and stop if something hurts. Read the safety notice below.',
        '<strong>Be kind and play fair.</strong> We can mute, suspend or ban profiles that harass other players or cheat.',
        `<strong>Pro is paid for through Gumroad on the web and Google Play in the Android app.</strong> They take the payment and handle tax. A plan bought on the web can be refunded within ${F.REFUND_DAYS} days.`,
        `<strong>Earlier buyers keep what they paid.</strong> ${$(F.PRICE.legacyMonthly)} monthly members stay at ${$(F.PRICE.legacyMonthly)}, and ${$(F.PRICE.founder)} Lifetime buyers are Founders.`,
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Terms of use', url: '/terms' }],
    sections: [
      {
        id: 'who',
        title: 'Who we are',
        html: `<p>BodyArcade (bodyarcade.com and the BodyArcade Android app) is made by ${F.OWNER}, an individual who trades as ${F.STUDIO} in ${F.COUNTRY}. In these terms &ldquo;we&rdquo; means him. You can reach us at ${mail()}.</p>`,
      },
      {
        id: 'what',
        title: 'What BodyArcade is',
        html: `<p>BodyArcade is a set of ${c.total} short games that you play with your body. A camera, your webcam or the front camera of your phone, reads your moves on your device. You can play in your browser or in the Android app. Keyboard or touch controls are there for games that allow them, if you cannot do the movements or have no camera.</p>
<p><strong>The free plan</strong> has ${c.free} games (${free}), their seated and quiet versions, the Easy and Normal difficulties, and no ads. Road Run has ${W.total} worlds, and ${W.free} of them are free. You can play each Pro game (${pro}) once for free.</p>
<p><strong>Pro</strong> adds the Pro games, the other ${W.total - W.free} Road Run worlds, the Hard and Expert difficulties and the games we add later, with the plans below. The games we add later are included while ${memberships} membership is active, and on the Lifetime plan.</p>
<p>We keep BodyArcade running and improve it, so we may add, change or remove games and features. If we remove something that is a main part of a plan you paid for, we will try to replace it with something of similar value. Your rights as a consumer under the law are not affected. Online features need a network connection and depend on services of other companies (Cloudflare, Gumroad, Google), so we cannot promise that they are always available.</p>`,
      },
      {
        id: 'safety',
        title: 'Play safely',
        html: `<p>The games ask you to squat, jump, twist, reach, bend and punch. You play at your own risk and at your own pace.</p>
${ul([
  'Clear about 2 metres around you, and play on a floor that is not slippery.',
  'Check with a doctor first if you are pregnant, have a heart or joint condition, have not exercised for a while, or feel pain when you move.',
  'Stop if you feel dizzy, short of breath or a sharp pain.',
  'Children play with an adult nearby.',
  `Every game has a seated version and ${c.quiet} of ${c.total} can be played quietly, without jumping or stamping. Use them when standing or jumping is a problem.`,
])}
${note('Not medical advice', 'BodyArcade does not measure your heart rate and gives no medical advice. Calorie figures are estimates from the weight you enter and how long you moved. Camera tracking can miss or misread a move, especially in poor light.')}`,
      },
      {
        id: 'age',
        title: 'Who may use BodyArcade',
        html: `<p>Anyone can play on their own device. The online features (friends, rooms, public lobbies and weekly boards) are for people aged ${F.AGE.online} and older. Under ${F.AGE.online} there is no online profile at all: the games work on the device, and the app sends nothing about the player to the friends service. From ${F.AGE.online} to 17 the profile is limited to a generated name and preset messages, with no video and no typed text. If you are under 18, please use BodyArcade with the knowledge of a parent or guardian, and ask them before you buy anything.</p>
<p>The app asks your age group once, before you make an online profile. Please give the true one: it decides what you may share and with whom, and it protects younger players. Saying you are older than you are, to get features meant for adults, breaks these terms.</p>`,
      },
      {
        id: 'online',
        title: 'Playing with others',
        html: `<p>An online profile is optional and has no password. Before the app makes one it asks you to tick a box that says you agree to these terms and to the community rules below, and it keeps the version of the terms you agreed to with the profile. Keep your recovery code safe: with your friend code it brings your profile back, and anyone who has both can take the profile over.</p>
${ul([
  `<strong>Names.</strong> Players aged ${F.AGE.video} and older choose a display name of up to ${F.NAME_MAX_CHARS} characters. Players aged ${F.AGE.online} to 17 get a generated name. A name must not pretend to be someone else, carry personal details or be rude.`,
  '<strong>Friend codes and links.</strong> Share them only with people you want to hear from. A friend request needs the other person to accept it.',
  `<strong>Rooms.</strong> A room holds ${F.SEATS.min} to ${F.SEATS.max} players. The host picks the game, and in a private room the host can remove a player.`,
  `<strong>Public lobbies.</strong> You meet players of your own age group. They see your display name and a skeleton in your colour, and can send preset messages and reactions. Nobody you do not know receives typed text or video from you.`,
  `<strong>Typed chat</strong> exists only in private rooms where every player is ${F.AGE.video} or older. <strong>Video</strong> between friends is optional, off by default, and works only in such a room when both friends switch it on.`,
  'Do not record, capture or share another person&rsquo;s video or messages without their agreement.',
  'When you race a recording or a practice partner (a bot), the app says so. We do not show a bot as a person, and we do not invent players for lobbies or boards.',
])}`,
      },
      {
        id: 'conduct',
        title: 'Community rules: conduct, fair play and the boards',
        html: `<p>Please do not:</p>
${ul([
  'harass, threaten, bully or discriminate against anyone, or post sexual, hateful or violent content;',
  'put personal details, your own or another person&rsquo;s, into a name or a message, or try to get around the chat filter;',
  'send spam, advertising or links;',
  `use BodyArcade to seek contact with players under ${F.AGE.video}. The app does not let an adult send a friend request to a player under ${F.AGE.video}, and adults must not look for ways around that;`,
  'use scripts, modified apps or other tools to fake your moves or your scores, trade or boost scores, or use a bug to your advantage (please report bugs to us instead);',
  'report people in bad faith.',
])}
<p>The weekly boards list real players only and carry no prizes. The server checks that a score is possible for the time a round took, but it cannot replay your game, so a score is not proof. We can remove a score or hide a profile from a board.</p>`,
      },
      {
        id: 'enforce',
        title: 'Reports, mutes, suspensions and bans',
        html: `<p>You can report or block any player you meet. Every report goes into a queue that we read ourselves, and reports about serious reasons come first. Automatic steps protect other players until we have looked: when ${F.REPORTS_TO_MUTE} different players report the same player within ${F.MUTE_WINDOW_HOURS} hours, that player&rsquo;s typed text is muted for ${F.MUTE_HOURS} hours, and when ${F.REPORTS_TO_SUSPEND} different players report them within ${F.SUSPEND_WINDOW_DAYS} days, or ${F.URGENT_REPORTERS_TO_SUSPEND} do for a serious reason within a day, public lobbies are closed to them for ${F.SUSPEND_DAYS} days.</p>
<p>We may warn, mute, suspend or ban a profile, or remove a name or a score, when these rules are broken, and at once in serious cases. A ban ends the online features; local play and a paid plan stay. If you think we got it wrong, write to ${mail()} and we will look again.</p>`,
      },
      {
        id: 'plans',
        title: 'Plans and prices',
        html: `${table(null, ['Plan', 'Price on the web', 'What you get'], [
  ['Free', 'No charge', `${c.free} games, their seated and quiet versions, the Easy and Normal difficulties, no ads, ${W.free} of the ${W.total} Road Run worlds; each Pro game once.`],
  ['Pro monthly', `<span class="nw">${$(F.PRICE.proMonthly)} a month</span>`, `All ${c.total} games, all ${W.total} Road Run worlds, the games we add later and every difficulty. Renews every month until you cancel. Up to ${F.DEVICES.pro} devices.`],
  ['Pro yearly', `<span class="nw">${$(F.PRICE.proYearly)} a year</span>`, `The same as Pro monthly, with a ${F.TRIAL_DAYS}-day free trial. Renews every year until you cancel.`],
  ...(F.FAMILY_PLAN ? [['Family yearly', `<span class="nw">${$(F.PRICE.familyYearly)} a year</span>`, `The same as Pro, with up to ${F.FAMILY_PROFILES} profiles on each of up to ${F.DEVICES.family} devices, so everyone at home keeps their own results.`]] : []),
  ['Lifetime', `<span class="nw">${$(F.PRICE.lifetime)} once</span>`, `Pro with no renewals, for as long as BodyArcade is offered, with the games we add later. Up to ${F.DEVICES.pro} devices.`],
])}
<p><strong>What Lifetime means.</strong> You pay once and Pro has no renewals for as long as BodyArcade is offered. It is not a promise to offer BodyArcade for ever. If we ever close it, Lifetime and the other plans end with it, we will tell you ahead of time where we can, and we will stop any renewal payments. Your rights as a consumer under the law are not affected.</p>
<p><strong>Earlier plans.</strong> If you bought Pro monthly at ${$(F.PRICE.legacyMonthly)} a month before the plans above went on sale, you keep Pro at ${$(F.PRICE.legacyMonthly)} a month for as long as that membership runs without a break. If you bought Lifetime for ${$(F.PRICE.founder)} before then, you are a Founder: Pro for as long as BodyArcade is offered, every game added later, ${F.FAMILY_PROFILES} profiles and up to ${F.DEVICES.founder} devices.</p>
<p><strong>The Android app.</strong> Prices, currencies and the free trial there are set by Google Play and can differ by country. The prices above are the list prices on the web, in US dollars. Taxes are included or added at checkout as the seller requires.</p>
<p>We may change the prices of plans for new buyers. We will not raise the price of a membership that is running without the notice and consent that Gumroad or Google Play require.</p>`,
      },
      {
        id: 'paying',
        title: 'Paying, renewing and cancelling',
        html: `<p><strong>On the web</strong>, Gumroad sells Pro. You pay on Gumroad&rsquo;s page, and Gumroad is the seller of record: it collects any VAT or sales tax, and its own terms also apply to your purchase. After you pay, Gumroad e-mails you a license key. Paste it into the Pro screen of the app to turn Pro on.</p>
<p><strong>In the Android app</strong>, Google Play sells Pro and its terms apply.</p>
<p><strong>Memberships</strong> (Pro monthly, Pro yearly and Family yearly) renew until you cancel. On the web, cancel in your Gumroad library (choose BodyArcade, then Manage membership); the receipt e-mail has the same link. In the Android app, cancel in Google Play subscriptions. Cancelling stops future payments, and Pro stays on until the end of the period you already paid for. If a renewal payment fails, Pro ends when Gumroad or Google Play ends the membership.</p>
<p><strong>The free trial</strong> of Pro yearly lasts ${F.TRIAL_DAYS} days. Nothing is charged during the trial. If you do not cancel before it ends, the first year is charged and the plan renews every year. A trial is given once per person and subscription, and the store decides who is eligible. We remind you ${F.REMINDER_DAYS} days before the trial ends: the app shows a notice on every open, and on the web we send one e-mail if you leave an address (see the privacy policy). Google Play sends its own reminder too.</p>`,
      },
      {
        id: 'refunds',
        title: 'Refunds',
        html: `<p>Refunds follow the rules of the store that sold the plan.</p>
<p>On the web, every plan can be refunded within ${F.REFUND_DAYS} days of buying it. Gumroad makes the refund, and the refund period is also shown on the product&rsquo;s Gumroad page and on your receipt. To ask for a refund, use the link in your receipt, or write to ${mail()} and we will ask Gumroad to refund it. A refunded purchase ends Pro on your devices at the next check, which the app makes about once a day while you use it.</p>
<p>In the Android app, Google Play&rsquo;s refund rules apply and Google decides. Write to us if you need help.</p>
<p>Nothing in these terms takes away a right to a refund or to cancel that the law of your country gives you as a consumer.</p>`,
      },
      {
        id: 'license',
        title: 'License keys and devices',
        html: `<p>A license key is for you and the people you live with. Please keep it private and do not post or sell it. One purchase works on up to ${F.DEVICES.pro} devices at the same time${F.FAMILY_PLAN ? `, ${F.DEVICES.family} with Family` : ''} and ${F.DEVICES.founder} for Founders. A device you do not use for ${F.SEAT_IDLE_DAYS} days gives its place back by itself. If you need a place back sooner, for example after losing a phone, write to ${mail()}.</p>
<p>The app asks our license service about once a day whether the plan is still active, and keeps Pro on between checks. If the service cannot be reached, Pro keeps working until the last license runs out, which is at most ${F.LICENCE_DAYS} days. After that, Pro pauses on that device and comes back at the next successful check. A missed check never ends a plan.</p>`,
      },
      {
        id: 'use',
        title: 'Acceptable use',
        html: `<p>Please do not:</p>
${ul([
  'get around the license check or the device limit, or share license keys publicly;',
  'copy, resell or republish the games, the artwork or the code, except where the law allows it;',
  'attack, overload or probe the service, or make profiles, rooms or requests in bulk with scripts;',
  'use BodyArcade for anything that breaks the law.',
])}`,
      },
      {
        id: 'ip',
        title: 'Ownership and credits',
        html: `<p>BodyArcade, its games, artwork, texts and code belong to ${F.OWNER}, who trades as ${F.STUDIO}. You get a personal, non-transferable right to use them under these terms. What is yours stays yours: your name and your results.</p>
<p>BodyArcade is built with open-source software: Google&rsquo;s MediaPipe, with its pose model, under the Apache License 2.0; three.js and qrcode-generator under the MIT License. Their licenses apply to them.</p>`,
      },
      {
        id: 'warranty',
        title: 'No warranty',
        html: `<p>We work to keep BodyArcade fun and running, but it is provided as it is and as available, without warranties of any kind that the law lets us exclude. Camera tracking can miss or misread moves, and BodyArcade may not run on every device or browser. We do not promise that it will be free of errors, always available or right for your particular purpose.</p>`,
      },
      {
        id: 'liability',
        title: 'Limitation of liability',
        html: `<p>As far as the law allows, we are not liable for indirect or consequential losses, or for injury or damage that happens while you play, such as a fall or a knock against furniture. Our total liability to you is limited to the amount you paid for plans in the 12 months before the claim. Nothing in these terms limits any liability that cannot be limited by law, such as liability for injury caused by our negligence or for fraud, or takes away your rights as a consumer.</p>`,
      },
      {
        id: 'ending',
        title: 'Ending your use',
        html: `<p>You can stop using BodyArcade at any time and delete your online profile in the app. We may suspend or end your access to the online features if you break these terms. If we ever close BodyArcade, we will tell you ahead of time where we can, as the plans section says. Your rights as a consumer under the law are not affected.</p>`,
      },
      {
        id: 'law',
        title: 'Governing law',
        html: `<p>These terms are governed by the laws of Türkiye. This does not take away the protection that the mandatory consumer law of the country where you live gives you, and where that law lets you bring a claim before the courts or consumer bodies of your own country, you may do so.</p>`,
      },
      {
        id: 'changes',
        title: 'Changes to these terms',
        html: `<p>We may update these terms when BodyArcade or its plans change. The date at the top shows the current version, and we say on this page what changed in substance. If you keep playing after a change, the updated terms apply to you.</p>`,
      },
      {
        id: 'contact',
        title: 'Contact',
        html: `<p>Questions about these terms: ${mail()}. How BodyArcade handles your data is in the <a href="/privacy">privacy policy</a>, and answers to common questions are in the <a href="/faq">FAQ</a>.</p>`,
      },
    ],
  };
}
