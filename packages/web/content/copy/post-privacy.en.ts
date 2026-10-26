// Blog post: what happens to your camera video in BodyArcade (English). Follows one frame from the lens to the game and says what
// is kept at each step; every statement is one the privacy policy makes and content.test.ts checks against the code.
import { articleLd, cta, readMinutes, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';

export const POST_PRIVACY_EN = { published: F.UPDATED, modified: F.UPDATED };

export function postPrivacyEn(): PageSpec {
  const sections: Section[] = [
    {
      id: 'lens',
      title: 'From the lens to body points',
      html: `<p>When you open a game, your browser asks whether BodyArcade may use the camera. If you allow it, the browser hands each frame of the video to a pose model that runs in the page, on your device. The model returns ${F.MODEL_POINTS} points: head, shoulders, elbows, wrists, hips, knees, ankles and a few more. The game reads those points to count squats, jumps, punches and other moves. The frame is not kept after that.</p>
<p>The small picture of yourself that you see while you play is drawn on your screen from the same camera stream. It is not written to a file, and it is not sent to a server.</p>`,
    },
    {
      id: 'kept',
      title: 'What the game keeps on your device',
      html: `${ul([
  'Your results: recent rounds, best scores and your streak.',
  'Your best run of each game as a ghost, which is what you did at each obstacle and, for your own runs, your skeleton as points.',
  'Your settings, and your body weight if you entered it to see calories.',
])}
<p>All of this stays in your browser&rsquo;s storage. The Settings screen can clear it.</p>`,
    },
    {
      id: 'alone',
      title: 'What leaves your device when you play alone',
      html: `<p>Nothing about your camera. The page, the game files and the pose model are served from bodyarcade.com itself, so your browser does not contact Google or a code network to load them. The pose library tries to send Google a short usage report that contains no images; BodyArcade stops that request on your device before it leaves.</p>
<p>If you have Pro, the app asks our license service about once a day whether the plan is still active. If you made an online profile, the app talks to the friends service. Neither call carries a picture.</p>`,
    },
    {
      id: 'rooms',
      title: 'What other players receive in a room',
      html: `<p>In an online room your device tells the other players your score and a skeleton of ${F.SHARED_JOINTS} joints, about ${F.SHARE_HZ} times a second. That is a handful of coordinates, with no picture. A room is deleted ${F.ROOM_EMPTY_MINUTES} minutes after the last player leaves, and in any case ${F.ROOM_IDLE_HOURS} hours after its last activity.</p>`,
    },
    {
      id: 'video',
      title: 'The one exception: video between friends',
      html: `<p>Two friends who are both ${F.AGE.video} or older can show each other their camera in a private room. It is off by default, it works only when both of them switch it on, and either can switch it off at any time. The picture goes from device to device, encrypted, and is not recorded or stored by anyone. If the two devices cannot reach each other directly, no picture is shown and the game goes on with the skeleton.</p>`,
    },
    {
      id: 'check',
      title: 'How you can check',
      html: `<p>You do not have to take our word for it. Open your browser&rsquo;s developer tools while you play and look at the network panel: you will not find a video upload. The <a href="/privacy">privacy policy</a> lists every table our servers keep and how long each is kept. If you have a question it does not answer, write to <a href="mailto:${F.EMAIL}">${F.EMAIL}</a>.</p>
<p>To stop the camera at any time, use the camera icon in your browser&rsquo;s address bar, or close the game.</p>`,
    },
  ];
  const title = 'What happens to your camera video in BodyArcade';
  const description = 'We follow one camera frame from the lens to the game: what is read, what is kept on your device, and what other players ever receive.';
  const lead = 'A camera game raises a fair question: where does the video go? In BodyArcade it goes nowhere. This post follows a frame from the lens to the game and says what is kept at each step, so you do not have to take the headline on trust.';
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: 'blog/what-happens-to-your-camera-video.html',
    url: '/blog/what-happens-to-your-camera-video',
    lang: 'en',
    nav: 'blog',
    og: 'article',
    title,
    description,
    h1: title,
    when: `${F.longDate(POST_PRIVACY_EN.published, 'en')} &middot; ${minutes} min read`,
    lead,
    sections,
    toc: false,
    after: cta('Your first game is a couple of minutes away.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Blog', url: '/blog/' }, { name: 'Your camera video', url: '/blog/what-happens-to-your-camera-video' }],
    jsonLd: [articleLd({ headline: title, description, url: '/blog/what-happens-to-your-camera-video', published: POST_PRIVACY_EN.published, modified: POST_PRIVACY_EN.modified, lang: 'en' })],
  };
}
