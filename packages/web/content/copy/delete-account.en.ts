// How to delete the online profile and the data the servers hold about it, in English. It is the page that the Google Play data safety
// form names ("a web link to delete the account and data"), and the privacy policy, the footer and the settings lead to it. Every
// sentence was checked against the code on 25 October 2026: the buttons are the profile screen's (social/strings.ts), the erase is
// people.ts eraseProfile, what stays is that function's own comment and the sweep (sweep.ts), the request by e-mail is the
// moderator route that erases a profile by its friend code (moderation.ts adminDeleteProfile). Numbers come from facts.ts.
import { mail, ol, table, ul, type PageSpec } from '../chrome.ts';
import * as F from '../facts.ts';

export function deleteAccountEn(): PageSpec {
  const date = F.longDate(F.UPDATED, 'en');
  return {
    file: 'delete-account.html',
    url: '/delete-account',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/delete-account' },
    title: 'Delete your account and data',
    description: 'How to delete your BodyArcade online profile and the data our servers hold about it, in the app or by e-mail, what is erased, what stays and why.',
    h1: 'Delete your account and data',
    when: `Last updated ${date}`,
    lead: `BodyArcade is made by ${F.OWNER}, trading as ${F.STUDIO}. This page covers bodyarcade.com and the BodyArcade Android app. It explains how to delete the online profile you made in BodyArcade, what that erases and when, and what stays and why. The <a href="/privacy">privacy policy</a> has the full list of what is kept.`,
    brief: {
      title: 'In short',
      items: [
        '<strong>You delete your profile yourself, in the app.</strong> Friends, then My profile, then Delete my profile. Everything the profile holds on our servers is erased at once.',
        '<strong>You can take a copy first.</strong> Download my data gives you one file.',
        `<strong>Lost the device?</strong> Bring the profile back with your friend code and your recovery code, then delete it. Without them, write to ${mail()} with your friend code.`,
        '<strong>A few things stay for a while,</strong> and the page says which and for how long: reports that protect other players, the safety log, payment records and Pro license records.',
        '<strong>You do not need a profile to play.</strong> Without one, your settings and results are on your device only.',
      ],
    },
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Delete your account and data', url: '/delete-account' }],
    sections: [
      {
        id: 'app',
        title: 'Delete your profile in the app',
        html: `${ol([
  'Open <strong>Friends</strong>, then <strong>My profile</strong>.',
  'Under Your data, choose <strong>Download my data</strong> if you want a copy first. It is one file with your profile, friends, requests, blocks, weekly scores and synced records, the number of reports you filed and that were filed about you, and the version of the terms you agreed to. The file is saved on your device and is not sent anywhere.',
  'Choose <strong>Delete my profile</strong>. The app asks &ldquo;Delete your profile?&rdquo;. Confirm with <strong>Delete my profile</strong>.',
])}
<p>Deleting erases the profile, its devices, friends, requests, blocks, presence, scores and synced records at once, closes your connections, tells your friends&rsquo; devices that you are gone and removes the profile from the device you used. It cannot be undone. The games, settings and results on your device stay.</p>
<p>The same two buttons work on the web and in the Android app, and also when the profile has been suspended or banned.</p>`,
      },
      {
        id: 'lost',
        title: 'If you no longer have the device',
        html: `<p>When you made the profile, the app showed a recovery code once. If you saved it, you can bring the profile back on any browser or phone: open Friends, choose <strong>Make my profile</strong>, then <strong>I already have a profile</strong>, and enter your friend code and your recovery code. After that, delete the profile as above.</p>
<p>If you have neither the device nor the recovery code, write to ${mail()}. Use the subject &ldquo;Delete my BodyArcade profile&rdquo; and give your friend code (it looks like <span class="nw">BA-7K2Q4X</span>). The friend code is how we find the profile, so we cannot act without it. It is on the Friends screen of the app, and in the recovery file the app offered to save. We may ask for something that shows the profile is yours. When we are sure, we erase the profile with the same steps as the app&rsquo;s button. We answer within 30 days.</p>
<p>If you think a child under ${F.AGE.online} has made an online profile, write to the same address and we will remove it. A profile that nobody uses is also erased by itself, ${F.UNUSED_PROFILE_DAYS} days after it was last used online.</p>`,
      },
      {
        id: 'erased',
        title: 'What is erased, and when',
        html: `${table(null, ['What', 'What it holds', 'When'], [
  ['Profile', 'Your friend code, display name, age group, level, region, language, appear-offline choice, any mute or suspension, the version of the terms you agreed to and a hash of your recovery code.', '<span class="nw">At once</span>'],
  ['Devices', 'The public half of the key of each device that can sign for the profile.', '<span class="nw">At once</span>'],
  ['Friends and requests', 'Your friendships (on both sides), requests you sent and received, and declined requests.', '<span class="nw">At once</span>'],
  ['Blocks', 'The players you blocked, and the blocks other players made against you.', '<span class="nw">At once</span>'],
  ['Presence', 'Whether you are online, in a room or in a game.', '<span class="nw">At once</span>'],
  ['Weekly scores', 'Your best score of each game for this week and the week before.', '<span class="nw">At once</span>'],
  ['Synced records', 'The small lists of days that let a second device carry on.', '<span class="nw">At once</span>'],
  ['Connections', 'Your open connection to the friends service is closed, and your friends&rsquo; apps are told that you are gone.', '<span class="nw">At once</span>'],
])}
<p>From the live database these records are gone as soon as you confirm. Cloudflare, which stores them for us, keeps a recovery history of that storage for up to 30 days, so a deleted record can still sit in that history for up to that long before it is gone for good.</p>`,
      },
      {
        id: 'kept',
        title: 'What stays, and why',
        html: `${ul([
  `<strong>Reports.</strong> Reports in which you were involved stay for up to ${F.RESOLVED_REPORT_DAYS} days after we handled them, because they protect other players. A report about a profile that no longer exists goes ${F.ORPHAN_REPORT_DAYS} days after it was made. A report you filed loses its link to your profile, and keeps the reason, the room, your optional note, the player you reported and the saved chat lines. A report about you loses your display name and any note, and keeps the reason, the room, a random profile number that no longer belongs to anyone, and the saved chat lines, which still carry the display names and the words used in the room.`,
  `<strong>The safety log.</strong> What a moderator or an automatic rule did (mute, suspension, ban) and why is kept for ${F.AUDIT_DAYS} days. An entry about you carries the random profile number and the moderator&rsquo;s note, not your name.`,
  `<strong>Rooms.</strong> A room you were in is deleted ${F.ROOM_EMPTY_MINUTES} minutes after the last player leaves, and in any case ${F.ROOM_IDLE_HOURS} hours after its last activity, together with its chat and results. Its entry in the list of rooms is hidden ${F.LOBBY_HIDE_MINUTES} minutes after the room stops updating, and removed ${F.LOBBY_GONE_HOURS} hours after its last update at the latest.`,
  `<strong>Pro license records.</strong> A Pro license is not tied to your profile, so deleting the profile does not touch it, and Pro keeps working. Our license service holds a fingerprint of the license key (or of the Google Play purchase token), the plan, its status and dates, and a random number for each device. A device gives its place back after ${F.SEAT_IDLE_DAYS} days unused, and a purchase that ended, with no device left, is forgotten ${F.FORGET_PURCHASE_DAYS} days after its last check. A running plan is kept while it runs.${F.REMINDER_MAIL ? ' An e-mail address left for the trial reminder is deleted once the reminder is sent, or sooner if the trial ends or the plan is cancelled.' : ''} If you want one of these records removed earlier, write to ${mail()}.`,
  '<strong>Payment records.</strong> Payments go through Gumroad on the web and Google Play in the Android app, which keep their own records under their own policies. As the seller we receive your e-mail address and the details of your order, and we keep them for as long as tax and accounting law requires.',
])}`,
      },
      {
        id: 'subscriptions',
        title: 'Subscriptions',
        html: `<p>Deleting your profile does not cancel a subscription. On the web, cancel in your Gumroad library (choose BodyArcade, then Manage membership). In the Android app, cancel in Google Play subscriptions. Pro stays on until the end of the period you paid for. The <a href="/terms">terms</a> explain refunds.</p>`,
      },
      {
        id: 'device',
        title: 'Data on your device',
        html: `<p>Your settings, results and ghost runs are kept on your device only, whether or not you have a profile. Settings has a button, <strong>Clear data on this device</strong>, that clears them. It does not delete an online profile, because the profile screen has its own button for that. Clearing the site&rsquo;s data in your browser removes everything on the device, including the key of your profile, so delete the profile first or keep your recovery code.</p>`,
      },
      {
        id: 'contact',
        title: 'Questions',
        html: `<p>Write to ${mail()}. How BodyArcade handles data is in the <a href="/privacy">privacy policy</a>, where &ldquo;Your choices and your rights&rdquo; lists the rights you have under the GDPR, the UK GDPR and the Turkish KVKK.</p>`,
      },
    ],
  };
}
