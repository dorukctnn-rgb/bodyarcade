# BodyArcade layout system

For the UI builder (packages/core/ui, packages/web) and the game builders (packages/games). It answers one rule from Doruk (23 Oct 2026): the player's own camera view stays small, the game and its HUD stay visible, and nothing looks out of proportion on any screen.

- Reference code: `design/tokens/layout.mjs` (pure functions, no DOM). Port it as is; keep the numbers.
- CSS version of the same sizes: `design/tokens/tokens.css` (`--ba-hud-*`, `--ba-pip-*`).
- Living mockup: `design/ui-kit/hud.html?mode=scene|live-friend|live-ghost|mirror&corner=bottom-right`.
- Proof: `node design/tools/check-hud.mjs` renders 10 screens x 7 modes, reads every HUD box from the real DOM and fails on any overlap, any box outside the screen, text spilling out of a plate, a reason longer than two lines, or a command under 8 % of the screen height. `node design/tools/layout-table.mjs` then rewrites the tables below.

## 1. Words used here

- Screen: the browser viewport in CSS px (w x h). Portrait when h > w.
- Class: `phone` when the short side is under 500 px, `large` from 1000 px (TV browsers), otherwise `medium`.
- Safe insets: `env(safe-area-inset-*)` on phones; on `large` screens add the TV title-safe margin of 5 % per side (Android TV overscan guideline). The mockups use the typical values in the table.
- Margin and gap: margin = clamp(12, 3 % of the short side, 40); gap = clamp(8, 1.5 % of the short side, 20).

## 2. HUD anatomy

```
 +--------------------------------------------------+
 | [score 12 pipes]      [ Squat ]      [0:47  ||]  |  top row: status, command, status
 |                                                  |  (the command drops under the row
 |                 play area                        |   when it does not fit between)
 |                                                  |
 |      [ Hips 4 cm above the line ]   +--------+   |  bottom row: reason strip and
 |                                     |  you   |   |  the self view in a corner
 +-------------------------------------+--------+---+
```

Every HUD element is a plate: ink at 86 % (`--ba-hud-plate-bg`) with chalk text, except the command, which is the flush plate with ink text (5.5:1). Plates never use a glow or a gradient; they must read on a bright window as well as on a dark room.

## 3. Sizes (formulas)

| Element | Rule | Why |
|---|---|---|
| Command | font-size = max(8 % of h, phone floor); phone floor 44 px in portrait, 52 px in landscape | Read from 2 to 3 m. 8 % of height is the game-design rule; a phone in landscape is only about 70 mm tall, so it needs a physical floor |
| Command fallback for long words | 1) shrink, never below 8 % of h, 2) hide the move glyph, 3) wrap at a soft hyphen (two lines) | German and Turkish words are long; the size rule still holds |
| Score and timer numerals | clamp(28, 4.2 % of h, 60), National Park 800, tabular figures | Secondary to the command; tabular figures stop the timer from jittering |
| Labels under numerals | clamp(13, 0.4 x numeral, 22) | |
| Reason strip | clamp(18, 3 % of h, 36), two lines at most | Every miss is explained, but during play the line stays short |
| Self view (portrait) | width = clamp(96, 30 vw, 240); height = width / camera aspect; height capped at 22 % of h | Small, keeps the camera aspect (3:4 in portrait) |
| Self view (landscape) | height = clamp(72, 24 vh, 220); width = height x camera aspect; width capped at 24 % of w | Same idea with the 4:3 frame |
| Live: friend or ghost tile | 1.15 x the self view, capped at half the screen width minus 24 px | The other player is bigger than you |
| Live: your own view | 0.72 x the self view | You only need to check your framing |

## 4. Placement rules, in order

1. Status plates in the top corners, inside margin + safe insets: score cluster left, timer and pause right.
2. Command: centred in the top row when it fits between the two status plates with a gap on both sides; otherwise centred directly under the top row.
3. Self view (scene games): a corner. Default bottom right. The player can move it to any corner or hide it (Settings and the small button on the view). Top corners sit under the top row and under the command if they would touch it. The camera aspect is kept; the view is never stretched or cropped to a different shape.
4. Reason strip: bottom centre. With a self view at the bottom it goes into the free span beside the view when the text fits there in two lines; otherwise it is lifted above the view and gets the full width. It is never cut short. In landscape mirror games it goes into the side band beside the mirror when that band is at least 180 px wide.
5. Play area: whatever is left between the top row (and command) and the bottom row. Games keep the player character, targets and the next obstacle inside it (`rects.play`). The self view may cover scenery and ground, never the play area of the moment.

Never covered: the score, the timer, the command, the reason. The check script fails the build if any two of these, or any of them and a tile, touch.

## 5. Which games use what

