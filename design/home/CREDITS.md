# Home page loops: sources and licences

Every loop in this folder is a real round of a BodyArcade game, recorded headless with `tools/fake-camera` (the game read the
person in a stock video as its camera). The people are real people from free stock videos on Pexels. None of them is a
customer, and nothing here says they are; the page says where they come from (`home.reel.credit`).

Licence of every source: [Pexels License](https://www.pexels.com/license/). Free for commercial use, no attribution required.
It may not be sold unaltered, and it may not imply that the person endorses the product.

| Loop | Game | Source video | Creator |
|---|---|---|---|
| `squat-*`, `squat-cam-*` | Squat Flap | [Pexels 4838220](https://www.pexels.com/video/4838220/), woman squatting with a resistance band | Pexels contributor |
| `knee-*` | Knee Sprint | [Pexels 6326808](https://www.pexels.com/video/man-exercising-high-knees-6326808/), "Man Exercising High Knees" | Pavel Danilyuk |
| `jacks-*` | Firework Jacks | [Pexels 7299359](https://www.pexels.com/video/elderly-man-doing-jumping-jacks-outside-7299359/), "Elderly Man Doing Jumping Jacks Outside" | Kindel Media |
| `pad-*` | Pad Work | [Pexels 6296168](https://www.pexels.com/video/a-man-doing-shadow-boxing-6296168/), "A Man Doing Shadow Boxing" | Pavel Danilyuk |
| `duo-*` | Firework Jacks, two players on one camera | [Pexels 6326725](https://www.pexels.com/video/men-doing-jumping-jacks-at-the-gym-6326725/), "Men Doing Jumping Jacks at the Gym" | Pavel Danilyuk |

How they were made (3 November 2026):

- Each source was given a 3 second still of its own first standing picture at the start (8 seconds for the two players), because the
  game asks the player to hold still before a round. Squat Flap's source runs at 1.3 times its speed.
- The rounds were recorded at device scale 2 (864 by 1536) or 1.5 (1920 by 1080), with the score, the timer and the hints hidden
  and the player's own camera window made larger, then cut to a 6.5 to 7.5 second window with a 0.4 second cross-fade at the seam.
- `squat-cam-*` is the camera picture of the same moment as `squat-*` (the source at the same speed and time), for the scroll stage
  where the camera picture shrinks into the game's corner window.
- The loops whose game shows words (`squat`, `knee`, `jacks`, `pad`, `duo`) were recorded again with the game in Turkish
  (`<loop>-tr-*`) for the Turkish page, from the same sources.
- Encoded as VP9 WebM and H.264 MP4 in two widths each, with a WebP poster of the first picture.
