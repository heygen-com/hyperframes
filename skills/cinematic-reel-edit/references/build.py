#!/usr/bin/env python3
"""Generates index.html (HyperFrames composition) from words.json + the beat plan in match_table.json."""
import json, math, re, html
from pathlib import Path

HERE = Path(__file__).parent
W = json.loads((HERE / "words.json").read_text())
DUR = 65.43
FPS = 30
F = 1 / FPS

WA_LINK = "chat.whatsapp.com/your-invite-link"   # TODO: paste the real invite link here
SITE = "example.com"

def wt(text, near):
    """Start time of the spoken word `text` closest to `near` (keeps every cue on a real word)."""
    cands = [w for w in W if re.sub(r"[^\w']", "", w["text"].lower()) == text.lower()]
    best = min(cands, key=lambda w: abs(w["start"] - near))
    assert abs(best["start"] - near) < 0.6, (text, near, best)
    return best["start"]

# ---------- B-roll placements (start = first frame of the cut word) ----------
BROLL = [
    # id, file, start, end, entry-word
    ("chart",      6.00,  11.50),
    ("scroll",     11.50, 13.92),
    ("corridor",   16.10, 17.68),
    ("pacing",     17.68, 19.53),
    ("pathway",    24.90, 29.00),
    ("wireframes", 32.00, 37.00),
    ("messaging",  42.00, 44.00),
    ("panels",     44.00, 45.60),
    ("cards",      45.60, 47.34),
    ("launchpad",  52.66, 56.00),
    ("nodes",      56.00, 60.60),
]

# ---------- A-roll punch-ins: (time, scale, origin-x%, origin-y%) ----------
PUNCH = [
    (0.00, 1.00, 30, 40),
    (wt("provoked", 3.04), 1.15, 48, 35),
    (13.92, 1.00, 50, 38),
    (wt("speaker", 14.97), 1.15, 50, 0),   # hard punch-in on the YOUR NAME slam
    (19.53, 1.18, 57, 38),
    (wt("aware", 21.31), 1.00, 57, 40),
    (wt("in", 23.00), 1.15, 57, 45),
    (29.00, 1.00, 48, 52),
    (wt("that", 30.40), 1.18, 50, 52),
    (37.00, 1.00, 57, 52),
    (wt("then", 40.03), 1.15, 47, 52),
    (47.34, 1.00, 48, 52),
    (wt("even", 49.00), 1.18, 52, 55),
    (wt("at", 51.12), 1.15, 58, 55),
    (60.60, 1.18, 48, 58),
    (wt("love", 62.48), 1.00, 50, 58),
]

# ---------- Captions ----------
SUPPRESS = [(1.0, 3.04), (8.82, 11.5), (14.9, 16.1), (26.43, 29.0), (29.0, 32.0), (33.95, 35.0),
            (40.6, 42.0), (43.3, 47.34), (54.0, 56.0), (56.65, 60.6), (63.9, 99)]
FORCED = {  # start -> word count, to land the exact phrases from the brief
    wt("provoked", 3.04): 2, wt("not", 12.36): 2, wt("till", 13.5): 2, wt("teams", 17.27): 1,
    wt("consulting", 18.16): 2, wt("pay", 35.08): 2, wt("we", 35.03): 1,
}
KEY = {"provoked", "chart", "lakhs", "jobs", "aware", "now", "teams", "consulting", "agency", "chasing",
       "generation", "students", "exist", "destination", "proper", "taste", "pay", "grow", "whatsapp",
       "link", "hire", "platform", "demos", "practices", "love", "happy", "content", "skillset"}

def clean(t):
    return re.sub(r"[^\w' ]", "", t).lower()

def suppressed(t):
    return any(a <= t < b for a, b in SUPPRESS)

groups, i = [], 0
while i < len(W):
    w = W[i]
    if suppressed(w["start"]):
        i += 1; continue
    n = FORCED.get(w["start"])
    if n is None:
        n = 1
        punct = w["text"][-1] in ",.?!"
        if not punct and i + 1 < len(W):
            nx = W[i + 1]
            both_short = (nx["end"] - w["start"]) < 0.62
            if both_short and nx["start"] not in FORCED and not suppressed(nx["start"]) and nx["start"] - w["end"] < 0.25:
                n = 2
    grp = W[i:i + n]
    groups.append(grp)
    i += n

HEROES = [("lakhs", wt("lost", 8.82), 11.50), ("exist", wt("exist", 26.43), 29.00), ("taste", wt("taste", 34.00), 35.03)]
DEPTH_S, DEPTH_E = 14.40, 16.10
LT_WA = (47.34, 52.66)
LT_SITE = (59.40, 61.90)
FOLDERS = (56.6, LT_SITE[0])

