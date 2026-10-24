// The privacy policy, in English. Every number is a fact from facts.ts; content.test.ts compares those with the code.
// Written for the player first: what is kept, where, and for how long. The legal vocabulary (controller, legal bases,
// rights) has its own sections at the end.
import { mail, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function privacyEn(): PageSpec {
  const date = F.longDate(F.UPDATED, 'en');
  const video = F.RELAY_ON
    ? 'If your devices cannot reach each other directly, the encrypted picture can pass through a relay server run by Cloudflare. A relay only forwards the data and keeps no copy.'
    : 'If your devices cannot reach each other directly, no picture is shown and the game goes on with your skeleton.';
  return {
    file: 'privacy.html',
    url: '/privacy',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/privacy' },
    title: 'Privacy policy',
    description: 'What BodyArcade keeps about you, where and for how long: camera video stays on your device, what live play and friends servers hold, payments, e-mail, children and your rights.',
    h1: 'Privacy policy',
    when: `Last updated ${date}`,
    lead: `BodyArcade is made by ${F.COMPANY}. This page says in plain words what the game keeps about you, where it keeps it and for how long. It covers bodyarcade.com and the BodyArcade Android app. Questions and requests: ${mail()}.`,
    brief: {
      title: 'In short',
      items: [
        '<strong>Your camera video stays on your device.</strong> It is turned into body points there, and it is not uploaded, recorded or stored. The one exception is optional: a live picture between two adult friends in a private room who both switch it on.',
        '<strong>You can play without a profile.</strong> A profile is only needed for friends, rooms with other people, lobbies and weekly boards. It has no password and no e-mail address, and players under 13 do not get an online profile at all.',
        `<strong>Live rooms clear themselves.</strong> A room is deleted when nobody has been in it for ${F.ROOM_EMPTY_MINUTES} minutes, and in any case ${F.ROOM_IDLE_HOURS} hours after its last activity, together with its chat and results.`,
        '<strong>No ads and no advertising trackers.</strong> We do not sell data. Payments go through Gumroad on the web and Google Play in the Android app, so we never see card details.',
        '<strong>Your data is yours to take or erase.</strong> The profile screen in the app lets you download everything we hold under your profile and delete your account.',
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Privacy policy', url: '/privacy' }],
    sections: [
      {
        id: 'who',
        title: 'Who is responsible',
        html: `<p>${F.COMPANY} runs BodyArcade and decides what is done with the data described here. In data protection law that makes it the controller: the &ldquo;data controller&rdquo; of the GDPR and the &ldquo;veri sorumlusu&rdquo; of the Turkish Personal Data Protection Law (KVKK, law no. 6698). You can reach us at ${mail()}.</p>`,
      },
      {
        id: 'device',
        title: 'What stays on your device',
        html: `<p>These things are kept in the storage of your browser (or of the Android app) on your device. They are not sent to us unless a later section says so.</p>
${ul([
  'Your settings: language, theme, seated and quiet mode, where your camera view sits, skeleton on or off, sound, large text and reduced motion.',
  'Your body weight, if you enter it. It is used only on your device, to estimate calories.',
  'Your results: recent rounds, totals, best scores, achievements, the daily challenge, your streak and your progress in workout plans.',
  'Ghost runs: your best run of a game, with your skeleton drawn as points if the camera was on. Never the picture.',
  'For Pro: the licence key you activated (web), the signed licence your device received, and a random device number that counts your devices.',
  'For the trial reminder: a masked copy of the e-mail address you typed, such as a***@example.com, not the address itself.',
  'For an online profile: the secret key your device made for it (a key the browser keeps and does not let pages read), the last profile details our server sent back, and the list of players you blocked.',
  'Copies of the game&rsquo;s own files, so it opens without a network. This includes the pose model.',
])}
<p>The Settings screen has a button that clears the settings and results on this device. Clearing the site&rsquo;s data in your browser removes everything listed above.</p>`,
      },
      {
        id: 'camera',
        title: 'Your camera',
        html: `<p>When you allow the camera, your browser hands the video to a pose model that runs on your device. It turns each frame into ${F.MODEL_POINTS} body points (head, shoulders, elbows, wrists, hips, knees, ankles and more). The game reads those points to count squats, jumps, punches and other moves.</p>
<p>The video is not uploaded, not recorded and not stored, by us or by anyone else. The camera runs while a game is open, and you can switch it off at any time from your browser&rsquo;s address bar. Replays and ghost runs are drawn from body points, never from video.</p>
<p>The pose model (Google&rsquo;s MediaPipe Pose Landmarker) and its code are files that BodyArcade serves itself, from bodyarcade.com. Your browser does not contact Google or a code network to load them. The library tries to send Google a short usage report that contains no images; BodyArcade stops that request on your device before it leaves.</p>`,
      },
      {
        id: 'video',
        title: 'Video between friends (optional)',
        html: `<p>In a private room you can choose to show your camera picture to a friend and see theirs. It is off by default, and it works only when all of this is true:</p>
${ul([
  'the room is private: it was made with an invite link, a code or a QR code, not in a public lobby;',
  `both of you are ${F.AGE.video} or older (players under ${F.AGE.video} never share video);`,
  'you each switched on the camera share in the room;',
  'neither of you has blocked the other.',
])}
<p>Either of you can turn it off at any time, and the room shows who is sharing a camera. The picture goes from your device to your friend&rsquo;s device and is encrypted on the way. We do not receive it, record it or store it, and nobody else sees it. ${video}</p>
<p>A direct connection between two devices lets each device see the other&rsquo;s network (IP) address. That is one more reason the video is limited to friends you chose to play with.</p>`,
      },
      {
        id: 'live',
        title: 'Live play: rooms, chat and lobbies',
        html: `<p>A room holds ${F.SEATS.min} to ${F.SEATS.max} players. You open one with an invite link, a six-character code or a QR code, or you join a public lobby. While a room exists, its server holds:</p>
${ul([
  'a random player number (never shown to other players), your display name, your age group, and a seat number that the other players see instead of your player number;',
  'who is ready and who is online, the game and its settings;',
  'the results and scores of the rounds;',
  `the last ${F.CHAT_KEEP_LINES} chat messages, and the reports made in the room.`,
])}
<p>During a round your device tells the other players your score and a skeleton of ${F.SHARED_JOINTS} joints, several times a second: nose, shoulders, elbows, wrists, hips, knees and ankles, with no picture. It travels straight between the devices or through our room server, which passes it on and does not store it.</p>
<p>A room is deleted when nobody has been in it for ${F.ROOM_EMPTY_MINUTES} minutes, and in any case ${F.ROOM_IDLE_HOURS} hours after its last activity. Deleting a room deletes its chat and its results. A report keeps a copy of the chat lines it is about; the table below says for how long.</p>
<p>To keep the game in step, the devices in a room try to connect to each other directly. That lets the other devices see your network (IP) address. Your browser also asks a Cloudflare server (STUN) which address the internet sees for you, so that the devices can find each other. If you do not want this, play without joining a room.</p>
<h3>Chat</h3>
<p>Typed chat exists only in private rooms where every player is ${F.AGE.video} or older. It is filtered (no links, e-mail addresses, phone numbers, @names or rude words), limited to ${F.CHAT_MAX_CHARS} characters and one message every ${F.CHAT_GAP_SECONDS} seconds. Everyone else uses preset messages and reactions.</p>
<h3>Public lobbies</h3>
<p>In a public lobby you meet players of your own age group (13 to 17, or 18 and older). They see a skeleton in your colour and your display name, and they can send you preset messages and drawn reactions. They never see your video and never receive typed text from you.</p>
<h3>Report and block</h3>
<p>In a room or on your friends list you can report a player or block them. A person reads every report. When ${F.REPORTS_TO_MUTE} different players report the same player in a room, that player&rsquo;s typed text is muted for ${F.MUTE_HOURS} hours.</p>`,
      },
      {
        id: 'profile',
        title: 'Your online profile',
        html: `<p>Friends, rooms with other people, lobbies and weekly boards need an online profile. The app asks your age group once, before you make it: under ${F.AGE.online}, ${F.AGE.online} to 17, or ${F.AGE.video} and older.</p>
${ul([
  `<strong>Under ${F.AGE.online}:</strong> no online profile. If you say you are under ${F.AGE.online}, the app registers nothing with our servers and you play on your own device only.`,
  `<strong>${F.AGE.online} to 17:</strong> a generated display name, preset messages only, friends only by code or link, public lobbies only with players of the same age group, no video and no typed text.`,
  `<strong>${F.AGE.video} and older:</strong> a display name you choose (up to ${F.NAME_MAX_CHARS} characters, filtered), typed chat and optional video with friends in private rooms.`,
])}
<p>There is no password and no e-mail address. Your device makes a key pair for the profile; the private half never leaves the device and signs every request. Nobody can search for you: people find you with your friend code (BA-XXXXXX) or link, or in a public lobby of your age group. You can renew your friend code at any time.</p>
<p>Friends see your display name and whether you are online, in a room, in a game or offline, and the code of your room while it can be joined. You can choose to appear offline.</p>
<p>When you make the profile, the app shows a recovery code once. We keep only a hash of it, so we cannot show it again or recover it for you. With the recovery code and your friend code you can restore the profile on a new browser or phone; one profile can sit on up to ${F.PROFILE_DEVICES} devices at a time. Safari, for example, may clear a site&rsquo;s data after seven days without a visit, and the recovery code is the way back.</p>`,
      },
      {
        id: 'kept',
        title: 'What our servers keep, and for how long',
        html: `<p>All of this lives in Cloudflare&rsquo;s storage for BodyArcade (Durable Objects with SQLite). The first table is the online profile. The second is rooms and licences.</p>
${table('The online profile', ['What', 'What it holds', 'How long'], [
  ['Profile', 'A random profile number (secret), your friend code, display name, age group, level band (easy, medium or hard), region (a continent, chosen by you or guessed from your connection), language, your appear-offline choice, the date you made it and the day you last used it.', `Until you delete your account, or ${F.UNUSED_PROFILE_DAYS} days after you last used it online. It is then erased automatically.`],
  ['Devices', 'For each device (up to ' + F.PROFILE_DEVICES + '): the public half of its key and the date it was added. A hash of your recovery code.', 'As long as the profile.'],
  ['Friends and blocks', 'Who your friends are (stored on both sides) and whom you blocked.', 'Until you remove them or unblock, or delete your account.'],
  ['Friend requests', 'Who asked whom, when, and by code or by link.', `An unanswered request is removed after ${F.REQUEST_DAYS} days. A declined request keeps its sender out for ${F.DECLINE_DAYS} days.`],
  ['Presence', 'Online, in a room, in a game or offline; the game; the room code while it can be joined.', `A player counts as offline after ${F.PRESENCE_MINUTES} minutes without a signal. The record goes with the profile.`],
  ['Lobby list', 'Room code, game, level band, region, and the display names of the players inside.', `Hidden ${F.LOBBY_HIDE_MINUTES} minutes after the room stops updating, removed after ${F.LOBBY_GONE_HOURS} hours.`],
  ['Weekly boards', 'Your best score per game and week, when you made it, your age group and a two-letter country code.', `This week and the week before. Older rows are deleted.`],
  ['Synced records', 'The days you did the daily challenge, the days you were active, and the days you finished each workout plan.', 'Until you delete your account.'],
  ['Reports', `Who reported whom, why, an optional note (adults only), the date, and up to ${F.CHAT_KEEP_LINES} chat lines from the room.`, `Until a person has looked at it, then ${F.RESOLVED_REPORT_DAYS} days. A report about a profile that no longer exists is removed ${F.ORPHAN_REPORT_DAYS} days after it was made.`],
  ['Safety log', 'What a moderator or an automatic rule did (mute, suspension, ban) and why.', `${F.AUDIT_DAYS} days.`],
  ['Limit counters', 'Counts of actions per profile, and per scrambled form of a network address (a keyed hash, never the address), to stop abuse.', 'About a day.'],
])}
${table('Rooms and licences', ['What', 'What it holds', 'How long'], [
  ['Room', 'As described under live play: player number, display name, age group, seat, readiness, results, chat and reports.', `Deleted ${F.ROOM_EMPTY_MINUTES} minutes after the last player leaves, and in any case ${F.ROOM_IDLE_HOURS} hours after the last activity.`],
  ['Pro licence', 'A fingerprint (SHA-256) of the licence key or of the Google Play purchase token, never the key or token itself. The plan, its status and dates, and for each device its random number and the day it last used the licence.', `A device gives its place back after ${F.SEAT_IDLE_DAYS} days unused. A purchase that ended or was refunded, with no device left, is forgotten ${F.FORGET_PURCHASE_DAYS} days after its last check. A running plan is kept while it runs.`],
  ['Trial reminder', 'The e-mail address you typed, its language and the day to send.', 'Until the one reminder is sent. See below.'],
])}
<p>To limit abuse we use your network address only briefly: counters are keyed by a scrambled form of it (for example, how many profiles one address makes in an hour), not by the address itself, and they expire within about a day. Cloudflare, which delivers the site, handles network addresses to do so and keeps its own operating logs under its policy. Our own code writes short technical lines to its logs (event names and counts) that contain no names, messages or video.</p>`,
      },
      {
        id: 'pro',
        title: 'Payments, Pro and licences',
        html: `<p><strong>On the web</strong>, Pro is sold by Gumroad. You pay on Gumroad&rsquo;s page, and Gumroad is the seller of record: it collects any VAT or sales tax. We do not receive your card details. As the seller we receive your e-mail address and the details of your order (what you bought, when and for how much), and we use them to answer questions and make refunds. Gumroad e-mails you a licence key.</p>
<p>When you paste the key into the Pro screen, it is sent to our licence service, which asks Gumroad whether it is valid. We keep a fingerprint of the key, the plan, the dates and a random number for your device, so that we can enforce the device limit: ${F.DEVICES.pro} devices for Pro and Lifetime${F.FAMILY_PLAN ? `, ${F.DEVICES.family} for Family` : ''} and ${F.DEVICES.founder} for Founders. The service answers with a signed licence that lasts at most ${F.LICENCE_DAYS} days, and the app asks again about once a day. If our service cannot be reached, your browser can ask Gumroad directly. Gumroad then sees your network address, and a check made that way is good for ${F.DIRECT_GRACE_DAYS} days without a network.</p>
<p><strong>In the Android app</strong> you pay through Google Play, which handles your payment data. The app sends the purchase token that Google gives it to our licence service, which checks it with Google. We keep only a fingerprint of the token.</p>`,
      },
      {
        id: 'reminder',
        title: 'The trial reminder e-mail',
        html: `<p>The ${F.TRIAL_DAYS}-day trial of Pro yearly has an optional e-mail reminder on the web. If you type an address in the Pro screen, it goes to our server together with your signed licence. We keep it, with the language you use and the day to send, until the one reminder has been sent, ${F.REMINDER_DAYS} days before the trial ends. Then we delete it.</p>
<p>We also delete it if you take it back in the app, if the plan is cancelled or refunded before that day, when the trial is over, or after ${F.REMINDER_TRIES} failed deliveries. The e-mail is plain text. We use the address for nothing else and never write to it again. It is sent through Forward Email, our mail provider.</p>
<p>In the Android app we ask for no address. Google Play sends its own reminder, and the app shows a notice on every open in the last ${F.REMINDER_DAYS} days of the trial.</p>`,
      },
      {
        id: 'analytics',
        title: 'Analytics and cookies',
        html: `<p>The game itself has no advertising trackers and no analytics code of ours. BodyArcade&rsquo;s own code sets no cookies; it uses your browser&rsquo;s storage for the things listed above. Cloudflare, which delivers the site, may set a security cookie that tells people from automated traffic, and Gumroad&rsquo;s pages set their own cookies.</p>
<p>We may count visits to this website with Cloudflare Web Analytics, a Cloudflare service that counts page views and page speed. Cloudflare says that it uses no cookies or local storage for this and does not fingerprint visitors. If we have it switched off, there is no analytics at all.</p>`,
      },
      {
        id: 'others',
        title: 'Who else handles data',
        html: `${ul([
  'Cloudflare delivers the site and stores rooms, profiles and licences for us. Its STUN service helps devices find each other.' + (F.RELAY_ON ? ' Its relay service can carry friend video.' : '') + ' <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">Privacy policy</a>.',
  'Gumroad sells Pro on the web, takes the payment, handles tax and checks licence keys. <a href="https://gumroad.com/privacy" rel="noopener">Privacy policy</a>.',
  'Google runs Google Play, which takes payments in the Android app and distributes it, and the mailbox behind our address. The pose model is Google&rsquo;s technology but runs on your device. <a href="https://policies.google.com/privacy" rel="noopener">Privacy policy</a>.',
  'Forward Email passes on mail sent to our address and sends the trial reminder. <a href="https://forwardemail.net/en/privacy" rel="noopener">Privacy policy</a>.',
])}
<p>We do not sell your data and we do not share it with advertisers. If you e-mail us, we receive your address and your message, and we use them only to answer you.</p>
<p>These companies may handle data outside your country, including outside the European Economic Area, the United Kingdom and Turkey. Where they do, they rely on their own data protection terms, which include safeguards such as standard contractual clauses. Their policies explain how.</p>`,
      },
      {
        id: 'rights',
        title: 'Your choices and your rights',
        html: `<p><strong>In the app.</strong> The profile screen has two buttons: one downloads everything we hold under your profile as a single file, and one deletes your account. Deleting erases the profile, its devices, friends, requests, blocks, presence, scores and synced records at once, closes your connections and tells your friends&rsquo; devices that you are gone.</p>
<p>What stays: reports in which you were involved stay for up to ${F.RESOLVED_REPORT_DAYS} days after they are handled (a report about a profile that no longer exists goes ${F.ORPHAN_REPORT_DAYS} days after it was made), because they protect other players. Your name and note are removed from the report record itself, but the chat lines that were reported may still show what was said.</p>
<p><strong>By e-mail.</strong> Write to ${mail()} to ask for anything below, or if you cannot use the app. We may ask for something that shows the profile is yours. We answer within one month (within 30 days under KVKK).</p>
<p>If the GDPR or the UK GDPR applies to you, you have the right to access your data, to have it corrected or erased, to restrict or object to its use, to receive it in a portable form, and to withdraw a consent you gave. You can complain to your data protection authority, such as the Information Commissioner&rsquo;s Office in the United Kingdom, or to the Personal Data Protection Authority (KVKK) in Turkey.</p>
<p>Under Article 11 of the KVKK you may also ask whether your data is processed and for what purpose, who it was given to at home or abroad, and ask for it to be corrected, deleted or destroyed, and for third parties to be told. You may claim damages for loss caused by unlawful processing.</p>
<h3>Why we may process data</h3>
${ul([
  'To give you the service you asked for: the game, your profile, rooms, your licence and the reminder you ordered. (Contract; KVKK Article 5/2-c.)',
  'With your consent: camera access, which your browser asks for, the optional friend video, and the reminder e-mail. You can withdraw it at any time. (Consent; KVKK Article 5/1.)',
  'To keep the service safe and fair: limits against abuse, reports, the safety log and the checks on weekly scores. (Legitimate interest; KVKK Article 5/2-f.)',
  'To meet legal duties, such as keeping order records for tax and accounting. (Legal obligation; KVKK Article 5/2-ç.)',
])}`,
      },
      {
        id: 'children',
        title: 'Children and teens',
        html: `<p>Families can play BodyArcade. The online features are for players ${F.AGE.online} and older, with limits until ${F.AGE.video}:</p>
${ul([
  `Under ${F.AGE.online}: no online profile, and nothing is registered on our servers. Friends, rooms, lobbies and boards are not available. The games work on the device.`,
  `${F.AGE.online} to 17: a generated name, preset messages, friends only by code or link, public lobbies with players of the same age group only, no video, no typed text. A person of ${F.AGE.video} or older cannot send a friend request to a player under ${F.AGE.video}; the younger player has to send it.`,
  `${F.AGE.video} and older: typed chat and optional video with friends in private rooms.`,
])}
<p>The age is the one you say; the app cannot check it. Gumroad and Google Play have their own age rules for buying, so a purchase is for an adult or made by a parent. You can lower your age group later but not raise it: a new profile starts again.</p>
${F.FAMILY_PLAN ? `<p>The Family plan lets up to ${F.FAMILY_PROFILES} people on one device keep their own results. Those profiles live on that device only. A kids profile shows no calorie figures, asks for no body weight and keeps prices behind a grown-up check.</p>` : ''}
<p>If you think a child under ${F.AGE.online} has made an online profile, write to ${mail()} and we will remove it.</p>`,
      },
      {
        id: 'security',
        title: 'Security',
        html: `<p>All traffic uses HTTPS. A profile signs its requests with a key that stays on the device. Licence keys and purchase tokens are stored only as hashes. The tools that read reports and act on them need a secret token that only we hold. No system is perfectly safe. If something goes wrong that puts your data at risk, we will report it to the authorities and tell the people affected, as the law requires.</p>`,
      },
      {
        id: 'changes',
        title: 'Changes and contact',
        html: `<p>When the way BodyArcade handles data changes, we change this page and the date at the top. See also the <a href="/terms">terms of use</a> and the <a href="/faq">FAQ</a>.</p>
<p>${F.COMPANY}, ${mail()}.</p>`,
      },
    ],
  };
}