| Template | Scene | Self view | Notes |
|---|---|---|---|
| A Runner 3D (Road Run, Knee Sprint) | 3D world | corner, default bottom left (the road and runner are centred) | Ghost runners are drawn in the world, not as tiles |
| B Flight (Squat Flap) | 2D scene | corner, default bottom right, over the ground band | Columns spawn with their gap inside the play area |
| C Target hit (Star Catch, Pad Work, Reaction Tag) | camera mirror | none: the mirror is the scene | Targets are placed inside the mirror rect, never under a plate |
| D Rhythm (Firework Jacks rhythm mode) | camera mirror or 2D | none or corner | Same as C when mirrored |
| E Strength and reps (Firework Jacks, Twist Turbine, Summit Climb) | 2D scene | corner, default bottom left | The payoff (fireworks, city, cliff) fills the play area |
| F Gate and pose (Limbo Bend, Pose Wall) | 2D or 3D scene with your skeleton in the gate | corner, default bottom right | The skeleton in the gate is the main view of you; the self view is only a check |
| G Balance and hold | 2D scene | corner, default bottom right | |
| H Duel | as the template it borrows | live tiles | |

## 6. Mirror games

The whole camera frame is fitted inside the play area (contain, centred). The space around it is the stage colour (night), never a stretched or blurred copy of the camera. In portrait this leaves bands above and below for the HUD; in landscape the bands are at the sides and the reason strip can use the right one. Targets, pads and stars are positioned in mirror coordinates, so they are never under a plate.

## 7. Live matches

- Friend room with camera: only when both players turned their camera on (off by default, 18+). Your own view bottom left at 0.72 x, the friend's tile bottom right at 1.15 x. A flush dot and the name on the tile while their camera is on; their score as a sky badge in the tile's top right.
- Stranger (quick match): no video and no image at all. The tile shows the other player's skeleton (sky on night) and the label "<name>, skeleton only".
- The reason strip is lifted above the tiles on portrait phones (the span between two tiles is too narrow).
- If the friend turns the camera off mid-match, the tile switches to their skeleton without moving.

## 8. Text budgets for translators

- Command: one or two words. A word over 8 letters must carry a soft hyphen (U+00AD) at a syllable break, for example `Knie­beugen`. At the narrowest screen (360 px) a one-line command holds about 8 letters at the 8 % size.
- Reason during play: at most 40 characters in English, 48 in translations. The full sentence goes to the results screen.
- Labels under numerals: one word.
- The check script fails when a reason needs a third line, so a long translation is caught before release.

## 9. Breakpoints: HUD

<!-- generated:hud-tables -->
### Sizes

| Screen | Class | Safe insets (t / r / b / l) | Margin | Gap | Command | Command / height | Score and timer | Labels | Reason |
|---|---|---|---|---|---|---|---|---|---|
| Phone portrait 360 x 780 | phone | 28 / 0 / 20 / 0 | 12 | 8 | 63 px | 8.1 % | 33 px | 13 px | 23 px |
| Phone portrait 390 x 844 | phone | 28 / 0 / 20 / 0 | 12 | 8 | 68 px | 8.1 % | 35 px | 14 px | 25 px |
| Phone portrait 412 x 915 | phone | 28 / 0 / 20 / 0 | 12 | 8 | 74 px | 8.1 % | 38 px | 15 px | 27 px |
| Phone landscape 844 x 390 | phone | 0 / 32 / 16 / 32 | 12 | 8 | 52 px | 13.3 % | 28 px | 13 px | 18 px |
| Phone landscape 915 x 412 | phone | 0 / 32 / 16 / 32 | 12 | 8 | 52 px | 12.6 % | 28 px | 13 px | 18 px |
| Tablet portrait 768 x 1024 | medium | 0 | 23 | 12 | 82 px | 8.0 % | 43 px | 17 px | 31 px |
| Tablet landscape 1024 x 768 | medium | 0 | 23 | 12 | 62 px | 8.1 % | 32 px | 13 px | 23 px |
| Laptop 1280 x 800 | medium | 0 | 24 | 12 | 64 px | 8.0 % | 34 px | 14 px | 24 px |
| Laptop 1440 x 900 | medium | 0 | 27 | 14 | 72 px | 8.0 % | 38 px | 15 px | 27 px |
| TV 1920 x 1080 at 2.5 m | large | 54 / 96 / 54 / 96 | 32 | 16 | 87 px | 8.1 % | 45 px | 18 px | 32 px |

### Positions (rendered, CSS px, origin top left, default corner bottom right)