# ---------- Visual hierarchy: one graphic at a time ----------
# priority 1 = lower thirds / end card, 2 = hero + depth titles, 3 = callouts, folders, stacked captions, 4 = word captions
GRAPHICS = [
    ("lowerthird-wa", *LT_WA, 1), ("lowerthird-site", *LT_SITE, 1), ("endcard", 63.5, DUR, 1),
    ("depth-title", DEPTH_S, DEPTH_E, 2),
    *[("hero-" + h, s, e, 2) for h, s, e in HEROES],
    ("hook", 1.0, 3.04, 3), ("skillwaste", 29.30, 32.0, 3), ("wajoin", 40.6, 42.0, 3),
    ("co-workshops", 42.96, 44.0, 3), ("co-news", 44.22, 45.6, 3), ("co-career", 45.89, 47.34, 3),
    ("stack", 54.0, 56.0, 3), ("folders", *FOLDERS, 3),
]
PAD_BEFORE = {1: 0.3, 2: 0.0, 3: 0.0}
PAD_AFTER = {1: 0.4, 2: 0.4, 3: 0.0}
BLOCKS = [(n, s - PAD_BEFORE[p], e + PAD_AFTER[p], p) for n, s, e, p in GRAPHICS]

for n1, s1, e1, p1 in GRAPHICS:  # non-caption graphics must not stack either
    for n2, s2, e2, p2 in GRAPHICS:
        if p1 < p2 and s1 < e2 - 1e-6 and s2 < e1 - 1e-6:
            print(f"WARNING overlap: {n2} ({s2:.2f}-{e2:.2f}) under {n1} ({s1:.2f}-{e1:.2f})")

removed = []
cap_html = []
for gi, grp in enumerate(groups):
    s = grp[0]["start"]
    nxt = groups[gi + 1][0]["start"] if gi + 1 < len(groups) else DUR
    sup_after = min([a for a, b in SUPPRESS if a > s] + [DUR])
    e = min(nxt, grp[-1]["end"] + 0.45, sup_after)
    e = max(e, s + 0.25)
    txt = " ".join(clean(w["text"]) for w in grp)
    hit = None
    for n, a, b, p in BLOCKS:
        if s < b and e > a:
            if s >= a:
                hit = n; break
            e = a
    if hit is None and e - s < 0.2:
        hit = "too short after trim"
    if hit:
        removed.append((s, txt, hit)); continue
    # a caption within a second of a lower third moves to the top of the frame
    top = any(n.startswith("lowerthird") and s < b + 1.0 and e > a - 1.0 for n, a, b, p in GRAPHICS)
    spans = []
    for w in grp:
        t = clean(w["text"])
        cls = "w key" if t.replace(" ", "") in KEY else "w"
        spans.append(f'<span class="{cls}">{html.escape(t)}</span>')
    cap_html.append(
        f'<div id="cap{gi}" class="clip cap{" top" if top else ""}" data-start="{s:.3f}" data-duration="{e - s:.3f}" data-track-index="20">'
        f'<div class="cap-in">{" ".join(spans)}</div></div>')

# ---------- SFX ----------
SFX = []
def sfx(name, t, dur, vol, lead=0.0):
    SFX.append((name, max(0, t - lead), dur, vol))

FLICKERS = []
for bid, s, e in BROLL:
    sfx("whoosh-short", s, 0.5, 0.45, lead=0.14)
    FLICKERS.append(s - 3 * F)
for hid, s, e in HEROES:
    sfx("impact-bass-1" if hid != "exist" else "impact-bass-2", s, 1.6, 0.7, lead=0.04)
    FLICKERS.append(s)
FLICKERS.append(wt("chart", 5.64))
DEST = wt("destination", 28.27)
FLICKERS.append(DEST)
for t in FLICKERS:
    sfx("glitch-2", t, 0.14, 0.28, lead=0.02)
sfx("glitch-3", DEST, 0.55, 0.4, lead=0.24)
for name, t in [("whoosh", 1.07), ("whoosh", wt("speaker", 14.97)), ("whoosh", 47.34), ("whoosh", 64.0)]:
    sfx(name, t, 0.5, 0.35, lead=0.12)
sfx("impact-bass-2", wt("speaker", 14.97), 1.6, 0.8, lead=0.04)
sfx("whoosh-cinematic", wt("provoked", 3.04), 1.0, 0.3, lead=0.1)  # layoffs chart card rises in  # low boom under the YOUR NAME slam
POPS = [wt("waste", 31.56), wt("whatsapp", 41.07), 43.36 + 0.4, 44.62 + 0.4, 46.29 + 0.4, 47.64,
        wt("earn", 54.92), wt("demos", 56.69), wt("practices", 57.31), wt("agency", 58.62), 59.20]
for t in POPS:
    sfx("pop", t, 0.45, 0.4, lead=0.1)

