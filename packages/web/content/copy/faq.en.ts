// The FAQ, in English. Each answer says only what the code and the plans do (numbers from facts.ts, games from the catalogue).
// The same questions and answers feed the FAQPage structured data, so what a search engine reads is what a person reads.
import { cta, faqLd, mail, qa, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, titlesOf } from './games.ts';

interface Item { q: string; a: string }
interface Group { id: string; title: string; items: Item[] }

export function faqEn(): PageSpec {
  const c = gameCounts();
  const W = F.ROAD_RUN_WORLDS;
  const proTitles = titlesOf((g) => !g.free, 'en');
  const liveTitles = titlesOf((g) => g.live, 'en');
  const $ = (n: number): string => F.usd(n, 'en');
  const memberships = F.FAMILY_PLAN ? 'a Pro monthly, Pro yearly or Family yearly' : 'a Pro monthly or Pro yearly';
  const app = F.ANDROID_APP_LIVE
    ? '<p>There is an Android app on Google Play. It plays the same games and takes payments through Google Play. On an iPhone, use BodyArcade in Safari.</p>'
    : '<p>BodyArcade runs in the browser of every device, so there is nothing to install. An Android app on Google Play follows the web release. The paid plans are meant to work in both.</p>';

  const groups: Group[] = [
    {
      id: 'start',
      title: 'Getting started',
      items: [
        {
          q: 'What do I need to play?',
          a: '<p>A phone, tablet, laptop or desktop with a camera and a current browser (Chrome, Edge, Firefox or Safari). There is nothing to install. The first time, the game downloads its pose model, about 6 MB, and keeps it on your device. If you have no camera, games that allow it can be played with the keyboard or by touch.</p>',
        },
        {
          q: 'Where do I stand?',
          a: '<p>It depends on the game. Whole-body games need your head to your ankles in view: stand 2 to 3 metres from a laptop or 1.5 to 2 metres from an upright phone. Upper-body games need your head to your hips in view, about 1 metre away. A calibration step before each game tells you whether to step back or come closer. Light in front of you or beside you works best; a window behind you hides you from the camera.</p>',
        },
        {
          q: 'Can I play sitting down?',
          a: `<p>Yes. Every game has a seated version. Turn on Seated mode in Settings, or let the app offer desk mode when it only sees your head and shoulders. ${c.quiet} of ${c.total} games also have a quiet mode, without jumping or stamping, which is kind to the neighbours below.</p>`,
        },
        {
          q: 'Does it work on a phone?',
          a: '<p>Yes, in your phone&rsquo;s browser, upright or sideways. Two players on one camera needs a bigger screen and is not offered on phone-sized screens.</p>',
        },
        {
          q: 'Is there an app?',
          a: app,
        },
        {
          q: 'Does it work offline?',
          a: '<p>Games you opened before still work without a connection: the camera and the pose model run on your device. Friends, rooms, boards and license checks need a connection.</p>',
        },
      ],
    },
    {
      id: 'privacy',
      title: 'Camera and privacy',
      items: [
        {
          q: 'Is my camera video uploaded or recorded?',
          a: `<p>No. Your device turns the video into ${F.MODEL_POINTS} body points on the spot, and the video is never uploaded, recorded or saved. The one exception is optional: two friends who are both ${F.AGE.video} or older can show each other their camera in a private room when both switch it on. Nothing is recorded then either. Read the <a href="/privacy">privacy policy</a> for the details.</p>`,
        },
        {
          q: 'Do I need an account?',
          a: '<p>No account, password or e-mail address is needed to play. An online profile is needed only for friends, rooms with other people, public lobbies and weekly boards, and it has no password and no e-mail address either.</p>',
        },
        {
          q: 'What does BodyArcade keep about me?',
          a: '<p>Your settings and results stay on your device. Our servers keep an online profile only if you make one, rooms only while they exist, and license records for Pro, each for the time the <a href="/privacy">privacy policy</a> lists. There are no ads and no advertising trackers.</p>',
        },
        {
          q: 'How do I delete my data?',
          a: `<p>On your device: Settings, then Clear data on this device. For an online profile, the profile screen has Download my data and Delete my profile. The page <a href="/delete-account">Delete your account and data</a> has the steps and says what stays, and what to do if you have lost the device. For anything else, write to ${mail()}.</p>`,
        },
        {
          q: 'Is it safe for children?',
          a: `<p>Families can play. Under ${F.AGE.online}, the games work on the device only: there is no online profile, and the app sends nothing about the child to the friends service. From ${F.AGE.online} to 17, names are generated, messages are preset, friends are added only by code or link, public lobbies are with players of the same age group, and there is never video or typed text. An adult cannot send a friend request to a player under ${F.AGE.video}. Everything is in the <a href="/privacy">privacy policy</a> and the <a href="/terms">terms</a>.</p>`,
        },
      ],
    },
    {
      id: 'together',
      title: 'Playing together',
      items: [
        {
          q: 'How do I play online with a friend?',
          a: `<p>Open Friends and make a profile. The app asks your age group once and gives you a friend code that looks like BA-7K2Q4X. Send your friend code or your invite link; when your friend accepts, you are friends. To play, start a room, pick a game and send the invite link, the ${F.ROOM_CODE_CHARS}-character code or the QR code. A room holds ${F.SEATS.min} to ${F.SEATS.max} players. Everyone gets ready, and the round starts for all of you at once. Live races are in ${liveTitles}.</p>`,
        },
        {
          q: 'Can two of us play on one camera?',
          a: `<p>Yes, on a big screen such as a laptop, a desktop or a TV. ${c.local2} of ${c.total} games support it. Player 1 stands on the left and Player 2 on the right, about 1 metre apart and about 3 metres from the screen, and each of you gets your own score.</p>`,
        },
        {
          q: 'Who can see me or contact me?',
          a: '<p>Friends see your display name and whether you are online. Players in a public lobby see a skeleton in your colour and your display name, and can send you preset messages and reactions, never video or typed text. Nobody can search for you: people find you only through your friend code or invite link, or in a lobby of your age group.</p>',
        },
        {
          q: 'How does video between friends work?',
          a: `<p>It is optional and off by default. It works only in a private room where everyone is ${F.AGE.video} or older, when both friends switch it on. Either of you can turn it off at any time, and the room shows who is sharing. The picture goes from device to device, encrypted, and is not recorded or stored by anyone. If your devices cannot reach each other directly, no picture is shown and the game goes on with your skeleton.</p>`,
        },
        {
          q: 'How do I report or block someone?',
          a: '<p>Open the menu of a player in a room or on your friends list and choose Report or Block. Blocked players cannot be matched with you, invite you or be shown to you. The player is not told who reported them. Every report goes into a queue that we read, and serious ones come first.</p>',
        },
        {
          q: 'What are the weekly boards?',
          a: '<p>Once you have a profile, your best score of each game and week goes to a board of your friends and a board of players in your country and age group. A new week starts every Monday. Boards list real players only and carry no prizes.</p>',
        },
        {
          q: 'What is a ghost race?',
          a: '<p>A race against a recording instead of a live player: your own best run, a friend&rsquo;s run, or a practice partner, which is a bot. The app always says which one it is. Nobody is shown as live when they are not.</p>',
        },
      ],
    },
    {
      id: 'plans',
      title: 'Plans and payments',
      items: [
        {
          q: 'What is free?',
          a: `<p>${c.free} of ${c.total} games, with their seated and quiet versions, the Easy and Normal difficulties, and no ads. Road Run has ${W.total} worlds, and ${W.free} of them are free. You can also play each Pro game once for free.</p>`,
        },
        {
          q: 'What does Pro add?',
          a: `<p>The Pro games (${proTitles}), the other ${W.total - W.free} Road Run worlds, the Hard and Expert difficulties, and the games we add later. The later games are included while ${memberships} membership is active, and on the Lifetime plan. See the <a href="/pro/">Pro page</a> for the plans.</p>`,
        },
        {
          q: 'How much do the plans cost?',
          a: `<p>On the web: Pro monthly ${$(F.PRICE.proMonthly)} a month, Pro yearly ${$(F.PRICE.proYearly)} a year with a ${F.TRIAL_DAYS}-day free trial, ${F.FAMILY_PLAN ? `Family yearly ${$(F.PRICE.familyYearly)} a year, ` : ''}and Lifetime ${$(F.PRICE.lifetime)} once. In the Android app, Google Play sets the price and the currency for your country. The details are in the <a href="/terms">terms</a>.</p>`,
        },
        {
          q: 'What does Lifetime mean?',
          a: '<p>You pay once and Pro has no renewals for as long as BodyArcade is offered. It includes the games we add later. It is not a promise to offer BodyArcade for ever: if we ever close it, we will tell you ahead of time where we can, and your rights as a consumer under the law are not affected.</p>',
        },
        {
          q: 'How does the free trial work?',
          a: `<p>Pro yearly starts with ${F.TRIAL_DAYS} days free. Nothing is charged during the trial. If you do not cancel before it ends, the first year is charged. We remind you ${F.REMINDER_DAYS} days before the end: the app shows a notice on every open, and on the web we send one e-mail if you leave an address. Google Play sends its own reminder too.</p>`,
        },
        {
          q: 'How do I cancel?',
          a: '<p>On the web, open your Gumroad library, choose BodyArcade and select Manage membership; the receipt e-mail has the same link. In the Android app, cancel in Google Play subscriptions. Pro stays on until the end of the period you already paid for.</p>',
        },
        {
          q: 'How do I get a refund?',
          a: `<p>Refunds follow the rules of the store that sold the plan. On the web, every plan can be refunded within ${F.REFUND_DAYS} days of buying it. Gumroad makes the refund; the refund period is also on the product page and your receipt, and you can write to ${mail()} for help. On Google Play, Google&rsquo;s rules apply. A refunded plan ends Pro on your devices at the next check, which the app makes about once a day while you use it.</p>`,
        },
        {
          q: 'How do I turn Pro on with my license key?',
          a: '<p>After you pay on Gumroad, you get an e-mail with a license key. Open the Pro screen, find &ldquo;Already have a license key?&rdquo;, paste the key and press Activate. In the Android app, press Restore purchases if Pro is not on yet.</p>',
        },
        {
          q: 'I lost my license key.',
          a: '<p>Gumroad e-mailed it to you when you paid, and it is also in your Gumroad library. If you cannot find it, write to us from the address you paid with.</p>',
        },
        {
          q: 'On how many devices can I use Pro?',
          a: `<p>One purchase works on up to ${F.DEVICES.pro} devices at the same time${F.FAMILY_PLAN ? `, ${F.DEVICES.family} with Family` : ''} and ${F.DEVICES.founder} for Founders. A device you do not use for ${F.SEAT_IDLE_DAYS} days gives its place back by itself. If you need one back sooner, write to ${mail()}.</p>`,
        },
        {
          q: 'Does Pro work offline?',
          a: `<p>The app asks about once a day whether your plan is still active. If it cannot reach the server, Pro keeps working until the last license runs out, which is at most ${F.LICENCE_DAYS} days. After that it pauses on that device and comes back at the next successful check.</p>`,
        },
        {
          q: 'I bought before the new plans. What changes?',
          a: `<p>Nothing is taken from you. If you pay ${$(F.PRICE.legacyMonthly)} a month, you keep paying ${$(F.PRICE.legacyMonthly)} for as long as that membership runs without a break. If you bought Lifetime for ${$(F.PRICE.founder)}, you are a Founder: Pro for as long as BodyArcade is offered, every game added later, ${F.FAMILY_PROFILES} profiles and up to ${F.DEVICES.founder} devices.</p>`,
        },
        ...(F.FAMILY_PLAN ? [{
          q: 'What is the Family plan?',
          a: `<p>Family yearly is Pro for the whole home: up to ${F.FAMILY_PROFILES} profiles on each of up to ${F.DEVICES.family} devices, so everyone keeps their own results. Only the first profile can have an online profile; a child&rsquo;s profile never gets one.</p>`,
        }] : []),
      ],
    },
    {
      id: 'help',
      title: 'When something does not work',
      items: [
        {
          q: 'The camera does not start.',
          a: '<p>Allow the camera in the address bar of your browser (the lock, the tune icon or &ldquo;aA&rdquo;), then press Try again. If the camera is in use by another app, close that app.</p>',
        },
        {
          q: 'The game cannot see me, or loses me.',
          a: '<p>Step back until your head and your feet show (or your head and hips for upper-body games). Turn so the light is in front of you, not behind. Only one person should be in the picture, unless you play with two. If you are at a desk, choose desk mode.</p>',
        },
        {
          q: 'A move did not count.',
          a: '<p>The results screen lists why each move missed, for example hips not low enough, or a hand out of view, and shows a one-second replay drawn from your skeleton. Each game also has a short guide on its page.</p>',
        },
        {
          q: 'The game is slow or jerky.',
          a: '<p>Close other tabs and apps and try again. If the app says your device is too slow for camera mode, play with the keyboard or touch, or use a faster device.</p>',
        },
        {
          q: 'I cleared my browser data and my profile is gone.',
          a: `<p>Open Friends, choose &ldquo;I already have a profile&rdquo; and enter your friend code and the ${F.RECOVERY_CODE_CHARS}-character recovery code you saved. Your friends, requests and weekly scores come back. We cannot show a recovery code again, because we keep only a hash of it.</p>`,
        },
      ],
    },
    {
      id: 'about',
      title: 'About BodyArcade',
      items: [
        {
          q: 'How are calories worked out?',
          a: '<p>From the weight you enter (it stays on your device), how long you moved and how intense each game is. Without a weight, no calories are shown. It is an estimate, not a measurement, and not medical advice.</p>',
        },
        {
          q: 'Who makes BodyArcade, and how do I reach you?',
          a: `<p>${F.OWNER}, an individual who trades as ${F.STUDIO} in ${F.COUNTRY}, makes BodyArcade. Write to ${mail()}.</p>`,
        },
      ],
    },
  ];

  const all = groups.flatMap((g) => g.items);
  const sections: Section[] = groups.map((g) => ({ id: g.id, title: g.title, html: g.items.map((i) => qa(i.q, i.a)).join('\n') }));
  return {
    file: 'faq.html',
    url: '/faq',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/faq' },
    nav: 'faq',
    title: 'FAQ',
    description: 'Answers about BodyArcade: where to stand, playing seated, friends and rooms, privacy, the free plan, Pro prices, the free trial, cancelling and refunds.',
    h1: 'Questions and answers',
    lead: `Short answers about playing, privacy, friends and plans. If yours is not here, write to ${mail()}.`,
    sections,
    toc: true,
    after: cta('Ready to try it? Pick a game and your camera does the rest.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'FAQ', url: '/faq' }],
    jsonLd: [faqLd(all)],
  };
}