| Screen | Self view (scene games) | Command row | Reason row | Live: your view | Live: friend or ghost | Mirror (target, rhythm) |
|---|---|---|---|---|---|---|
| Phone portrait 360 x 780 | 108 x 144 at 240, 604 | under the top row | above the self view | 78 x 104 at 12, 644 | 124 x 166 at 224, 582 | fits the play area |
| Phone portrait 390 x 844 | 117 x 156 at 261, 656 | under the top row | above the self view | 84 x 112 at 12, 700 | 135 x 179 at 243, 633 | fits the play area |
| Phone portrait 412 x 915 | 124 x 165 at 276, 718 | under the top row | above the self view | 89 x 119 at 12, 764 | 143 x 190 at 257, 693 | fits the play area |
| Phone landscape 844 x 390 | 125 x 94 at 675, 268 | in the top row | beside the self view | 90 x 68 at 44, 294 | 144 x 108 at 656, 254 | fits the play area |
| Phone landscape 915 x 412 | 132 x 99 at 739, 285 | in the top row | beside the self view | 95 x 71 at 44, 313 | 152 x 114 at 719, 270 | fits the play area |
| Tablet portrait 768 x 1024 | 169 x 225 at 576, 776 | under the top row | beside the self view | 122 x 162 at 23, 839 | 194 x 259 at 551, 742 | fits the play area |
| Tablet landscape 1024 x 768 | 246 x 184 at 755, 561 | in the top row | beside the self view | 177 x 132 at 23, 613 | 283 x 212 at 718, 533 | fits the play area |
| Laptop 1280 x 800 | 256 x 192 at 1000, 584 | in the top row | beside the self view | 184 x 138 at 24, 638 | 294 x 221 at 962, 555 | fits the play area |
| Laptop 1440 x 900 | 288 x 216 at 1125, 657 | in the top row | beside the self view | 207 x 156 at 27, 717 | 331 x 248 at 1082, 625 | fits the play area |
| TV 1920 x 1080 at 2.5 m | 293 x 220 at 1499, 774 | in the top row | beside the self view | 211 x 158 at 128, 836 | 337 x 253 at 1455, 741 | fits the play area |

Rendered check: 70 layouts (10 screens x 7 modes), 0 with problems. Screenshots: `design/shots/hud/<mode>-<screen>.webp`.
<!-- /generated:hud-tables -->

## 10. Breakpoints: menus and catalogue (shell)

Page gutter = max(clamp(16, 4 vw, 48), safe insets). Content width caps at 1240 px (1560 px from 1680 px wide). Game grid: 2 columns under 600 px, 3 under 900 px, 4 under 1680 px, 5 above. Grid gap clamp(12, 2 vw, 24). Landscape phones use a 76 px side rail instead of a bottom tab bar, so the little height they have goes to content.

<!-- generated:shell-table -->
| Screen | Navigation | Page gutter | Content width | Game grid | Grid gap | Game tile (art 4:3) |
|---|---|---|---|---|---|---|
| Phone portrait 360 x 780 | bottom tab bar | 16 | 328 | 2 columns | 12 | 158 x 119 |
| Phone portrait 390 x 844 | bottom tab bar | 16 | 358 | 2 columns | 12 | 173 x 130 |
| Phone portrait 412 x 915 | bottom tab bar | 16.5 | 379 | 2 columns | 12 | 184 x 138 |
| Phone landscape 844 x 390 | side rail | 33.8 | 700 | 3 columns | 16.9 | 222 x 167 |
| Phone landscape 915 x 412 | side rail | 36.6 | 766 | 4 columns | 18.3 | 178 x 133 |
| Tablet portrait 768 x 1024 | bottom tab bar | 30.7 | 707 | 3 columns | 15.4 | 225 x 169 |
| Tablet landscape 1024 x 768 | top bar | 41 | 942 | 4 columns | 20.5 | 220 x 165 |
| Laptop 1280 x 800 | top bar | 48 | 1184 | 4 columns | 24 | 278 x 209 |
| Laptop 1440 x 900 | top bar | 48 | 1240 | 4 columns | 24 | 292 x 219 |
| TV 1920 x 1080 at 2.5 m | top bar | 96 | 1560 | 5 columns | 24 | 293 x 220 |
<!-- /generated:shell-table -->

TV: a 1920 x 1080 browser can be a desk monitor or a TV across the room, and the size alone does not tell. Big text mode (Settings, on by default when the user agent is a TV platform or the player picks "I play on a TV") sets the root font size to 150 % and the grid to 4 columns; the HUD needs no change because it already scales with the screen height.

## 11. Onboarding and other full-screen steps

Onboarding steps use the shell gutter and a fixed split: on portrait screens the 3D or illustration area takes the top 46 to 52 % of the height and the text block sits below it; on landscape screens the 3D area takes the left 55 % and the text block the right 45 %, vertically centred. The primary button is always visible without scrolling at every breakpoint above (checked by `design/tools/check-pages.mjs`).
