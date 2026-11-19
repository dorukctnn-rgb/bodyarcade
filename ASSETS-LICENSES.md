# Assets of the sports home page: sources and licences

Every file the November 2026 home page redesign added, where it came from and under which licence. Nothing here is paid, nothing is
AI-generated, and no stock person is presented as a BodyArcade player: the hero says "Example footage" on the clip, and no name or
quote is put on anyone.

## Stock footage

| Our files | Source | Licence | What we did |
|---|---|---|---|
| `design/art/clips/arena-wide-1280.mp4`, `.webm`; posters `design/art/hero/arena-wide-1280.avif`, `.webp`; `design/art/hero/final-wide-1280.webp` | Mixkit 52316, "A young shirtless man on his fitness training session doing jumping lunges at the gym": https://mixkit.co/free-stock-video/a-young-shirtless-man-on-his-fitness-training-session-doing-52316/ | Mixkit Stock Video Free License (https://mixkit.co/license/#videoFree), commercial use, no attribution required. Page read on 19 Nov 2026; it is not marked "Restricted" and not marked AI-generated. | First 10 s, cropped (1600x900 at 320,100), scaled to 1280x720, desaturated and darkened, re-encoded (H.264 and VP9, no sound). The final still is the frame at 6 s. |
| `design/art/clips/arena-tall-720.mp4`, `.webm`; posters `design/art/hero/arena-tall-720.avif`, `.webp`; `design/art/hero/final-tall-720.webp`; `design/art/hero/how-camera-640.webp`, `how-move-640.webp` | Mixkit 52106, "A young woman wearing a black sportswear outfit performs squats holding a russian dumbbell on her fitness routine": https://mixkit.co/free-stock-video/a-young-woman-wearing-a-black-sportswear-outfit-performs-squats-52106/ | Mixkit Stock Video Free License, as above. Page read on 19 Nov 2026; not "Restricted", not marked AI-generated. | First 8 s, cropped (864x1080 at 528,0), scaled to 720x900, desaturated and darkened, re-encoded. The "how it works" stills are single frames of it, one with our body line drawn over it. |

Mixkit's terms forbid selling the clips unchanged and redistributing them as stock; we only show our edited encodes on our own pages.

## Our own pictures

| Files | What they are |
|---|---|
| `design/art/hero/cap-<game>-480.webp`, `cap-<game>-960.webp` (11 games) | Frames of each game in play, rendered by our own game engine in a headless browser (`node tools/gfx-shots/run.ts <out> --clean --sizes=1280x800 --quality=high`, keyboard input), cut to 4:3. |
| `design/art/hero/how-score-640.webp` | A frame of Pose Wall in play with its HUD (the shape to match), same tool without `--clean`, cut to 4:5. |
| `packages/web/src/hero-pose/arena-*.json` | The body points of the two hero clips, read by MediaPipe's pose landmarker (`pose_landmarker_heavy`, Apache-2.0, run once offline through our own trace tool: `tools/hero-pose/extract.ts`, then `compact.ts`). Only the points ship; the model does not. |

## Font

| File | Source | Licence |
|---|---|---|
| `packages/web/src/styles/fonts/anton-subset.woff2` (and `site/assets/fonts/anton-subset.woff2` for the content pages) | Anton by The Anton Project Authors, https://github.com/googlefonts/AntonFont (file from https://github.com/google/fonts/tree/main/ofl/anton) | SIL Open Font License 1.1, full text in `packages/web/src/styles/fonts/OFL-Anton.txt`. Subset with fontTools to Basic Latin, Latin-1 and Latin Extended-A (Turkish, German, Polish, French and Spanish letters) and a few punctuation marks; the subset keeps the name "Anton" as the OFL allows for an unmodified font's subset served as a web font. |
