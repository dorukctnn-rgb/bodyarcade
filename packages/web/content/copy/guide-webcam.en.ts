// Guide: how webcam fitness games work and how to set up a room (English). The distances are the ones the app tells the player
// (core/ui/i18n/en.ts), the games and their counts come from the catalogue; content.test.ts keeps both honest.
import { articleLd, cta, readMinutes, table, ul, type PageSpec, type Section } from '../chrome.ts';
import * as F from '../facts.ts';
import { gameCounts, roundLength } from './games.ts';

export const GUIDE_WEBCAM_EN = { published: '2026-10-07', modified: F.UPDATED };

export function guideWebcamEn(): PageSpec {
  const c = gameCounts();
  const sections: Section[] = [
    {
      id: 'how',
      title: 'How a browser reads your body',
      html: `<p>Modern browsers can run small machine-learning models on your own device. The one most webcam games use for bodies is a pose landmarker. It takes a camera frame and returns the position of ${F.MODEL_POINTS} points on your body, such as the nose, shoulders, elbows, wrists, hips, knees and ankles, as coordinates in the frame. BodyArcade uses Google&rsquo;s MediaPipe Pose Landmarker. It runs in a background thread of the page where the browser allows it, on your graphics chip when the device has usable graphics acceleration and on the processor when it does not. The video frames are not sent anywhere.</p>
<p>A game does not need all ${F.MODEL_POINTS} points. It picks a few stable ones and reads simple relationships between them:</p>
${ul([
  '<strong>Squat:</strong> your hips drop a long way below their standing height, then rise again (Squat Flap).',
  '<strong>Knee lift:</strong> a knee comes up towards your hip, one leg after the other (Knee Sprint).',
  '<strong>Jumping jack:</strong> arms and feet go out together, then come back (Firework Jacks).',
  '<strong>Twist and side bend:</strong> your shoulders turn against your hips, or tilt sideways over them (Twist Turbine, Limbo Bend).',
  '<strong>Reach and pull:</strong> a hand goes above its shoulder, then comes down towards it (Summit Climb).',
  '<strong>Hit:</strong> a hand arrives at a target on the screen (Star Catch, Pad Work, Reaction Tag).',
  '<strong>Shape:</strong> your body matches a pose before a wall reaches you (Pose Wall).',
])}`,
    },
    {
      id: 'you',
      title: 'Measured against your own body',
      html: `<p>The camera does not know how tall you are or how far away you stand, so a good game measures everything against your own body. Before a game, BodyArcade asks you to stand where you will play and measures your height, your arm reach and a comfortable squat depth. A squat then means the same physical thing for a child and for a tall adult. Games that skip this step and use fixed pixel thresholds tend to work for the person who made them and for nobody else.</p>`,
    },
    {
      id: 'limits',
      title: 'What one camera reads well, and what it does not',
      html: `<p><strong>Reliable:</strong> large moves of large body parts. Squats, knee lifts, jumping jacks, twists, side bends, reaching overhead and stepping all survive a cheap camera, uneven light and a cluttered room.</p>
<p><strong>Less reliable:</strong> fine hand positions and finger gestures, very fast moves, anything hidden behind a table or another person, and movement towards or away from the camera, because one camera has no real sense of depth.</p>
<p>A game built around what a camera sees well, with a small set of clear moves, beats one with twenty moves that register half the time. When a move does not count, a good game says why. BodyArcade lists a reason for every miss, for example &ldquo;Hips not low enough&rdquo; or &ldquo;Your hands were out of view&rdquo;, so you can fix the cause and not guess.</p>`,
    },
    {
      id: 'room',
      title: 'Set up a room that works the first time',
      html: `${ul([
  '<strong>Space.</strong> Clear about 2 metres around you and play on a floor that is not slippery.',
  '<strong>Distance.</strong> For whole-body games your head to your ankles must be in view: stand 2 to 3 metres from a laptop or 1.5 to 2 metres from an upright phone. For upper-body games your head to your hips must be in view, about 1 metre away.',
  '<strong>Camera height.</strong> Hip height works best. Stand a phone upright at hip height, leaning on something steady. Tilt a laptop screen back until the camera sees your feet, then step back 2.5 to 3 metres. A laptop on the floor, pointing up, distorts your proportions.',
  '<strong>Light.</strong> Put the light in front of you or beside you, not behind you. A window behind you turns you into a silhouette and the model loses your joints.',
  '<strong>People.</strong> Only the player should be in the picture, unless you play with two. A passer-by can confuse the tracking for a moment.',
  '<strong>Clothes.</strong> Anything that contrasts with the wall behind you helps.',
  '<strong>Phones.</strong> Sideways shows more of the room, so wide moves have space; upright gives a taller picture. Turn off auto-lock so the screen does not dim in the middle of a round.',
])}`,
    },
    {
      id: 'seated',
      title: 'Seated, quiet and low impact',
      html: `<p>Not everyone can or wants to stand and jump. In BodyArcade every game has a seated version, and ${c.quiet} of ${c.total} can be played quietly, without jumping or stamping, which matters in a flat with neighbours below. At a desk the app notices when it only sees your head and shoulders and offers desk mode. A camera game that cannot be played seated shuts out many people.</p>`,
    },
    {
      id: 'compare',
      title: 'How webcam games compare with the alternatives',
      html: `${table(null, ['Option', 'What you need', 'Tracking', 'Best at'], [
  ['Browser webcam games', 'A laptop or phone with a camera and a browser', 'Whole-body poses from one camera', 'Starting in seconds, short sessions, nothing to buy to try'],
  ['Console motion games', 'A console and its controllers or accessories', 'Motion sensors in the controllers, sometimes a force sensor', 'Long structured programmes with resistance training'],
  ['VR fitness', 'A headset and clear space', 'Headset and hand controllers in 3D', 'Immersion, boxing and rhythm games, arm work'],
  ['Phone camera fitness apps', 'A phone and an app install', 'The same kind of pose model, in an app', 'Rep counting and guided workouts'],
])}
<p>Webcam games win on friction. There is nothing to buy and nothing to charge, and a round can start a minute after you decide to move. They lose on resistance, because a camera cannot make you push against anything, and on precision. If you want an easy way to raise your pulse in a living room, they fit. If you want a strength programme, look at a console title or a weights app, or use a webcam game as the warm-up.</p>`,
    },
    {
      id: 'look',
      title: 'What to look for in a webcam fitness game',
      html: `${ul([
  '<strong>On-device processing.</strong> The video should be analysed on your device and never uploaded. Read the privacy policy; if it does not say, assume it is uploaded.',
  '<strong>A calibration step.</strong> A short &ldquo;stand here&rdquo; check means the game measures you instead of guessing.',
  '<strong>Feedback you can see.</strong> A small preview with your skeleton drawn over it tells you at once whether the camera has lost you.',
  '<strong>Reasons for misses.</strong> A game that says why a move did not count lets you improve.',
  '<strong>Short rounds.</strong> Pose games tire you in a good way. A few minutes is enough before your form drops.',
  '<strong>Seated and quiet versions.</strong> They let the whole family and the neighbours join in.',
  '<strong>A way to play without the camera.</strong> Keyboard or touch controls let you try a game on a train.',
])}`,
    },
    {
      id: 'try',
      title: 'Try one now',
      html: `<p>BodyArcade has ${c.total} short games, ${c.free} of them free, with rounds from ${roundLength(c.shortest, 'en')} to ${roundLength(c.longest, 'en')}. You can play alone, two people side by side on one camera on a big screen, or with friends in an online room. The pose model runs on your device, and the video stays there.</p>
<p>Related: <a href="/ring-fit-adventure-alternative">a Ring Fit Adventure alternative you can play in a browser</a>, and <a href="/blog/why-browser-fitness-games-are-the-future">why browser fitness games are the future of home workouts</a>.</p>`,
    },
  ];
  const title = 'How webcam fitness games work, and how to set up your room';
  const description = 'How a browser reads your body with an ordinary camera, what it reads well, and how to set up your room so a webcam fitness game works the first time.';
  const lead = 'A webcam fitness game is a game you control by moving in front of an ordinary camera: the one in your laptop lid, on top of your monitor or on the front of your phone. There is no controller, no wristband and no console. The camera watches, software turns what it sees into a few body positions, and the game reacts to them the way it would react to a button press.';
  const minutes = readMinutes(lead + sections.map((s) => s.html).join(' '));
  return {
    file: 'webcam-fitness-games.html',
    url: '/webcam-fitness-games',
    lang: 'en',
    other: { lang: 'tr', url: '/tr/kamera-ile-spor-oyunlari' },
    nav: 'blog',
    og: 'article',
    title,
    description,
    h1: title,
    when: `Updated ${F.longDate(GUIDE_WEBCAM_EN.modified, 'en')} &middot; ${minutes} min read`,
    lead: `${lead} This guide explains how that works in a browser, what it can and cannot read, and how to set up a room. We make BodyArcade, so we use it as the example; the advice applies to any game that uses a camera.`,
    sections,
    toc: true,
    after: cta('Open a game, allow the camera, step back and move. The first round takes a couple of minutes.', '/', 'Play a game'),
    crumbs: [{ name: 'BodyArcade', url: '/' }, { name: 'Blog', url: '/blog/' }, { name: 'Webcam fitness games', url: '/webcam-fitness-games' }],
    jsonLd: [articleLd({ headline: title, description, url: '/webcam-fitness-games', published: GUIDE_WEBCAM_EN.published, modified: GUIDE_WEBCAM_EN.modified, lang: 'en' })],
  };
}
