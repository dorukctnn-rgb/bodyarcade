"""Shared geometry for the BodyArcade mark ("the player is the joystick").

The mark is drawn on a 100 x 100 grid: a floor line (the target line every game uses),
a stick body tilted 18 degrees, two arms raised, and a ball head that doubles as the
ball-top of an arcade joystick.
"""
import json, pathlib

INK = "#1C1433"; FLUSH = "#FF4F6E"; CHALK = "#F4F2F8"

GEOM = {
    "line": (22, 82, 78, 82, 9.5),
    "body": (45.5, 79, 56.5, 47.5, 13.5),
    "arm_l": (56, 49.5, 38.5, 31.5, 9.5),
    "arm_r": (56, 49.5, 76.5, 37.5, 9.5),
    "ball": (62.5, 26.5, 12.5),
}

def cap(x1, y1, x2, y2, w, c):
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" '
            f'stroke-width="{w}" stroke-linecap="round"/>')

def mark_body(fig=INK, ball=FLUSH, line=None, g=GEOM):
    line = line or fig
    lx1, ly1, lx2, ly2, lw = g["line"]
    out = [cap(lx1, ly1, lx2, ly2, lw, line)]
    for k in ("body", "arm_l", "arm_r"):
        out.append(cap(*g[k], fig))
    bx, by, br = g["ball"]
    out.append(f'<circle cx="{bx}" cy="{by}" r="{br}" fill="{ball}"/>')
    return "".join(out)

def bbox(g=GEOM):
    xs, ys = [], []
    for k in ("line", "body", "arm_l", "arm_r"):
        x1, y1, x2, y2, w = g[k]; r = w / 2
        xs += [x1 - r, x2 - r, x1 + r, x2 + r]; ys += [y1 - r, y2 - r, y1 + r, y2 + r]
    bx, by, br = g["ball"]
    xs += [bx - br, bx + br]; ys += [by - br, by + br]
    return min(xs), min(ys), max(xs), max(ys)
