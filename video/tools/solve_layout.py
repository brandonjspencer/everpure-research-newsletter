"""Solve the video's layout from measured ink.

Reads an ink report from tools/probe_ink.js (run it with --raw, so the page skips its baked layout)
and prints the LAYOUT / LAYOUT_REL / EYEBROW_GLIDE tables index.html applies at load:

- every stack uses one spacing system: an element's baseline (or ink bottom) to the next element's
  ink top;
- every stack is centred on the optical centre (y 532);
- every line's ink starts exactly on the 168px margin (side bearings corrected).

Usage: python3 tools/solve_layout.py tools/ink_report.json
"""

import json
import sys

CENTER, MARGIN = 532, 168

m = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "ink_report.json"))


def box(scene, sel):
    x0, y0, _x1, y1, baseline = m[scene][sel]
    return {"x": x0, "top": y0, "bottom": baseline if baseline is not None else y1}


def stack(items, center=CENTER):
    """items: [(name, top, bottom, gap_before)] -> {name: new_top}, block centred on `center`."""
    height = sum(b - t for _, t, b, _ in items) + sum(g for *_, g in items[1:])
    y = center - height / 2
    out = {}
    for i, (name, top, bottom, gap) in enumerate(items):
        if i:
            y += gap
        out[name] = y
        y += bottom - top
    return out


def place(scene, spec, center=CENTER):
    """spec: [(selector, gap_before)] -> {selector: dy}."""
    items = [(sel, box(scene, sel)["top"], box(scene, sel)["bottom"], g) for sel, g in spec]
    new = stack(items, center)
    return {sel: round(new[sel] - box(scene, sel)["top"], 2) for sel, _ in spec}


def dx(scene, sel):
    return MARGIN - box(scene, sel)["x"]


def eyebrow(scene):
    """The eyebrow's text carries its cap top and baseline."""
    return f"#{scene} .eyebrow .mask"


def group(scene, name, top_sel, bottom_sel):
    """A synthetic element spanning top_sel's ink top to bottom_sel's baseline (bars, the duo)."""
    m[scene][name] = [0, m[scene][top_sel][1], 0, 0, m[scene][bottom_sel][4]]


layout = []  # (selector, dx, dy) — absolutely positioned elements
rel = []  # (selector, dx, dy) — in-flow elements, shifted relatively

# Finding scenes: eyebrow · numeral · line · takeaway
for s in ("s4", "s5", "s7"):
    big, line, sub = f"#{s} .big", f"#{s} .line", f"#{s} .sub"
    d = place(s, [(eyebrow(s), 0), (big, 72), (line, 88), (sub, 120)])
    layout += [
        (f"#{s} .eyebrow", dx(s, eyebrow(s)), d[eyebrow(s)]),
        (big, dx(s, big), d[big]),
        (line, dx(s, line), d[line]),
        (sub, dx(s, sub), d[sub]),
    ]

# Platform menu, first half: eyebrow · numerals · bars · takeaway
group(
    "s3a", "BARS", "#s3a .bar-row:nth-child(1) .bar-track", "#s3a .bar-row:nth-child(2) .bar-label"
)
d = place("s3a", [(eyebrow("s3a"), 0), ("#s3a .big", 72), ("BARS", 96), ("#s3a .sub", 112)])
layout += [
    ("#s3a .eyebrow", dx("s3a", eyebrow("s3a")), d[eyebrow("s3a")]),
    ("#s3a .big", dx("s3a", "#s3a .big"), d["#s3a .big"]),
    ("#s3a .bars", 0, d["BARS"]),
    ("#s3a .sub", dx("s3a", "#s3a .sub"), d["#s3a .sub"]),
]

# Platform menu, second half: the eyebrow glides down to this stack's position
h1, h2, sub = "#s3b .headline:not(#s3pos)", "#s3pos", "#s3b .sub"
d3 = place("s3b", [(eyebrow("s3a"), 0), (h1, 72), (h2, 60), (sub, 112)])
eyebrow_glide = round(d3[eyebrow("s3a")] - d[eyebrow("s3a")], 2)
layout += [(h1, dx("s3b", h1), d3[h1]), (h2, dx("s3b", h2), d3[h2]), (sub, dx("s3b", sub), d3[sub])]

# Lesson halves: headline · bars · takeaway (identical stacks, so the halves share positions)
for s in ("s2a", "s2b"):
    group(
        s,
        "BARS",
        f"#{s} .bar-row:nth-child(1) .bar-track",
        f"#{s} .bar-row:nth-child(2) .bar-label",
    )
    head, sub = f"#{s} .headline", f"#{s} .sub"
    d = place(s, [(head, 0), ("BARS", 112), (sub, 104)])
    layout += [
        (head, dx(s, head), d[head]),
        (f"#{s} .bars", 0, d["BARS"]),
        (sub, dx(s, sub), d[sub]),
    ]

# Newsroom: eyebrow · duo numerals · labels · takeaway (the numeral→label gap, 56, is set in CSS)
num, lab = "#s6 .stat:not(.minor) .num", "#s6 .stat:not(.minor) .lab"
group("s6", "DUO", num, lab)
d = place("s6", [(eyebrow("s6"), 0), ("DUO", 72), ("#s6 .sub", 120)])
duo_dx = dx("s6", num)
layout += [
    ("#s6 .eyebrow", dx("s6", eyebrow("s6")), d[eyebrow("s6")]),
    ("#s6 .duo", duo_dx, d["DUO"]),
    ("#s6 .sub", dx("s6", "#s6 .sub"), d["#s6 .sub"]),
]
minor_num, minor_lab = m["s6"]["#s6 .stat.minor .num"], m["s6"]["#s6 .stat.minor .lab"]
rel += [
    # the minor column's numeral onto its label's ink edge and the major numeral's baseline
    ("#s6 .stat.minor .num", minor_lab[0] - minor_num[0], round(m["s6"][num][4] - minor_num[4], 2)),
    # the major label back onto the margin after the duo moved
    (lab, MARGIN - (box("s6", lab)["x"] + duo_dx), 0),
]

# Open and end slate
d = place("s1", [("#s1 .mark", 0), ("#s1 .title", 104), ("#s1 .date", 72)])
layout += [
    ("#s1 .mark", 0, d["#s1 .mark"]),
    ("#s1 .title", dx("s1", "#s1 .title"), d["#s1 .title"]),
    ("#s1 .date", dx("s1", "#s1 .date"), d["#s1 .date"]),
]
d = place("s9", [("#s9 .mark", 0), ("#th1", 112), ("#th2", 76), ("#s9 .closer", 112)])
layout += [
    ("#s9 .mark", 0, d["#s9 .mark"]),
    ("#th1", dx("s9", "#th1"), d["#th1"]),
    ("#th2", dx("s9", "#th2"), d["#th2"]),
    ("#s9 .closer", dx("s9", "#s9 .closer"), d["#s9 .closer"]),
]

# Bar labels onto the margin (the page also hangs labels marked .hang by their opening quote)
for s in ("s2a", "s2b", "s3a"):
    for i in (1, 2):
        sel = f"#{s} .bar-row:nth-child({i}) .bar-label"
        rel.append((sel, dx(s, sel), 0))


def table(rows):
    return json.dumps([[sel, round(x, 2), round(y, 2)] for sel, x, y in rows])


print(f"const LAYOUT = {table(layout)};")
print(f"const LAYOUT_REL = {table(rel)};")
print(f"const EYEBROW_GLIDE = {eyebrow_glide};")
