# Pad Work: the coach's voice, sources and licences

The coach's calls (`en/*.mp3`, `tr/*.mp3`, listed with their words in `clips.json`) are synthetic speech.

## How they were made

- Engine and model: **Supertonic 3**, by Supertone Inc. (<https://huggingface.co/Supertone/supertonic-3>), run on this computer with ONNX Runtime.
  No cloud service, no account, nothing sent anywhere. The voice is one of the ten preset voice styles the model comes with, `M1` (named in
  `voice-script.json`); it is not the voice of any real person and nothing was cloned.
- Licence of the model: **BigScience OpenRAIL-M** (the `LICENSE` file of the model repository; the sample code of the Supertonic SDK is MIT).
  What matters for these files:
  - Section 6: the licensor claims no rights in the output. The model itself is not shipped with BodyArcade, only the audio it made, so the
    conditions of section 4 (passing on the model and the use restrictions) do not apply to the files.
  - Attachment A (e): machine-generated content must be disclosed as machine generated. BodyArcade does so: the game page says the coach
    is a synthetic voice (`catalogue.about` of `../manifest.json`), and this file says so.
  - The other use restrictions (unlawful use, harming minors, impersonation, deception ...) are not in play: the clips are the words of a
    boxing trainer counting punches.
- Post-processing: `render-voice.py` (trimming, loudness, a high-pass and a light compressor through ffmpeg, mp3 by LAME). Checked with
  `verify-voice.py` (faster-whisper hears each clip and the words are compared). Neither tool ships with the game.
- If a clip cannot be loaded or decoded, the game falls back to the browser's own speech synthesis (the voices of the player's device), but
  only in a language the device has a voice for; that voice belongs to the device's maker and is never stored or sent by BodyArcade.

## Remaking them

See the head of `render-voice.py`. The wording is in `voice-script.json`; `clips.json` is written by the script and read by the game
(lengths, sizes, hashes) and by its tests, which also check that the captions in `../../target/strings.ts` say exactly what each clip says.
