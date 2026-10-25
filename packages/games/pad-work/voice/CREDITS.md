# Pad Work: the coach's voice, sources and licences

The coach's calls (`en/*.mp3`, `tr/*.mp3`, listed with their words in `clips.json`) are synthetic speech.

## Source

| What | Value |
| --- | --- |
| Model | **Supertonic 3** by Supertone Inc., on-device text to speech (ONNX), <https://huggingface.co/Supertone/supertonic-3> |
| Revision used | `724fb5abbf5502583fb520898d45929e62f02c0b` ("Initial Supertonic 3 release", 6 May 2026); the later commits of the repository change the README and the audio samples only |
| Voice | the preset voice style `M1` of the model (one of its ten fixed styles, named in `voice-script.json`); not the voice of any real person, nothing cloned, no Voice Builder style |
| Run with | `supertonic` Python SDK 1.3.1 (MIT) on ONNX Runtime 1.31.0, on this computer: no cloud service, no account, nothing sent anywhere |
| Licence of the model | **BigScience OpenRAIL-M** (the file's own title: "BigScience Open RAIL-M License"), dated 18 August 2022, <https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE> (the file in the model repository; SHA-256 `0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f`, the same as the copy checked on 25 Oct 2026). The repository's metadata only says `openrail`; the file is the text that applies |
| Licence of the SDK's sample code | MIT (not shipped) |

## What the licence says about these files (read 25 Oct 2026)

- **Commercial use is allowed.** Section 2 grants every user a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright
  licence to reproduce, prepare, publicly display, publicly perform, sublicense and distribute the Model and its derivatives; nothing in it limits
  the use to non-commercial work, and the use restrictions of Attachment A are about what is said, not about being paid for it.
- **The sound is ours to use.** Section 6: "Licensor claims no rights in the Output You generate using the Model. You are accountable for the
  Output you generate and its subsequent uses." The clips are Output. The model itself is not shipped with BodyArcade, only the audio it made, so
  the conditions of section 4 (handing on the model, its licence and the use restrictions) do not apply to the files, and they are not used to
  train any other model.
- **Attachment A (e)** forbids generating or spreading content "without expressly and intelligibly disclaiming that the information and/or
  content is machine generated". BodyArcade says so on the game's own page: `catalogue.about` of `../manifest.json` ends "A coach calls the
  numbers aloud, in a synthetic voice, with captions on the screen" (in Turkish, "yapay bir sesle"). This file says so too, and a test keeps both.
- The other restrictions of Attachment A (unlawful use, harm to minors, false information, impersonation, medical advice, discrimination ...)
  are not in play: the clips are the words of a boxing trainer counting punches and naming rounds.
- Section 8: no use of the licensors' names or marks to suggest an endorsement. This file names the model as the source and nothing more.

## How they were made

`voice-script.json` (the words, the voice, the seed of the takes) is rendered by `render-voice.py`: synthesis, a speech recogniser's check of each
take, trimming, one loudness for every clip, a high-pass and a light compressor through ffmpeg, mono mp3 (LAME) at 24 kHz and 40 kbit/s.
`verify-voice.py` hears every final file again (faster-whisper) and compares it with its words. Neither tool ships with the game.

If a clip cannot be loaded or decoded, the game falls back to the browser's own speech synthesis (the voices of the player's device), but only in
a language the device has a voice for; that voice belongs to the device's maker and is never stored or sent by BodyArcade.

## Remaking them

See the head of `render-voice.py`. `clips.json` is written by the script and read by the game (lengths, sizes, hashes) and by its tests, which
also check that the captions in `../../target/strings.ts` say exactly what each clip says.
