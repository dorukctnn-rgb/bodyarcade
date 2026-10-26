// Search page: workout games to play with friends online (English). Target queries: workout with friends app, fitness games to play
// with friends, exercise games two players. It states what the build does: live rooms for the games that have a live race, two
// people on one camera, ghost runs and weekly boards, and the age rules. Everything comes from the facts, the snapshot and the
// app's own words (seo-shared.ts); the FAQ page says the same things in shorter form and content.test.ts compares them.
import { articleLd, cta, faqLd, ol, qa, readMinutes, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, listWords, titlesOf } from './games.ts';
import { SEO_DATES, SEO_NAME, SEO_URL, appWord, gameLink, games, moreSection, otherOf, seoFile } from './seo-shared.ts';

export function seoFriendsEn(): PageSpec {
  const lang = 'en';
  const c = gameCounts();
  const live = titlesOf((g) => g.live, lang);
  const all = games(lang);
  const liveLinks = listWords(all.filter((g) => g.live).map((g) => gameLink(g, lang)), lang);
  const shareLinks = listWords(all.filter((g) => g.local2).map((g) => gameLink(g, lang)), lang);
  const word = (key: string): string => appWord(lang, key);

  const sections: Section[] = [
    {
      id: 'room',
      title: 'Race live in an online room',
      html: `${ol([
        `<strong>Make a profile.</strong> Open ${word('nav.friends')} and choose &ldquo;${word('social.intro.cta')}&rdquo;. The app asks your age group once and gives you a friend code that looks like BA-7K2Q4X. It needs no e-mail address and no password.`,
        '<strong>Add your friend.</strong> Send your friend code or your invite link. When your friend accepts, you are friends.',
        `<strong>Start a room.</strong> The host picks the game. The games with a live race are ${liveLinks}.`,
        `<strong>Invite people.</strong> Send the invite link, the ${F.ROOM_CODE_CHARS}-character room code or the QR code. A room holds ${F.SEATS.min} to ${F.SEATS.max} players.`,
        '<strong>Get ready.</strong> Every camera gets ready first. When everyone is ready, the round starts for all of you at once.',
      ])}
<p>During a race your device tells the others your score and a skeleton of ${F.SHARED_JOINTS} joints, about ${F.SHARE_HZ} times a second. That is a stick figure, not a picture. Your camera video stays on your device unless you choose to share it.</p>`,
    },
    {
      id: 'screen',
      title: 'Two people on one screen',
      html: `<p>In ${c.local2} of the ${c.total} games, two people can share one camera: ${shareLinks}. You need a big screen such as a laptop, a desktop or a TV, and it is not offered on phone-sized screens. Player 1 stands on the left and Player 2 on the right, about 1 metre apart and about 3 metres from the screen. Each of you gets your own score.</p>`,
    },
    {
      id: 'ghost',
      title: 'Races against a recording, and weekly boards',
      html: `<p>You can race a ghost at any time, with nobody else online: your own best run, a friend&rsquo;s run, or a practice partner, which is a bot. The app always says which one it is, and nobody is shown as live when they are not. After a round in a private room your friends can keep your run as a recording to race against later. It holds what you did at each obstacle and no picture.</p>
<p>Once you have a profile, your best score in each game and week goes to a board of your friends and a board of players in your country and age group. A new week starts every Monday. Boards list real players only and carry no prizes.</p>`,
    },
    {
      id: 'ages',
      title: 'Who can play online',
      html: ul([
        `<strong>Under ${F.AGE.online}:</strong> no online profile. The games work on the device only, and the app sends nothing about the child to the friends service. Younger players can still play on their own device, including two on one camera.`,
        `<strong>${F.AGE.online} to 17:</strong> generated names, preset messages, friends added only by code or link, and never video or typed text.`,
        `<strong>${F.AGE.video} and over:</strong> typed chat in a private room where everyone is ${F.AGE.video} or older, and optional video between friends there.`,
        `<strong>Between the groups:</strong> an adult cannot send a friend request to a player under ${F.AGE.video}.`,
      ]),
    },
    {
      id: 'see',
      title: 'Who sees what',
      html: `<p>Friends see your display name and whether you are online. Nobody can search for you: people find you only through your friend code or invite link, or in a public lobby of your age group. In a public lobby you meet players of your age group at your level. They see a skeleton in your colour and your display name, and they can send you preset messages and reactions, never video or typed text.</p>
<p>Video between friends is optional and off by default. It works only in a private room where everyone is ${F.AGE.video} or older, when both friends switch it on. Either of you can turn it off at any time. The picture goes from device to device, encrypted, and nobody records it. If your devices cannot reach each other directly, no picture is shown and the game goes on with your skeleton.</p>
<p>To report or block someone, open the menu of a player in a room or on your friends list. Every report goes into a queue that we read, and serious ones come first.</p>`,
    },
    {
      id: 'limits',
      title: 'What to expect',
      html: ul([
        `Live races exist in ${c.live} games, ${liveLinks}, and both are free.`,
        'You need a connection. Friends, rooms and boards do not work offline.',
        `A room closes ${F.ROOM_EMPTY_MINUTES} minutes after the last player leaves, and ${F.ROOM_IDLE_HOURS} hours after its last activity at the latest.`,
        'Each player uses their own camera and their own space. One camera misses a move now and then, and the results screen says why a move did not count.',
      ]),
    },
  ];

  const faq = [
    {
      q: 'Do my friends need Pro to play with me?',
      a: `<p>No. ${live}, the two games with live races, are free games.</p>`,
    },
    {
      q: 'How many people can be in a room?',
      a: `<p>${F.SEATS.min} to ${F.SEATS.max} players. The host picks the game, everyone gets ready, and the round starts for all of you at once.</p>`,
    },
    {
      q: 'How do I find a friend if I do not have their code?',
      a: '<p>You cannot search for people. Ask for their friend code or invite link, or have them send you a room link or room code. In a public lobby you meet players of your age group at your level, who appear as skeletons.</p>',
    },
    {
      q: 'Can my child play online with friends?',
      a: `<p>Not under ${F.AGE.online}: there is no online profile for younger players. From ${F.AGE.online} to 17 the profile uses generated names and preset messages. Younger players can still play the games on their own device, including two on one camera.</p>`,
    },
    {
      q: 'Can my friends see me?',
      a: `<p>Only as a skeleton, unless you are both ${F.AGE.video} or older, in a private room, and you both switch video on. It is off by default and either of you can turn it off.</p>`,
    },
  ];
  sections.push({ id: 'faq', title: 'Questions people ask', html: faq.map((i) => qa(i.q, i.a)).join('\n') }, moreSection(lang, 'friends'));

  const title = 'Workout games to play with friends online';
  const description = `Race a friend live in ${live}, share one camera on one screen, or race a friend’s recorded run. How rooms, friend codes and ages work.`;
  const lead = `You can play BodyArcade with other people in three ways. Online, you join a room of up to ${F.SEATS.max} players and race live in ${live}. On one screen, two people share a single camera in ${c.local2} of the ${c.total} games. On your own, you can race a recording of a friend&rsquo;s run. Nobody needs an e-mail address or a password.`;
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: seoFile(lang, 'friends'),
    url: SEO_URL[lang].friends,
    lang,
    other: otherOf(lang, 'friends'),
    og: 'article',
    title,
    description,
    h1: title,
    when: `Updated ${F.longDate(SEO_DATES.modified, lang)} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: true,
    after: cta('Open Friends, make a profile and send your friend code to someone who has a camera.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: SEO_NAME[lang].friends.name, url: SEO_URL[lang].friends }],
    jsonLd: [
      articleLd({ headline: title, description, url: SEO_URL[lang].friends, published: SEO_DATES.published, modified: SEO_DATES.modified, lang }),
      faqLd(faq),
    ],
  };
}
