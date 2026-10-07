# BodyArcade: media brief

Everything on the site is captured from the real game: the ten worlds (`site/assets/worlds/*.webp`, HUD hidden), the hero and "run" frames with the HUD (`site/assets/screens/hero.webp`, `run.webp`), the start screen, the camera-check screen with the skeleton overlay, a phone-portrait frame and the results screen. The social preview (`site/assets/og.jpg`) is rendered from a Sunset frame with the wordmark.

What the site still can't show is a **real person playing**: the one thing a first-time visitor most wants to see before allowing camera access. These assets would add the most, in priority order. None of them should be staged with stock footage or generated people; the value is that they are real.

---

## 1. Split-screen play clip (highest impact)

**Where:** Hero, replacing the still gameplay frame. Also usable as the social preview video and in the "Let the camera see you" step.

**What:** 10–12 seconds with a person on the left, filmed from behind or beside the laptop, doing a jump, a squat and a lean. On the right, the screen recording of the same moments, with the prompt ring and obstacles cleared in sync. The new camera-check screen (skeleton drawn over the mirrored preview) is worth two seconds of its own.

- **Capture:** Film the player with a phone at 1080p/60 on a tripod, from roughly the laptop camera's height, 2–3 m away. Record the screen with OBS at 1920×1080/60 at the same time. Sync in the edit using a jump.
- **Location:** A real living room or bedroom with daylight from a window in front of or beside the player. Everyday workout clothes. The player should look like a customer, not a model.
- **Consent:** Signed release from anyone on camera; a guardian's consent for minors.
- **Delivery:**
  - `site/assets/video/play-split.mp4` (H.264, CRF 24, 1600×900, no audio, ≤ 4 MB)
  - `site/assets/video/play-split.webm` (VP9, CRF 34)
  - `site/assets/video/play-split.jpg` (poster, first frame)
- **Loop:** Start and end on the player standing still in the calibration outline.

## 2. Three real session photos

**Where:** The "How a run works" steps (replacing the start and camera-check UI stills) and the "Reasons to come back" section.

**What:** Stills of people actually playing: a squat in front of a laptop on a coffee table, a phone propped on a shelf at hip height, two friends comparing a challenge link on two devices. Shoot from behind or to the side so the screen is visible.

- **Delivery:** 2400 px wide JPEG masters. The site uses WebP at 1400 and 800 px, 16:9.

## 3. 60-second real-run screen capture

**Where:** YouTube or social, embedded in the webcam-fitness-games guide. Also useful as a video sitemap entry.

**What:** One uninterrupted Medium run in the Sunset world with the camera on: the camera check, the countdown, obstacles, the score climbing and the results screen with the "Run again" button.

---

### What not to use

- Generated images of people exercising.
- Stock "family jumping in living room" photos.
- Any clip from other fitness games.
- Screenshots of the old build (first-person road, orange barricades, neon UI).

The page's trust comes from the fact that everything on it is the real product.
