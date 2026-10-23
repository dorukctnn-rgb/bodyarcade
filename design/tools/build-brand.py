"""Write the BodyArcade logo files into design/brand/ (SVG).

python design/tools/build-brand.py <Savate[wght].ttf>
"""
import sys, json, subprocess, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from brandlib import INK, FLUSH, CHALK, GEOM, mark_body, bbox

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"; BRAND.mkdir(exist_ok=True)
SAVATE = sys.argv[1]
WEIGHT, TRACK = 850, -0.02

wm = json.loads(subprocess.check_output([sys.executable, str(ROOT / "tools" / "wordmark.py"), SAVATE, str(WEIGHT), str(TRACK)]))

def svg(w, h, body, vb=None, title="BodyArcade"):
    vb = vb or f"0 0 {w} {h}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n')

def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")

# ---- mark only (tight box with 2 unit padding)
x0, y0, x1, y1 = bbox()
pad = 2
mw, mh = (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad
vb = f"{fmt(x0 - pad)} {fmt(y0 - pad)} {fmt(mw)} {fmt(mh)}"
for name, fig, ball in [("mark", INK, FLUSH), ("mark-dark", CHALK, FLUSH), ("mark-mono", "currentColor", "currentColor")]:
    (BRAND / f"{name}.svg").write_text(svg(fmt(mw * 2), fmt(mh * 2), mark_body(fig, ball), vb), encoding="utf-8")

# ---- wordmark only
cap, desc = wm["cap"], wm["desc"]
top, bottom = -wm["asc"] * 0.0 - 760, 230  # cap 730 plus overshoot, descender of y
ww = wm["width"]
for name, col in [("wordmark", INK), ("wordmark-dark", CHALK), ("wordmark-mono", "currentColor")]:
    body = f'<path fill="{col}" d="{wm["d"]}"/>'
    (BRAND / f"{name}.svg").write_text(svg(fmt(ww / 10), fmt((bottom - top) / 10), body, f"0 {top} {fmt(ww)} {bottom - top}"), encoding="utf-8")

# ---- horizontal lockup: mark height tied to cap height, floor line sits on the baseline
def lockup(fig, ball, word):
    s = (cap * 1.32) / (y1 - y0)          # font units per mark unit
    mx = -x0 * s                          # mark starts at x = 0
    my = -(GEOM["line"][1]) * s           # floor line centre on the baseline (y = 0)
    gap = 0.20 * cap
    tx = (x1 - x0) * s + gap
    body = (f'<g transform="translate({fmt(mx)} {fmt(my)}) scale({fmt(s)})">{mark_body(fig, ball)}</g>'
            f'<path fill="{word}" transform="translate({fmt(tx)} 0)" d="{wm["d"]}"/>')
    top_y = min(my + y0 * s, -760)
    bot_y = max(my + y1 * s, 230)
    W = tx + ww
    return svg(fmt(W / 10), fmt((bot_y - top_y) / 10), body, f"0 {fmt(top_y)} {fmt(W)} {fmt(bot_y - top_y)}")

(BRAND / "logo.svg").write_text(lockup(INK, FLUSH, INK), encoding="utf-8")
(BRAND / "logo-dark.svg").write_text(lockup(CHALK, FLUSH, CHALK), encoding="utf-8")
(BRAND / "logo-mono.svg").write_text(lockup("currentColor", "currentColor", "currentColor"), encoding="utf-8")

# ---- stacked lockup
def stacked(fig, ball, word):
    s = (cap * 2.6) / (y1 - y0)
    markw = (x1 - x0) * s
    mx = (ww - markw) / 2 - x0 * s
    my = -y0 * s
    ty = (y1 - y0) * s + 0.55 * cap + cap
    body = (f'<g transform="translate({fmt(mx)} {fmt(my)}) scale({fmt(s)})">{mark_body(fig, ball)}</g>'
            f'<path fill="{word}" transform="translate(0 {fmt(ty)})" d="{wm["d"]}"/>')
    H = ty + 230
    return svg(fmt(ww / 10), fmt(H / 10), body, f"0 0 {fmt(ww)} {fmt(H)}")

(BRAND / "logo-stacked.svg").write_text(stacked(INK, FLUSH, INK), encoding="utf-8")
(BRAND / "logo-stacked-dark.svg").write_text(stacked(CHALK, FLUSH, CHALK), encoding="utf-8")

# ---- app icon artwork (square, full bleed; stores and launchers apply their own mask)
def icon_svg(size=512, bg=INK, fig=CHALK, ball=FLUSH, scale=0.60, rx=0):
    # place the mark's visual centre in the middle; scale = mark height / tile height
    s = size * scale / (y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    tx, ty = size / 2 - cx * s, size / 2 - cy * s
    rect = f'<rect width="{size}" height="{size}" rx="{rx}" fill="{bg}"/>' if bg else ""
    return svg(size, size, rect + f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(s)})">{mark_body(fig, ball)}</g>')

ICON = ROOT / "brand" / "icon"; ICON.mkdir(exist_ok=True)
(ICON / "app-icon.svg").write_text(icon_svg(), encoding="utf-8")
(ICON / "app-icon-rounded.svg").write_text(icon_svg(rx=112), encoding="utf-8")
# Android adaptive icon: 108 dp canvas, keep the mark inside the 66 dp safe circle
(ICON / "adaptive-foreground.svg").write_text(icon_svg(108, None, CHALK, FLUSH, scale=0.50), encoding="utf-8")
(ICON / "adaptive-background.svg").write_text(svg(108, 108, f'<rect width="108" height="108" fill="{INK}"/>'), encoding="utf-8")
(ICON / "adaptive-monochrome.svg").write_text(icon_svg(108, None, "#000000", "#000000", scale=0.50), encoding="utf-8")
# favicon: small sizes need a tighter crop and slightly heavier figure
(ICON / "favicon.svg").write_text(icon_svg(64, INK, CHALK, FLUSH, scale=0.74, rx=14), encoding="utf-8")
print("brand files written", wm["width"])
