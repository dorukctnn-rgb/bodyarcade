#!/usr/bin/env python
"""Renders the coach's clips of Pad Work from voice-script.json: text to speech, trimming, loudness, mp3, and clips.json.

This is how the files in en/ and tr/ were made; it is not part of the game and nothing in the repo runs it. Run it again only to remake
the voice (another wording, another pace), then check the result with verify-voice.py and read the clip list in the notes.

  python -m venv venv && venv/Scripts/pip install supertonic soundfile numpy      (Python 3.11)
  venv/Scripts/python render-voice.py --script voice-script.json --out .          (ffmpeg with libmp3lame must be on the PATH)

The model is Supertonic 3 (Supertone Inc.): on-device text to speech, ONNX, no network after the model is downloaded, no account, no real
person's voice (preset voice styles). Its licence and what that means for the game are in CREDITS.md.

Per clip: synthesise at each of the clip's speeds, slowest first (a model at a high speed says nothing, or half a word), and keep the first
try that is within the limit of its kind and, with --check, that a speech recogniser hears as the clip's words (see good()); then cut the
silence either side (a few milliseconds of lead, a short fade at both ends), a gentle high-pass and
presence lift and a light compressor, bring every clip to the same loudness (the loudness of its speech, not of its peak) with a peak
ceiling, and encode mono mp3 at 24 kHz and 40 kbit/s (a clip is 2 to 8 KB). clips.json gets the text, the length in ms of the sound
inside the file, the size and a hash of every clip, which the game and its tests read.
"""
import argparse
import hashlib
import json
import zlib
import subprocess
import sys
import tempfile
from pathlib import Path

import re

import numpy as np
import soundfile as sf

SR = 44100
LEAD_MS = 6
TAIL_MS = 25
FADE_IN_MS = 4
FADE_OUT_MS = 22
TARGET_RMS_DB = -19.0   # loudness of the speech inside a clip, dBFS
PEAK_CEIL = 0.5         # which, with the master gain and the clip gain, sits at the limiter's threshold

# The longest each kind of clip may be (ms): the game's schedule (packages/games/target/coach.ts MAX_CLIP_MS) counts on these.
MAX_MS = {'number': 350, 'defence': 740, 'round': 1080, 'warn': 770, 'rest': 1780}
SQUEEZE_UP_TO = 1.12   # a take up to this much over its limit is sped up to fit instead of thrown away
MIN_MS = {'number': 150, 'defence': 250, 'round': 300, 'warn': 300, 'rest': 600}   # shorter than this is a word cut in half


def kind_of(cid: str) -> str:
    if cid.startswith('n') and cid[1:].isdigit():
        return 'number'
    if cid in ('slipL', 'slipR', 'duck'):
        return 'defence'
    if cid == 'last10':
        return 'warn'
    if cid == 'rest':
        return 'rest'
    return 'round'


def active_bounds(w: np.ndarray) -> tuple[int, int]:
    """First and last sample of the speech: 5 ms frames above 5 % of the loudest frame (and above a floor)."""
    h = int(SR * 0.005)
    n = len(w) // h
    r = np.sqrt((w[: n * h].reshape(n, h) ** 2).mean(axis=1))
    idx = np.where(r > max(r.max() * 0.05, 0.002))[0]
    if len(idx) == 0:
        return 0, 0                          # the model said nothing at all (it does, now and then, at a high speed)
    return int(idx[0] * h), int((idx[-1] + 1) * h)


def trim(w: np.ndarray) -> np.ndarray:
    a, b = active_bounds(w)
    if b <= a:
        return w[:0]
    a = max(0, a - int(SR * LEAD_MS / 1000))
    b = min(len(w), b + int(SR * TAIL_MS / 1000))
    out = w[a:b].copy()
    fi, fo = int(SR * FADE_IN_MS / 1000), int(SR * FADE_OUT_MS / 1000)
    out[:fi] *= np.linspace(0, 1, fi)
    out[-fo:] *= np.linspace(1, 0, fo)
    return out


def speech_rms(w: np.ndarray) -> float:
    h = int(SR * 0.01)
    n = len(w) // h
    r = np.sqrt((w[: n * h].reshape(n, h) ** 2).mean(axis=1))
    act = r[r > r.max() * 0.1]
    return float(np.sqrt((act ** 2).mean())) if len(act) else float(r.max())


