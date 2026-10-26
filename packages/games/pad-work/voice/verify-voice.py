#!/usr/bin/env python
"""Listens to the clips for us: every clip is decoded, passed through a speech recogniser (faster-whisper), and the words it hears are
compared with the words the clip should say. Nobody can listen in the pipeline that makes the clips, so this is the check that each
clip says what clips.json says it says, in its language; it is a check of the words, not of how good the voice sounds.

  python -m venv venv && venv/Scripts/pip install faster-whisper soundfile numpy
  venv/Scripts/python verify-voice.py --dir . --model medium                (the first run downloads the model, 1.5 GB for medium)

Prints one line per clip and exits 1 when a clip is not heard as its words. Numbers may come back as digits ("2" for "two"); `also` in voice-script.json lists the spellings a recogniser may give a word that is said right.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

DIGITS = {
    'en': {'1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '10': 'ten'},
    'tr': {'1': 'bir', '2': 'iki', '3': 'üç', '4': 'dört', '5': 'beş', '6': 'altı', '10': 'on'},
}
FOLD = str.maketrans('çğıöşü', 'cgiosu')


def norm(s: str, lang: str) -> str:
    """The same comparison render-voice.py makes: lower case, no punctuation or apostrophe, digits as words, no spaces, and for Turkish the
    letters with marks folded to plain ones (a recogniser writes what it hears, and is not to be trusted with them)."""
    s = s.lower().replace('i̇', 'i').replace("'", '').replace('’', '')
    s = re.sub(r'[^\w\s]', ' ', s)
    out = ' '.join(DIGITS.get(lang, {}).get(w, w) for w in s.split()).replace(' ', '')
    return out.translate(FOLD) if lang == 'tr' else out


def load16k(path: Path) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / 'x.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-ac', '1', '-ar', '16000', str(wav)], check=True)
        w, _ = sf.read(wav)
    return np.concatenate([np.zeros(4800, 'float32'), w.astype('float32'), np.zeros(4800, 'float32')])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default='.')
    ap.add_argument('--model', default='medium')
    args = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    base = Path(args.dir)
    manifest = json.loads((base / 'clips.json').read_text(encoding='utf-8'))
    script = json.loads((base / 'voice-script.json').read_text(encoding='utf-8'))
    bad = 0
    for lang, table in manifest['clips'].items():
        for cid, spec in table.items():
            segs, _ = model.transcribe(load16k(base / lang / f'{cid}.mp3'), language=lang, beam_size=5, condition_on_previous_text=False, temperature=0.0)
            heard = ' '.join(s.text.strip() for s in segs)
            want = norm(spec['text'], lang)
            also = script['clips'][lang][cid].get('also', [])
            ok = norm(heard, lang) in [want] + [norm(a, lang) for a in also]
            bad += 0 if ok else 1
            print(f"{'ok ' if ok else 'BAD'} {lang}/{cid}: wanted '{spec['text']}', heard '{heard}'")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
