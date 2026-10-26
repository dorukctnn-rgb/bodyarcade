"""Outline the BodyArcade wordmark from Savate (OFL) into SVG path data.

python design/tools/wordmark.py <Savate[wght].ttf> <weight> <tracking-em> > out.json
Kerning comes from the font's own GPOS pair adjustments at that weight.
"""
import sys, json, io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

src, weight, track = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
text = sys.argv[4] if len(sys.argv) > 4 else "BodyArcade"
f = TTFont(src, lazy=False)
f = instancer.instantiateVariableFont(f, {"wght": weight})
buf = io.BytesIO(); f.save(buf); buf.seek(0); f = TTFont(buf, lazy=False)
cmap = f.getBestCmap(); gs = f.getGlyphSet(); hmtx = f["hmtx"]; upm = f["head"].unitsPerEm

def pair_kern(a, b):
    total = 0
    gpos = f["GPOS"].table
    kern_lookups = set()
    for fr in gpos.FeatureList.FeatureRecord:
        if fr.FeatureTag == "kern":
            kern_lookups.update(fr.Feature.LookupListIndex)
    for li in sorted(kern_lookups):
        lk = gpos.LookupList.Lookup[li]
        subs = lk.SubTable
        for st in subs:
            if lk.LookupType == 9:
                st = st.ExtSubTable
            if getattr(st, "LookupType", 2) != 2 and lk.LookupType not in (2, 9):
                continue
            cov = st.Coverage.glyphs
            if a not in cov:
                continue
            if st.Format == 1:
                ps = st.PairSet[cov.index(a)]
                for pvr in ps.PairValueRecord:
                    if pvr.SecondGlyph == b and pvr.Value1 is not None:
                        return getattr(pvr.Value1, "XAdvance", 0) or 0
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs.get(a, 0)
                c2 = st.ClassDef2.classDefs.get(b, 0)
                rec = st.Class1Record[c1].Class2Record[c2]
                if rec.Value1 is not None:
                    v = getattr(rec.Value1, "XAdvance", 0) or 0
                    if v:
                        return v
    return total

names = [cmap[ord(c)] for c in text]
x = 0.0
paths = []
for i, g in enumerate(names):
    pen = SVGPathPen(gs)
    tp = TransformPen(pen, (1, 0, 0, -1, x, 0))  # flip y: font up = svg up
    gs[g].draw(tp)
    paths.append(pen.getCommands())
    adv = hmtx[g][0]
    k = pair_kern(g, names[i + 1]) if i + 1 < len(names) else 0
    x += adv + k + (track * upm if i + 1 < len(names) else 0)
os2 = f["OS/2"]
print(json.dumps({"d": " ".join(paths), "width": x, "upm": upm, "cap": os2.sCapHeight, "xh": os2.sxHeight,
                  "asc": os2.sTypoAscender, "desc": os2.sTypoDescender}))
