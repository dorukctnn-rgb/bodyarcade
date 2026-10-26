# Fake camera: any video as the camera, a real game, a clean capture

Plays a real round of a real BodyArcade game with a local video as the camera, then saves the screen as `capture.mp4`
and a `timeline.json` that says when everything happened. Headless only: no window opens, nothing is left running.

Typical uses: the promo videos (an AI clip of a person is fed to the real game as the camera, see `VIDEO-PLAN.md`),
the final test of a game against a person who moves in a known way, and a repeatable "camera run" for bug reports.

## Quick start

```
node tools/fake-camera/run.ts --video my-clip.mp4 --game road-run
node tools/fake-camera/run.ts --video two-people.mp4 --game squat-flap --mode local2 --size 1920x1080
npm run qa:fakecam -- --video my-clip.mp4 --game knee-sprint --seated --until 60
```

Result in `tools/fake-camera/out/<video>-<game>-<mode>/` (ignored by git, keep big videos out of the repository):

| File | What |
|---|---|
| `capture.mp4` | the page only (no browser frame), constant 30 fps, H.264 |
| `timeline.json` | phases (explainer, preparing, calibrating, countdown, running, paused, results), the moment the video started, the round result, problems |
| `camera.mjpeg`, `camera.sync.json` | the converted camera file and what was done to the video |
| `failure.jpg` | picture of the page when the run failed |

Measured on 24 Oct 2026 (Road Run, a 6 s clip of a person, 640x360): the camera explainer, calibration on the person, countdown
and a running round, all in one headless Chromium, with the person visible in the self view of the capture.

## Options

| Option | Meaning |
|---|---|
| `--video <file>` | any video ffmpeg can read (mp4, webm, mov, gif, a raw .mjpeg with `--input-fps`) |
| `--game <id>` | catalogue id: `road-run`, `squat-flap`, `knee-sprint`, ... |
| `--mode solo\|local2` | `local2` = two players in front of one camera (the video must show two people; the shell offers it on big screens only, so use `--size 1280x720` or larger) |
| `--seed <n\|random>` | seed of the round, default `1`: the same obstacles, targets and particles every run. The k-th round of a run gets `seed + k` |
| `--seated`, `--quiet`, `--difficulty hard`, `--plan pro` | the setup of the round; `--plan pro` unlocks Pro games and levels |
| `--size 1280x720` | capture size (the browser window). `390x844` gives a phone portrait cut, `1920x1080` a TV cut |
| `--fps 30` | capture rate |
| `--until results\|video-end\|<seconds>` | when to stop: the results screen (default), when the video content has played once, or N seconds after the round started |
| `--max 240` | hard limit of the whole run in seconds |
| `--hide ".ba-pip-host,[data-hud=timer]"`, `--css "..."` | hide parts of the screen (the own-camera picture, the HUD) for a cleaner cut. HUD parts: `[data-hud=statusLeft]`, `statusRight`, `statusP1`, `statusP2`, `timer`, `command`, `reason`, `away`, `pip` |
| `--from <s> --to <s> --cover --mirror --camera-size 640x360 --camera-fps 30` | how the video becomes the camera (see convert.ts): the part of the video, fill instead of black bars, flip, picture size and rate |
| `--repeat <n>` | how often the video is put in the camera file (default: as often as the round needs it, see "Looping") |
| `--lang tr` | interface language of the page |
| `--url <address>` | use a server that is already running (for example a preview build) instead of the local web shell |
| `--no-capture` | no screen recording, only the run and `timeline.json` |
| `--allow-errors` | page errors do not change the exit code |

Exit codes: `0` ok, `1` the runner or ffmpeg failed, `2` the page logged errors (uncaught exception, console error, HTTP error),
`3` calibration never finished or the round could not start (the person in the video is not seen well enough, or the game
is not in this build), `4` the time limit hit.

The run starts at a lower CPU priority and with one browser; it is meant to share a busy machine.

## Converting a video on its own

```
node tools/fake-camera/convert.ts clip.mp4 --size 640x360 --from 2 --to 20 [--repeat 5] [--cover] [--mirror] [--no-leader]
```

Chromium takes MJPEG or Y4M as a camera. The converter fits the video into the camera picture, sets a fixed rate, and puts a
**sync leader** in front: 42 pictures (1.7 s) of white, black, white and black of different lengths (6, 9, 12 and 15
pictures). The game sees nobody during the leader, then the video starts, so the calibration begins after it.

## What is exact and what is not

- **Chromium plays an MJPEG file at 30 pictures per second** (the camera track says 30) when the machine keeps up, so the converter
  makes 30 fps files and the video plays at its own speed. On a starved machine the camera thread slips: on 24 Oct 2026, with the
  laptop at 100 % CPU, a run measured 25. The leader measures the real rate of every run (`camera.streams[i].playbackFps` in
  `timeline.json`); the content is then shorter or longer than its length in the file says by that ratio.
- **The start of the video in the capture.** The page script looks at the first pictures of every camera stream
  (brightness only, from a second hidden video showing the same track) and fits the leader pattern to them. `timeline.json` then has
  `camera.streams[i].videoStart` (frame 0 of the file) and `contentStart` (the video itself) in capture seconds. Typical
  accuracy: one camera picture (40 ms). If the leader is not recognised (`videoStart: null`) the start is known only to
  about 0.1 s (`openedAt`).
- **The game reacts later than the camera shows.** Pose detection and the fixed-step game add about 50 to 150 ms (more on a
  slow machine). A squat that the video shows at `contentStart + 4.0 s` is seen by the game a little later. For tight
  cuts, look at the capture itself.
- **Looping.** When the camera file ends Chromium plays it again from the start, with the leader: the game would see a flash
  and a person who left. So the file holds the video as often as the round needs (`--repeat`, worked out from the round length
  and the clip length). A clip as long as the round is better than a short clip repeated: at every repeat the person jumps
  back to the start of the clip.
- **Seed.** The seed fixes the world of the round (what the game draws from its own random streams) and `Math.random`.
  What the camera and the pose model do is as repeatable as the video and the machine are: the same clip gives
  nearly the same round, not bit for bit. The detector can differ between a GPU and a CPU machine.
- **Frame rate.** The page is recorded as it is drawn. Headless Chromium draws WebGL with a software renderer, so a heavy
  3D scene can run below 30 fps on a weak or busy machine; the capture then repeats the last picture (`capture.frames` against
  `capture.pictures` in `timeline.json` shows how many different pictures the browser produced). The screen is recorded
  in real time; it cannot be rendered faster or slower than the camera plays.
- **Sound** is not recorded. Add music or voice in the editing step.
- **Clip rights.** The converted camera file lives next to the capture in `out/`. Do not commit videos or captures.

## Files

- `convert.ts`: video to camera file plus sync leader (also importable: `convertVideo`, `contentArgs`, `leaderArgs`)
- `cam.ts`: the leader, the page script (seed, stream watcher) and the start finder; `cam.test.ts` tests them without a browser
- `phase.ts`: where a round of the shell is, read from the page (shared with `tools/perf`)
- `run.ts`: the runner