def ffmpeg_filter(w: np.ndarray) -> np.ndarray:
    """High-pass, a lift around 3 kHz for presence, a light compressor: through ffmpeg so the chain is the one anybody can read."""
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / 'a.wav', Path(d) / 'b.wav'
        sf.write(a, w, SR)
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-i', str(a), '-af',
            'highpass=f=75,equalizer=f=3000:t=q:w=1.1:g=2.5,acompressor=threshold=0.14:ratio=2.5:attack=3:release=50:makeup=1',
            str(b),
        ], check=True)
        out, _ = sf.read(b)
    return np.asarray(out, dtype=np.float64)


def squeeze(w: np.ndarray, factor: float) -> np.ndarray:
    """Plays the clip `factor` times faster without changing its pitch (ffmpeg atempo): for a take that is a few percent too long."""
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / 'a.wav', Path(d) / 'b.wav'
        sf.write(a, w, SR)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(a), '-af', f'atempo={factor:.4f}', str(b)], check=True)
        out, _ = sf.read(b)
    return np.asarray(out, dtype=np.float64)


def soft_limit(w: np.ndarray, knee: float, ceil: float) -> np.ndarray:
    """Leaves everything under `knee` alone and bends what is above it so that it never reaches `ceil` (tanh), instead of turning the whole clip down for one peak."""
    a = np.abs(w)
    over = a > knee
    out = w.copy()
    out[over] = np.sign(w[over]) * (knee + (ceil - knee) * np.tanh((a[over] - knee) / (ceil - knee)))
    return out


def normalise(w: np.ndarray) -> np.ndarray:
    """Every clip to the same loudness of its speech (TARGET_RMS_DB), whatever its peaks, with the peaks bent under PEAK_CEIL."""
    target = 10 ** (TARGET_RMS_DB / 20)
    g = target / max(speech_rms(w), 1e-6)
    out = soft_limit(w * g, PEAK_CEIL * 0.6, PEAK_CEIL)
    for _ in range(4):
        r = speech_rms(out)
        if abs(20 * np.log10(r / target)) < 0.3:
            break
        g *= target / r
        out = soft_limit(w * g, PEAK_CEIL * 0.6, PEAK_CEIL)
    return out


def encode_mp3(w: np.ndarray, path: Path) -> None:
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / 's.wav'
        sf.write(src, w.astype(np.float32), SR)
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-i', str(src), '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '40k',
            '-id3v2_version', '0', '-write_xing', '1', '-fflags', '+bitexact', '-flags:a', '+bitexact', str(path),
        ], check=True)


DIGITS = {
    'en': {'1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '10': 'ten'},
    'tr': {'1': 'bir', '2': 'iki', '3': 'üç', '4': 'dört', '5': 'beş', '6': 'altı', '10': 'on'},
}


FOLD = str.maketrans('çğıöşü', 'cgiosu')


def norm(text: str, lang: str) -> str:
    """Words as a recogniser and a script can agree on them: lower case, no punctuation or apostrophe, digits as words, and for Turkish the
    letters with marks folded to plain ones (a recogniser is not to be trusted with them; the script spells them right for the voice)."""
    t = text.lower().replace('i̇', 'i').replace("'", '').replace('’', '')
    t = re.sub(r'[^\w\s]', ' ', t)
    words = [DIGITS.get(lang, {}).get(w, w) for w in t.split()]
    out = ' '.join(words)
    return out.translate(FOLD) if lang == 'tr' else out


class Ear:
    """A speech recogniser (faster-whisper) that says what it hears in a decoded clip."""

    def __init__(self, model: str):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(model, device='cpu', compute_type='int8')

    def hear(self, mp3: Path, lang: str) -> str:
        with tempfile.TemporaryDirectory() as d:
            wav = Path(d) / 'x.wav'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(wav)], check=True)
            w, _ = sf.read(wav)
        w = np.concatenate([np.zeros(4800, 'float32'), w.astype('float32'), np.zeros(4800, 'float32')])
        segs, _ = self.model.transcribe(w, language=lang, beam_size=5, condition_on_previous_text=False, temperature=0.0)
        return ' '.join(s.text.strip() for s in segs)


