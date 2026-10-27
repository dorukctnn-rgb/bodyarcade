// The privacy policy, in English. Every number is a fact from facts.ts; content.test.ts compares those with the code.
// Written for the player first: what is kept, where, and for how long. The legal vocabulary (controller, legal bases,
// rights) has its own sections at the end. Every sentence here was checked against the code on 24 October 2026; the notes of
// the content builder (NOTLAR-content.md, "Doğrulama bulguları") list where each one was found.
import { mail, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function privacyEn(): PageSpec {
  const date = F.longDate(F.UPDATED, 'en');
  const video = F.RELAY_ON
    ? 'If your devices cannot reach each other directly, the encrypted picture can pass through a relay server run by Cloudflare. A relay only forwards the data and keeps no copy.'
    : 'If your devices cannot reach each other directly, no picture is shown and the game goes on with your skeleton.';
  const analytics = F.ANALYTICS_ON
    ? `<p>We count visits to this website with Cloudflare Web Analytics, which counts page views and page speed. Cloudflare says that it uses no cookies or local storage for this and does not fingerprint visitors.</p>`
    : `<p>We do not measure visits to the site with any script. Cloudflare counts the requests it serves on its own side, for example how many pages were asked for and from which countries.</p>`;
  return {
    file: 'privacy.html',
    url: '/privacy',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/privacy' },
    title: 'Privacy policy',
    description: 'What BodyArcade keeps about you, where and for how long: camera video stays on your device, what online play holds, payments, children and your rights.',
    h1: 'Privacy policy',
    when: `Last updated ${date}`,
    lead: `BodyArcade is made by ${F.OWNER}, trading as ${F.STUDIO}. This page says in plain words what BodyArcade keeps about you, where it keeps it and for how long. It covers bodyarcade.com and the BodyArcade Android app. Questions and requests: ${mail()}.`,
    brief: {
      title: 'In short',
      items: [
        '<strong>Your camera video stays on your device.</strong> It is turned into body points there. It is not uploaded, recorded or stored. The one exception is optional: a live picture between two friends who are both 18 or older, in a private room, when both of them switch it on.',
        `<strong>You can play without a profile.</strong> A profile is needed only for friends, rooms with other people, public lobbies and weekly boards. It has no password and no e-mail address. Players under ${F.AGE.online} do not get an online profile.`,
        `<strong>Live rooms clear themselves.</strong> A room is deleted ${F.ROOM_EMPTY_MINUTES} minutes after the last player leaves, and in any case ${F.ROOM_IDLE_HOURS} hours after its last activity, together with its chat and results.`,
        '<strong>No ads, no advertising trackers, no sale of data.</strong> Payments go through Gumroad on the web and Google Play in the Android app, so we never see card details.',
        '<strong>Your data is yours to take or erase.</strong> The profile screen of the app downloads your profile data as one file and deletes your account. The page <a href="/delete-account">Delete your account and data</a> has the steps, and says what stays.',
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Privacy policy', url: '/privacy' }],
    sections: [
      {
        id: 'who',
        title: 'Who is responsible',
        html: `<p>BodyArcade is run by ${F.OWNER}, an individual who trades as ${F.STUDIO} in ${F.COUNTRY}. On this page &ldquo;we&rdquo; means him. We decide what is done with the data described here. In data protection law that makes us the controller: the &ldquo;data controller&rdquo; of the GDPR and the &ldquo;veri sorumlusu&rdquo; of the Turkish Personal Data Protection Law (KVKK, law no. 6698).</p>
<p>You can reach us at ${mail()}. That is also where requests about your data go. We do not publish a street address.</p>`,
      },
      {
        id: 'device',
        title: 'What stays on your device',
        html: `<p>These things are kept in the storage of your browser (or of the Android app) on your device. They are not sent to us unless a later section says so.</p>
${ul([
  'Your settings: language, theme, seated and quiet mode, where your camera view sits, skeleton on or off, sound, big text and reduced motion.',
  'Your body weight, if you enter it. It is used only on your device, to estimate calories.',
  'Your results: recent rounds, best scores, minutes played and your streak, and the Pro games you have tried once.',
  'Ghost runs: your best run of a game, which is what you did at each obstacle and, for your own runs, your skeleton drawn as points. Never the picture.',
  'For Pro: the license key you activated (web), the signed license your device received, and a random device number that counts your devices.',
  ...(F.REMINDER_MAIL ? ['For the trial reminder: a masked copy of the e-mail address you typed, such as a***@example.com, not the address itself.'] : []),
  'For an online profile: the secret key your device made for it (kept by the browser in a way that does not let pages read it), the last profile details our server sent back, and your list of blocked players.',
  'Copies of the game&rsquo;s own files, so it opens without a network. This includes the pose model.',
])}
<p>The Settings screen has a button that clears the settings and results on this device. It does not delete an online profile: the profile screen has its own button for that. Clearing the site&rsquo;s data in your browser removes everything listed above, including the key of your profile, so keep your recovery code (see below).</p>`,
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
  `everyone in the room is ${F.AGE.video} or older (players under ${F.AGE.video} never share video);`,
  'you each switched on the camera share in the room;',
  'neither of you has blocked the other.',
])}
<p>Either of you can turn it off at any time, and the room shows who is sharing a camera. The picture goes from your device to your friend&rsquo;s device and is encrypted on the way. We do not receive it, record it or store it, and nobody else sees it. ${video}</p>
<p>A direct connection between two devices lets each device see the other&rsquo;s network (IP) address. That is one more reason the video is limited to friends you chose to play with. Please do not record or capture a friend&rsquo;s picture: the app does not, and the terms ask you not to.</p>`,
      },
      {
        id: 'live',
        title: 'Live play: rooms, chat and lobbies',
        html: `<p>A room holds ${F.SEATS.min} to ${F.SEATS.max} players. You open one with an invite link, a ${F.ROOM_CODE_CHARS}-character code or a QR code, or you join a public lobby. While a room exists, its server holds:</p>
${ul([
  'a random player number (a device number that no other player ever sees), your display name, your age group, and a seat number, which is what the other players see instead of your player number;',
  'who is ready and who is online, the game and its settings, the players of the room you blocked (as scrambled keys) and, in a private room, the players the host removed (by player number, so that they cannot come back);',
  'the results and scores of the rounds;',
  `the last ${F.CHAT_KEEP_LINES} chat messages, each with the display name of whoever wrote it, and the reports made in the room (which seat reported which seat, why and when).`,
])}
<p>During a round your device tells the other players your score and a skeleton of ${F.SHARED_JOINTS} joints, about ${F.SHARE_HZ} times a second: nose, shoulders, elbows, wrists, hips, knees and ankles, with no picture. It travels straight between the devices or through our room server, which passes it on and keeps no copy. The same goes for the connection details that two devices swap to find each other, which contain network addresses.</p>
<p>At the end of a round in a private room, each player&rsquo;s device receives what the others did at each obstacle, with their display names. Your friends can keep that as a recording to race against later. It holds no picture and no skeleton. A run that you send to a friend as a short code or link carries your display name, the course and what you did, and nothing else.</p>
<p>A room is deleted when nobody has been in it for ${F.ROOM_EMPTY_MINUTES} minutes, and in any case ${F.ROOM_IDLE_HOURS} hours after its last activity. Deleting a room deletes its chat, results and reports. A report that was sent on keeps its own copy of the chat lines it is about; the table below says for how long.</p>
<p>To keep the game in step, the devices in a room try to connect to each other directly. That lets the other devices see your network (IP) address. Your browser also asks a Cloudflare server (STUN) which address the internet sees for you, so that the devices can find each other. If you do not want this, play without joining a room.</p>
<h3>Chat</h3>
<p>Typed chat exists only in private rooms where every player is ${F.AGE.video} or older. It is filtered (no links, e-mail addresses, phone numbers, @names or rude words), limited to ${F.CHAT_MAX_CHARS} characters and one message every ${F.CHAT_GAP_SECONDS} seconds. Everyone else uses preset messages and reactions.</p>
<h3>Public lobbies</h3>
<p>In a public lobby you meet players of your own age group (${F.AGE.online} to 17, or ${F.AGE.video} and older) at your level. They see a skeleton in your colour and your display name, and they can send you preset messages and drawn reactions. They never see your video and never receive typed text from you.</p>
<h3>Report and block</h3>
<p>In a room or on your friends list you can report a player or block them. Every report goes into a queue that we read ourselves; reports about serious reasons (sexual content, a player who seems to be under ${F.AGE.online}) come first. Automatic steps protect other players until we have looked:</p>
${ul([
  `when ${F.REPORTS_TO_MUTE} different players report the same player within ${F.MUTE_WINDOW_HOURS} hours, that player&rsquo;s typed text is muted for ${F.MUTE_HOURS} hours;`,
  `when ${F.REPORTS_TO_SUSPEND} different players report them within ${F.SUSPEND_WINDOW_DAYS} days, or ${F.URGENT_REPORTERS_TO_SUSPEND} do for a serious reason within a day, public lobbies are closed to them for ${F.SUSPEND_DAYS} days;`,
  `only reports from profiles that are at least ${F.REPORTER_MIN_PROFILE_HOURS} hour old count towards these steps.`,
])}
<p>We can end or extend any of this, and we can warn, mute, suspend or ban a profile. The player you report is not told who reported them. The automatic steps are made by rules, not by a person. If you think one of them was wrong, write to us and a person will look at it.</p>`,
      },
      {
        id: 'profile',
        title: 'Your online profile',
        html: `<p>Friends, rooms with other people, public lobbies and weekly boards need an online profile. The app asks your age group once, before you make it: under ${F.AGE.online}, ${F.AGE.online} to 17, or ${F.AGE.video} and older.</p>
${ul([
  `<strong>Under ${F.AGE.online}:</strong> no online profile. If you say you are under ${F.AGE.online}, the app makes no key and sends nothing to the friends service, and you play on your own device only.`,
  `<strong>${F.AGE.online} to 17:</strong> a generated display name, preset messages only, friends only by code or link, public lobbies only with players of the same age group, no video and no typed text.`,
  `<strong>${F.AGE.video} and older:</strong> a display name you choose (up to ${F.NAME_MAX_CHARS} characters, filtered), typed chat and optional video with friends in private rooms.`,
])}
<p>There is no password and no e-mail address. Your device makes a key pair for the profile; the private half cannot be taken out of the browser and signs every request. Nobody can search for you: people find you with your friend code (it looks like BA-7K2Q4X) or your invite link, or meet you in a public lobby of your age group. You can renew your friend code at any time, and the old one stops working.</p>
<p>Friends see your display name and whether you are online, in a room, in a game or offline, and the code of your room while it can be joined. Their apps also learn your age group, because chat and video between you depend on it. You can choose to appear offline.</p>
<p>While you have a profile, your best score of each game and week goes to the weekly boards. Your friends see it on their friends board, and players in your country and age group see your display name and score on the country board. The server checks that a score is possible for the time the round took, but it cannot replay the game, so the boards carry no prizes.</p>
<p>When you make the profile, the app shows a recovery code of ${F.RECOVERY_CODE_CHARS} characters once. We keep only a hash of it, so we cannot show it again or recover it for you. With the recovery code and your friend code you can bring the profile back on a new browser or phone; one profile can sit on up to ${F.PROFILE_DEVICES} devices at a time. The code stays valid until you ask for a new one, which replaces it. Safari, for example, may clear a site&rsquo;s data after seven days without a visit, and the recovery code is the way back.</p>`,
      },
      {
        id: 'kept',
        title: 'What our servers keep, and for how long',
        html: `<p>All of this lives in Cloudflare&rsquo;s storage for BodyArcade (Durable Objects with SQLite). The first table is the online profile. The second is rooms, licenses${F.REMINDER_MAIL ? ' and the reminder' : ''}.</p>
${table('The online profile', ['What', 'What it holds', 'How long'], [
  ['Profile', `A secret profile number, your friend code, display name, age group, level (a number from 1 to ${F.LEVEL_MAX} that your device reports; it only decides who you meet in lobbies), region (a continent, chosen by you or guessed from your connection), language, your appear-offline choice, any mute, suspension or ban with its end date, the date you made it, the version of the terms you agreed to when you made it, and the day you last used it.`, `Until you delete your account, or ${F.UNUSED_PROFILE_DAYS} days after you last used it online. It is then erased automatically.`],
  ['Devices and recovery', `For each device (up to ${F.PROFILE_DEVICES}): the public half of its key, a short fingerprint of it and the date it was added. A hash of your recovery code.`, `As long as the profile. A sixth device replaces the oldest.`],
  ['Friends and blocks', 'Who your friends are (one row on each side) and whom you blocked.', 'Until you remove them or unblock, or delete your account.'],
  ['Friend requests', 'Who asked whom, when, and whether by code or by link.', `An unanswered request is removed after ${F.REQUEST_DAYS} days. A declined request keeps its sender out for ${F.DECLINE_DAYS} days.`],
  ['Presence', 'Online, in a room, in a game or offline; the game; the code of the room you are in (friends see it only while the room can be joined).', `A player counts as offline after ${F.PRESENCE_MINUTES} minutes without a signal. The record goes with the profile.`],
  ['Room directory', 'For each room that has players, public or private: room code, game, level band, region, age group of a public room, seats, the display names of the players and, never shown, their profile numbers (used only to hide blocked pairs). Only public rooms are listed.', `Hidden from the list ${F.LOBBY_HIDE_MINUTES} minutes after the room stops updating. Removed when the room is deleted, and in any case ${F.LOBBY_GONE_HOURS} hours after its last update.`],
  ['Weekly boards', 'Your best score per game and week, when you made it, your age group and a two-letter country code taken from your connection.', `This week and the week before (${F.BOARD_WEEKS} weeks). Older rows are deleted.`],
  ['Synced records', 'A few small lists of days that let a second device carry on: days with enough play to count as active, rest days used for the streak and, where the app offers them, the days you did the daily challenge or finished a workout plan.', 'Until you delete your account.'],
  ['Reports', `Who reported whom, the reason, an optional note (adults only, up to ${F.REPORT_NOTE_MAX_CHARS} characters), the date, the room, the name of the reported player and up to ${F.CHAT_KEEP_LINES} chat lines from the room with the display names in them.`, `Until we have looked at it, then ${F.RESOLVED_REPORT_DAYS} days. A report about a profile that no longer exists is removed ${F.ORPHAN_REPORT_DAYS} days after it was made.`],
  ['Safety log', 'What a moderator or an automatic rule did (mute, suspension, ban) and why.', `${F.AUDIT_DAYS} days.`],
  ['Limit counters', 'Counts of actions, per profile and per scrambled form of a network address (a keyed hash; never the address), to stop abuse.', 'About a day.'],
])}
${table(F.REMINDER_MAIL ? 'Rooms, licenses and the reminder' : 'Rooms and licenses', ['What', 'What it holds', 'How long'], [
  ['Room', 'As described under live play: player number, display name, age group, seat, readiness, results, chat and reports.', `Deleted ${F.ROOM_EMPTY_MINUTES} minutes after the last player leaves, and in any case ${F.ROOM_IDLE_HOURS} hours after the last activity.`],
  ['Pro license', 'A fingerprint (SHA-256) of the license key or of the Google Play purchase token, never the key or token itself. The plan, its status and dates, and for each device its random number and the day it last used the license.', `A device gives its place back after ${F.SEAT_IDLE_DAYS} days unused. A purchase that ended or was refunded, with no device left, is forgotten ${F.FORGET_PURCHASE_DAYS} days after its last check. A running plan is kept while it runs.`],
  ...(F.REMINDER_MAIL ? [['Trial reminder', 'The e-mail address you typed, its language and the day to send.', 'Until the one reminder is sent. See below.']] : []),
])}
<p>A network address is used only briefly. In the friends service, counters are keyed by a scrambled form of the address (for example, how many profiles one address makes in an hour), never by the address itself, and they are removed within about a day. The live-play and license services keep their short counters by address in memory only, never in storage, and they are gone within an hour or when the service restarts. Cloudflare, which delivers the site, handles network addresses to do so and keeps its own operating logs under its policy.</p>
<p>After you delete something, it is gone from the live database at once. Cloudflare keeps a recovery history of that storage for up to 30 days, so a deleted record can still sit in that history for up to that long before it is gone for good.</p>`,
      },
      {
        id: 'pro',
        title: 'Payments, Pro and licenses',
        html: `<p><strong>On the web</strong>, Pro is sold by Gumroad. You pay on Gumroad&rsquo;s page, and Gumroad is the seller of record: it collects any VAT or sales tax. We do not receive your card details. As the seller we receive your e-mail address and the details of your order (what you bought, when and for how much), and we use them to answer questions and make refunds. Gumroad e-mails you a license key.</p>
<p>When you paste the key into the Pro screen, it is sent to our license service, which asks Gumroad whether it is valid. We keep a fingerprint of the key, the plan, the dates and a random number for your device, so that we can enforce the device limit: ${F.DEVICES.pro} devices for Pro and Lifetime${F.FAMILY_PLAN ? `, ${F.DEVICES.family} for Family` : ''} and ${F.DEVICES.founder} for Founders. The service answers with a signed license that lasts at most ${F.LICENCE_DAYS} days, and the app asks again about once a day. If our service cannot be reached, your browser can ask Gumroad directly. Gumroad then sees your network address, and a check made that way is good for ${F.DIRECT_GRACE_DAYS} days without a network.</p>
<p><strong>In the Android app</strong> you pay through Google Play, which handles your payment data. The app sends the purchase token that Google gives it to our license service, which checks it with Google. We keep only a fingerprint of the token.</p>`,
      },
      {
        id: 'reminder',
        title: F.REMINDER_MAIL ? 'The trial reminder e-mail' : 'The trial reminder',
        html: F.REMINDER_MAIL
          ? `<p>The ${F.TRIAL_DAYS}-day trial of Pro yearly has an optional e-mail reminder on the web. If you type an address in the Pro screen, it goes to our server together with your signed license. We keep it, with the language you use and the day to send, until the one reminder has been sent, ${F.REMINDER_DAYS} days before the trial ends. Then we delete it.</p>
<p>We also delete it, without sending anything, if you take it back in the app, when our records show that the plan was cancelled or refunded before that day, when the trial is over, or after ${F.REMINDER_TRIES} failed deliveries. The e-mail is plain text and holds no tracking. We use the address for nothing else and never write to it again. It is sent through Forward Email, our mail provider.</p>
<p>In the Android app we ask for no address. Google Play sends its own reminder, and the app shows a notice on every open in the last ${F.REMINDER_DAYS} days of the trial.</p>`
          : `<p>The ${F.TRIAL_DAYS}-day trial of Pro yearly comes with a reminder: in the last ${F.REMINDER_DAYS} days of the trial the app shows a notice on every open. The notice is made on your device from the dates of your license. We do not ask for an e-mail address for it, and no e-mail is sent. In the Android app, Google Play sends its own reminder too.</p>`,
      },
      {
        id: 'analytics',
        title: 'Analytics, cookies and logs',
        html: `<p>BodyArcade has no advertising trackers and no analytics code of our own. Its own code sets no cookies; it uses your browser&rsquo;s storage for the things listed above. Cloudflare, which delivers the site, may set a security cookie that tells people from automated traffic, and Gumroad&rsquo;s pages set their own cookies.</p>
${analytics}
<p>Our own code writes short technical lines to the logs of the service: event names, room codes, counts, the first eight characters of a license fingerprint, and error messages. They hold no display names, no messages, no video and no network addresses. Browser security reports (which file a browser refused to load) are logged the same way. Cloudflare also keeps request logs for the service under its own policy.</p>`,
      },
      {
        id: 'others',
        title: 'Who else handles data',
        html: `${ul([
  'Cloudflare delivers the site and stores rooms, profiles and licenses for us. Its STUN service helps devices find each other.' + (F.RELAY_ON ? ' Its relay service can carry friend video.' : '') + ' <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">Privacy policy</a>.',
  'Gumroad sells Pro on the web, takes the payment, handles tax and checks license keys. <a href="https://gumroad.com/privacy" rel="noopener">Privacy policy</a>.',
  'Google runs Google Play, which takes payments in the Android app and distributes it, and the mailbox behind our address. The pose model is Google&rsquo;s technology but runs on your device. <a href="https://policies.google.com/privacy" rel="noopener">Privacy policy</a>.',
  `Forward Email passes on mail sent to our address${F.REMINDER_MAIL ? ' and sends the trial reminder' : ''}. <a href="https://forwardemail.net/en/privacy" rel="noopener">Privacy policy</a>.`,
])}
<p>We do not sell your data and we do not share it with advertisers. If you e-mail us, we receive your address and your message, and we use them only to answer you.</p>
<p>These companies may handle data outside your country, including outside the European Economic Area, the United Kingdom and Turkey. Where they do, they rely on their own data protection terms, which include safeguards such as standard contractual clauses. Their policies explain how. Under the KVKK this counts as a transfer of personal data abroad (Article 9).</p>`,
      },
      {
        id: 'rights',
        title: 'Your choices and your rights',
        html: `<p><strong>In the app.</strong> The profile screen has two buttons. One downloads your profile data as a single file: your profile, friends, requests, blocks, weekly scores and synced records, the number of reports you filed and that were filed about you, and the version of the terms you agreed to. The other deletes your account. Deleting erases the profile, its devices, friends, requests, blocks, presence, scores and synced records at once, closes your connections and tells your friends&rsquo; devices that you are gone. The page <a href="/delete-account">Delete your account and data</a> has the steps, what is erased when, and what stays.</p>
<p>What stays: reports in which you were involved stay for up to ${F.RESOLVED_REPORT_DAYS} days after we handled them (a report about a profile that no longer exists goes ${F.ORPHAN_REPORT_DAYS} days after it was made), because they protect other players. A report you filed loses its link to your profile. A report about you loses your display name and any note, but keeps the reason, the room, a random profile number that no longer belongs to anyone, and the saved chat lines, which still carry the display names and words used in the room. Rooms you were in disappear on their own timetable (see above).</p>
<p><strong>By e-mail.</strong> Write to ${mail()} to ask for anything below, for anything the file does not hold, or if you cannot use the app. We may ask for something that shows the profile is yours. We answer within one month (within 30 days under KVKK).</p>
<p>If the GDPR or the UK GDPR applies to you, you have the right to access your data, to have it corrected or erased, to restrict or object to its use, to receive it in a portable form, and to withdraw a consent you gave. You can complain to your data protection authority, such as the Information Commissioner&rsquo;s Office in the United Kingdom, or to the Personal Data Protection Authority (KVKK) in Turkey. If you live where another privacy law gives you rights, for example in California, the same requests work: write to us.</p>
<p>Under Article 11 of the KVKK you may also ask whether your data is processed and for what purpose, who it was given to at home or abroad, and ask for it to be corrected, deleted or destroyed, and for third parties to be told. You may claim damages for loss caused by unlawful processing.</p>
<h3>Why we may process data</h3>
${ul([
  `To give you the service you asked for: the game, your profile, rooms${F.REMINDER_MAIL ? ', your license and the reminder you ordered' : ' and your license'}. (Contract; KVKK Article 5/2-c.)`,
  `With your consent: camera access, which your browser asks for, ${F.REMINDER_MAIL ? 'the optional friend video, and the reminder e-mail' : 'and the optional friend video'}. You can withdraw it at any time. (Consent; KVKK Article 5/1.)`,
  'To keep the service safe and fair: limits against abuse, reports, the safety log and the checks on weekly scores. (Legitimate interest; KVKK Article 5/2-f.)',
  'To meet legal duties, such as keeping order records for tax and accounting for as long as the law requires. (Legal obligation; KVKK Article 5/2-ç.)',
])}`,
      },
      {
        id: 'children',
        title: 'Children and teens',
        html: `<p>Families can play BodyArcade. The online features are for players ${F.AGE.online} and older, with limits until ${F.AGE.video}:</p>
${ul([
  `Under ${F.AGE.online}: no online profile, and nothing is sent to the friends service. Friends, rooms, lobbies and boards are not available. The games work on the device.`,
  `${F.AGE.online} to 17: a generated name, preset messages, friends only by code or link, public lobbies with players of the same age group only, no video, no typed text. A person of ${F.AGE.video} or older cannot send a friend request to a player under ${F.AGE.video}; the younger player has to send it.`,
  `${F.AGE.video} and older: typed chat and optional video with friends in private rooms.`,
])}
<p>The age is the one you say; the app cannot check it. Gumroad and Google Play have their own age rules for buying, so a purchase is for an adult or made by a parent. You can lower your age group later but not raise it: a new profile starts again.</p>
${F.FAMILY_PLAN ? `<p>The Family plan lets up to ${F.FAMILY_PROFILES} people on one device keep their own results. Those profiles are stored on that device only. Only the first profile, the owner&rsquo;s, can have an online profile; a child&rsquo;s profile never gets one.</p>` : ''}
<p>If you think a child under ${F.AGE.online} has made an online profile, write to ${mail()} and we will remove it.</p>`,
      },
      {
        id: 'security',
        title: 'Security',
        html: `<p>All traffic uses HTTPS. A profile signs its requests with a key that stays on the device. License keys and purchase tokens are stored only as hashes. The tools that read reports and act on them need a secret token that only we hold. No system is perfectly safe. If something goes wrong that puts your data at risk, we will report it to the authorities and tell the people affected, as the law requires.</p>`,
      },
      {
        id: 'changes',
        title: 'Changes and contact',
        html: `<p>When the way BodyArcade handles data changes, we change this page and the date at the top. See also the <a href="/terms">terms of use</a> and the <a href="/faq">FAQ</a>.</p>
<p>${F.OWNER}, trading as ${F.STUDIO}, ${F.COUNTRY}. ${mail()}.</p>`,
      },
    ],
  };
}