sfx_html = "\n".join(
    f'<audio id="sfx{k}" src="assets/sfx/{n}.mp3" data-start="{t:.3f}" data-duration="{d:.3f}" data-track-index="{40 + k}" data-volume="{v}"></audio>'
    for k, (n, t, d, v) in enumerate(sorted(SFX, key=lambda x: x[1])))

bed_auto = {"version": 1, "lanes": [{"target": "volume", "points": [
    {"t": 0, "v": 0}, {"t": 1.5, "v": 0.14}, {"t": 6.0, "v": 0.14}, {"t": 6.8, "v": 0.2}, {"t": 11.5, "v": 0.2},
    {"t": 12.5, "v": 0.14}, {"t": 35.0, "v": 0.14}, {"t": 35.8, "v": 0.22}, {"t": 41.0, "v": 0.22},
    {"t": 42.0, "v": 0.14}, {"t": 63.4, "v": 0.14}, {"t": 65.43, "v": 0}]}]}

broll_html = "\n".join(
    f'<div class="frame broll-wrap" id="bw-{b}"><video id="b-{b}" src="assets/broll/{b}.mp4" data-start="{s:.3f}" '
    f'data-duration="{e - s:.3f}" data-media-start="0" data-track-index="{2 + k}" muted playsinline></video></div>'
    for k, (b, s, e) in enumerate(BROLL))

HOOK_WORDS = [("“I", wt("i", 1.07)), ("DON'T", wt("don't", 1.48)), ("MAKE", wt("make", 1.66)),
              ("THIS", wt("this", 1.90)), ("KIND", wt("kind", 1.96)), ("OF", wt("of", 2.11)),
              ("CONTENT”", wt("content", 2.21))]
hook_spans = " ".join(f'<span class="hw" data-t="{t}">{html.escape(x)}</span>' for x, t in HOOK_WORDS)

T = dict(
    speaker=wt("speaker", 14.97), skill=wt("skillset", 29.34), is_=wt("is", 29.63), waste1=wt("waste", 29.72),
    waste2=wt("waste", 31.56), join=wt("join", 40.63), our=wt("our", 40.88), wa=wt("whatsapp", 41.07),
    grow=wt("grow", 54.01), evolve=wt("evolve", 54.37), earn=wt("earn", 54.92), demos=wt("demos", 56.69),
    practices=wt("practices", 57.31), agency=wt("agency", 58.62), your=wt("your", 29.07),
)

data_js = json.dumps(dict(punch=PUNCH, broll=BROLL, flickers=sorted(FLICKERS), heroes=HEROES, T=T,
                          dest=DEST, fps=FPS, lt=LT_WA, site=LT_SITE, depth=[DEPTH_S, DEPTH_E]))

tpl = (HERE / "index.template.html").read_text()
out = (tpl.replace("{{BROLL}}", broll_html).replace("{{CAPTIONS}}", "\n".join(cap_html))
          .replace("{{SFX}}", sfx_html).replace("{{BED_AUTO}}", html.escape(json.dumps(bed_auto)))
          .replace("{{HOOK}}", hook_spans).replace("{{DEST}}", f"{DEST:.3f}").replace("{{DATA}}", data_js).replace("{{DUR}}", str(DUR))
          .replace("{{T_YOUR NAME}}", f"{DEPTH_S:.3f}").replace("{{T_YOUR NAME_DUR}}", f"{DEPTH_E - DEPTH_S:.3f}")
          .replace("{{WA_LINK}}", html.escape(WA_LINK)).replace("{{SITE}}", html.escape(SITE))
          .replace("{{LT_WA_S}}", f"{LT_WA[0]:.3f}").replace("{{LT_WA_D}}", f"{LT_WA[1] - LT_WA[0]:.3f}")
          .replace("{{LT_SITE_S}}", f"{LT_SITE[0]:.3f}").replace("{{LT_SITE_D}}", f"{LT_SITE[1] - LT_SITE[0]:.3f}")
          .replace("{{FOLDERS_S}}", f"{FOLDERS[0]:.3f}").replace("{{FOLDERS_D}}", f"{FOLDERS[1] - FOLDERS[0]:.3f}")
          # the template carries a renamed root attribute so it is not a second composition root
          .replace("data-template-composition-id", "data-composition-id"))
for hid, s, e in HEROES:
    out = out.replace("{{H_%s_S}}" % hid, f"{s:.3f}").replace("{{H_%s_D}}" % hid, f"{e - s:.3f}")
assert "{{" not in out, re.findall(r"\{\{\w+\}\}", out)
(HERE / "index.html").write_text(out)
print(f"captions={len(cap_html)} (removed {len(removed)}) sfx={len(SFX)} flickers={len(FLICKERS)}")
print("REMOVED captions (overlap a higher-priority graphic):")
for s, txt, why in removed:
    print(f"  {s:6.2f}  {txt:<16} <- {why}")