def good(heard: str, spec: dict, lang: str) -> bool:
    """The recogniser heard the clip's words (or a spelling of them the script lists, for words a recogniser writes as it hears them)."""
    squash = lambda x: x.replace(' ', '')   # a recogniser is no judge of where the spaces go
    return squash(norm(heard, lang)) in [squash(norm(spec['text'], lang))] + [squash(norm(a, lang)) for a in spec.get('also', [])]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='voice-script.json')
    ap.add_argument('--out', default='.')
    ap.add_argument('--only', default='', help='comma separated lang/id to remake, e.g. en/n3,tr/n3')
    ap.add_argument('--redo', action='store_true', help='make the clips again from the speed and take clips.json says each one came from (after a change of the post-processing)')
    ap.add_argument('--check', default='', help='a faster-whisper model (small, medium): a try counts only if it hears the words of the clip')
    args = ap.parse_args()
    script = json.loads(Path(args.script).read_text(encoding='utf-8'))
    out = Path(args.out)
    only = {x for x in args.only.split(',') if x}

    from supertonic import TTS  # imported late: the model is downloaded the first time
    tts = TTS(auto_download=True)
    style = tts.get_voice_style(voice_name=script['voice'])
    manifest_path = out / 'clips.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'clips': {}}
    manifest.update({'model': script['model'], 'voice': script['voice'], 'format': 'mp3 mono 24 kHz 40 kbit/s'})
    ear = Ear(args.check) if args.check else None
    problems = 0
    for lang, table in script['clips'].items():
        (out / lang).mkdir(parents=True, exist_ok=True)
        for cid, spec in table.items():
            if only and f'{lang}/{cid}' not in only:
                continue
            limit = MAX_MS[kind_of(cid)]
            path = out / lang / f'{cid}.mp3'
            chosen = None
            fallback = None
            attempts = [(speed, take) for speed in spec['speeds'] for take in range(script.get('takes', 3))]
            if args.redo:
                made = manifest['clips'].get(lang, {}).get(cid)
                if not made:
                    continue
                attempts = [(made['speed'], made['take'])]
            for speed, take in attempts:
                # the model draws noise (np.random.randn): seeded, so that the same script makes the same clips
                np.random.seed(zlib.crc32(f'{lang}/{cid}/{speed}/{take}'.encode()))
                wav, _ = tts.synthesize(spec['say'], voice_style=style, lang=lang, speed=speed, silence_duration=0.0, total_steps=script.get('steps', 8))
                t = trim(np.asarray(wav, dtype=np.float64).reshape(-1))
                if len(t) <= int(SR * 0.08):
                    print(f'  {lang}/{cid} at speed {speed} take {take}: no speech, skipped')
                    continue
                w = normalise(ffmpeg_filter(t))
                ms = round(len(w) / SR * 1000)
                if ms < MIN_MS[kind_of(cid)]:
                    print(f'  {lang}/{cid} at speed {speed} take {take}: {ms} ms is too short to be the word')
                    continue
                if limit < ms <= limit * SQUEEZE_UP_TO:
                    # a few percent too long: played a little faster instead (pitch kept), then judged like any take
                    w = squeeze(w, ms / (limit - 8))
                    ms = round(len(w) / SR * 1000)
                    squeezed = True
                else:
                    squeezed = False
                if ms > limit:
                    print(f'  {lang}/{cid} at speed {speed} take {take}: {ms} ms is over the limit of {limit}')
                    if fallback is None or ms < fallback[1]:
                        fallback = (w, ms, speed)
                    continue
                if ear is not None and not args.redo:
                    encode_mp3(w, path)
                    heard = ear.hear(path, lang)
                    if not good(heard, spec, lang):
                        print(f"  {lang}/{cid} at speed {speed} take {take}: heard '{heard}', wanted '{spec['text']}'")
                        continue
                chosen = (w, ms, speed, take, squeezed)
                break
            if chosen is None:
                print(f'NO CLIP FOR {lang}/{cid}' + (f' (the shortest, {fallback[1]} ms at speed {fallback[2]}, is over the limit)' if fallback else ''))
                problems += 1
                continue
            w, ms, speed, take, squeezed = chosen
            path = out / lang / f'{cid}.mp3'
            encode_mp3(w, path)
            data = path.read_bytes()
            manifest['clips'].setdefault(lang, {})[cid] = {'text': spec['text'], 'ms': ms, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            manifest['clips'][lang][cid]['speed'] = speed
            manifest['clips'][lang][cid]['take'] = take
            if squeezed:
                manifest['clips'][lang][cid]['squeezed'] = True
            print(f'{lang}/{cid}: {ms} ms, {len(data)} bytes, speed {speed} take {take}')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
