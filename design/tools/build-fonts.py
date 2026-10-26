"""Subset the two BodyArcade typefaces to latin + latin-ext woff2 files.

Sources (OFL 1.1, no reserved font name), from github.com/google/fonts:
  ofl/savate/Savate[wght].ttf          (Plomb Type, Max Esnee)   wght 200-900
  ofl/nationalpark/NationalPark[wght].ttf (Hoepner, Herstowski, Shellhorn) wght 200-800
Usage: python design/tools/build-fonts.py <folder with the two TTFs>
Writes design/fonts/*.woff2. The axis range is trimmed to the weights the system uses.
"""
import sys, os, pathlib, io
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(__file__).resolve().parent.parent / "fonts"
UNICODES = (
    "U+0000-00FF,U+0100-024F,U+0259,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,"
    "U+0300-0308,U+0329,U+1E00-1EFF,U+2000-206F,U+20A0-20C0,U+2113,U+2122,U+2190-2193,"
    "U+2212,U+2215,U+FEFF,U+FFFD"
)
JOBS = [
    ("Savate[wght].ttf", "savate-var.woff2", (500, 900)),
    ("NationalPark[wght].ttf", "national-park-var.woff2", (400, 800)),
]
for src, out, (lo, hi) in JOBS:
    font = TTFont(SRC / src, lazy=False)
    font = instancer.instantiateVariableFont(font, {"wght": (lo, hi)})
    buf = io.BytesIO(); font.save(buf); buf.seek(0)
    font = TTFont(buf, lazy=False)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    path = OUT / out
    font.flavor = "woff2"
    font.save(path)
    print(out, os.path.getsize(path), "bytes")
