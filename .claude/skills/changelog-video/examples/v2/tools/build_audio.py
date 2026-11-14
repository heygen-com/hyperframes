#!/usr/bin/env python3
"""Writes every audio clip into index.html between the AUDIO markers, and the scene lengths.

This is the Nov 2-9, 2026 build: the HOLDS, VO_SEGS and cue() times below belong to that week's
script and picture. For a new week, keep the machinery and rewrite those three blocks.

cue(id, file, scene, local_t, vol): local_t is the scene-local time (before holds) where the
sound's PEAK lands, one frame after the picture it marks. Each clip stays its own <audio> so it
can be moved in Studio. Run from the project root: python3 tools/build_audio.py

Files it expects (SKILL.md step 0 copies them):
  assets/audio/vo.wav   the Annie voiceover (one file; VO_SEGS cuts it into phrases)
  assets/audio/bgm.mp3  the house track from <SKILL_DIR>/assets/bgm.mp3
  assets/sfx/*.mp3      from skills/media-use/audio/assets/sfx/ (see its CREDITS.md)
VO=0 builds a music-and-effects mix with no voice. MUSIC_VOL / SFX env vars rebalance.
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VO = os.environ.get("VO", "1") == "1" and os.path.exists(os.path.join(ROOT, "assets/audio/vo.wav"))
MUSIC_VOL = float(os.environ.get("MUSIC_VOL", "0.10" if VO else "0.36"))
END_BOOST = 2.2 if VO else 1.35  # with no voice to clear, the end card only lifts a little
SFX = float(os.environ.get("SFX", "0.8" if VO else "1.6"))
F = 1 / 30
VO_FILE_LEN = 37.03
VO_OLD_AT = 1.4  # where the single voice clip sat in v1: cue times below are still written in v1 scene-local time

# ---- pacing (v2.1): holds inserted into each scene, in v1 scene-local seconds: [time, extra seconds]
OLD = [("hook", 0, 5.05), ("t1", 5.05, 7.2), ("t2", 12.25, 5.6), ("t3", 17.85, 5.7), ("t4", 23.55, 7.05), ("t5", 30.6, 3.25), ("outro", 33.85, 6.65)]
HOLDS = {
    "hook": [[3.45, 0.8], [4.40, 0.4]],   # let the 20 chips register; let the 5 mint chips sit
    "t1": [[2.85, 0.5], [6.95, 0.9]],     # hold "matches the preview"; hold "0 pixels differ" + counter
    "t2": [[3.0, 0.4], [5.2, 0.7]],       # breath before the new setting; hold the centred streak
    "t3": [[3.1, 0.4], [5.3, 0.6]],       # breath before the tab; hold the storyboard
    "t4": [[1.6, 0.3], [3.6, 0.3], [6.6, 1.0]],  # fonts packed; parts uploading; hold "uploaded"
    "t5": [[3.0, 0.9]],                   # hold the 1.0 s timer
    "outro": [[1.1, -0.25]],              # the typed list is gone: logo comes a little sooner
}
def lmap(scene, t):
    return t + sum(d for T, d in HOLDS[scene] if t >= T - 1e-6)
NEW, at = {}, 0.0
for sid, st, du in OLD:
    nd = round(du + sum(d for T, d in HOLDS[sid] if T < du + 1e-6 and d > 0) + (0 if sid != "outro" else 0), 3)
    NEW[sid] = (round(at, 3), nd); at += nd
DUR = round(at, 3)
def fmap(t_old_film):
    """v1 film time -> v2.1 film time, through the scene that contains it."""
    for sid, st, du in OLD:
        if st - 1e-6 <= t_old_film < st + du:
            return NEW[sid][0] + lmap(sid, t_old_film - st), sid
    return NEW["outro"][0] + lmap("outro", t_old_film - 33.85), "outro"

# voice: v1 file split at sentence/phrase pauses -> (file in, file out, file time of the first word)
VO_SEGS = [(0.20, 1.85, 0.299), (1.85, 3.35, 2.133), (3.35, 6.34, 3.712), (6.34, 10.71, 6.613),
           (10.71, 13.70, 10.928), (13.70, 16.18, 13.872), (16.18, 19.40, 16.517), (19.40, 21.91, 19.632),
           (21.91, 23.69, 22.261), (23.69, 25.65, 23.882), (25.65, 29.11, 25.93), (29.11, 32.29, 29.301),
           (32.29, 33.32, 32.543), (33.32, 37.02, 33.636)]

PEAK = {  # file -> (peak offset, length), measured from skills/media-use/audio/assets/sfx
    "click.mp3": (.07, .37), "click-soft.mp3": (.07, .37), "key-press.mp3": (.08, .40), "typing.mp3": (.46, 1.50),
    "pop.mp3": (.12, .72), "impact-bass-1.mp3": (.07, 2.12), "whoosh.mp3": (.16, .57), "whoosh-short.mp3": (.16, .57),
    "glitch-1.mp3": (.82, 2.64), "error.mp3": (.74, 1.62), "chime.mp3": (.42, 2.50),
}
cues = []
def cue(cid, f, scene, local, vol):
    cues.append((cid, f, NEW[scene][0] + lmap(scene, local), vol))

# hook: typing, the Send press, zoom-through, 20 chips, five flip, chip opens
cue("a-type", "typing.mp3", "hook", 0.24, .14)
cue("a-type2", "typing.mp3", "hook", 0.85, .12)
cue("a-send", "click.mp3", "hook", 1.22, .45)
cue("a-zoom", "whoosh-short.mp3", "hook", 1.62, .30)
for i in range(0, 20, 4):
    cue(f"a-chip{i}", ["click.mp3", "click-soft.mp3", "key-press.mp3"][i % 3], "hook", 1.78 + i * .038, .10)
for i, at in enumerate([3.94, 4.01, 4.08, 4.15, 4.22]):
    cue(f"a-flip{i}", "key-press.mp3", "hook", at, .16)
cue("a-open", "whoosh.mp3", "hook", 4.9, .22)
# t1: render wipes, workers finish, stack, counter, whip out
cue("a-t1-ok", "pop.mp3", "t1", 2.18, .16)
for k, at in enumerate([3.95, 4.35, 4.85]):
    cue(f"a-t1-done{k}", "click-soft.mp3", "t1", at, .14)
cue("a-t1-stack", "whoosh-short.mp3", "t1", 5.4, .20)
cue("a-t1-same", "pop.mp3", "t1", 5.5, .14)
cue("a-t1-count", "typing.mp3", "t1", 6.1, .08)
cue("a-t1-whip", "whoosh.mp3", "t1", 7.15, .22)
# t2: streak, highlight, punch-in cut, slider
cue("a-t2-sweep", "whoosh-short.mp3", "t2", 0.7, .18)
cue("a-t2-hi", "key-press.mp3", "t2", 1.72, .14)
cue("a-t2-cut", "click-soft.mp3", "t2", 3.3, .14)
cue("a-t2-slide", "typing.mp3", "t2", 4.5, .10)
cue("a-t2-back", "click-soft.mp3", "t2", 4.3, .12)
# t3: scrub, tab press, storyboard steps, halftone out
cue("a-t3-scrub", "typing.mp3", "t3", 1.1, .08)
cue("a-t3-tab", "click.mp3", "t3", 3.6, .40)
for k, at in enumerate([4.3, 4.65, 5.0]):
    cue(f"a-t3-step{k}", "click.mp3", "t3", at, .14)
cue("a-t3-burst", "glitch-1.mp3", "t3", 5.4, .18)
# t4: fonts pack, parts, drop, resend, done
for k, at in enumerate([0.9, 1.05, 1.2]):
    cue(f"a-t4-font{k}", "click.mp3", "t4", at, .12)
cue("a-t4-pack", "pop.mp3", "t4", 1.37, .12)
cue("a-t4-split", "click-soft.mp3", "t4", 2.68, .12)
for k in range(3):
    cue(f"a-t4-part{k}", "click-soft.mp3", "t4", 3.0 + k * .3, .08)
cue("a-t4-drop", "error.mp3", "t4", 4.06, .16)
cue("a-t4-resend", "key-press.mp3", "t4", 4.9, .14)
cue("a-t4-done", "pop.mp3", "t4", 6.1, .16)
# t5: typing, replay, timer done
cue("a-t5-type", "typing.mp3", "t5", 0.42, .12)
cue("a-t5-done", "pop.mp3", "t5", 2.9, .18)
cue("a-t5-whip", "whoosh.mp3", "t5", 3.2, .2)
# outro: typed list, logo wipe, url pill
cue("a-o-logo", "chime.mp3", "outro", 1.3, .30)
cue("a-o-url", "key-press.mp3", "outro", 1.9, .12)

lines = []
for i, (fi, fo, fw) in enumerate(VO_SEGS if VO else []):
    t_new, _ = fmap(fw + VO_OLD_AT)
    st = t_new - (fw - fi)
    lines.append(f'    <audio id="vo{i+1:02d}" class="clip" src="assets/audio/vo.wav" data-start="{st:.3f}" data-duration="{fo - fi:.3f}" data-media-start="{fi:.3f}" data-volume="1" data-track-index="{9 + i % 2}"></audio>')
END = DUR - 2.6  # music opens up for the end card
lines.append(f'    <audio id="music" class="clip" src="assets/audio/bgm.mp3" data-start="0" data-duration="{END:.2f}" data-media-start="0" data-volume="{MUSIC_VOL}" data-fade-in="0.3" data-track-index="11"></audio>')
lines.append(f'    <audio id="music-end" class="clip" src="assets/audio/bgm.mp3" data-start="{END:.2f}" data-duration="{DUR - END:.2f}" data-media-start="{END:.2f}" data-volume="{MUSIC_VOL * END_BOOST:.3f}" data-fade-out="1.8" data-track-index="11"></audio>')
lane_end = []  # one Studio lane per overlap, starting at track 12
for cid, f, t, vol in sorted(cues, key=lambda c: c[2]):
    pk, ln = PEAK[f]
    start = max(0.0, t + F - pk)
    ln = min(ln, DUR - start)
    lane = next((i for i, e in enumerate(lane_end) if e <= start), None)
    if lane is None:
        lane_end.append(0); lane = len(lane_end) - 1
    lane_end[lane] = start + ln
    lines.append(f'    <audio id="{cid}" class="clip" src="assets/sfx/{f}" data-start="{start:.3f}" data-duration="{ln:.3f}" data-volume="{vol * SFX:.3f}" data-track-index="{12 + lane}"></audio>')

p = os.path.join(ROOT, "index.html")
html = open(p).read()
html = re.sub(r"(<!-- AUDIO:START -->\n)[\s\S]*?(\n\s*<!-- AUDIO:END -->)", lambda m: m.group(1) + "\n".join(lines) + m.group(2), html)
for sid, (st, du) in NEW.items():
    html = re.sub(r'(<div id="%s" [^>]*?data-start=")[^"]*(" data-duration=")[^"]*(")' % sid, lambda m: f"{m.group(1)}{st}{m.group(2)}{du}{m.group(3)}", html, flags=re.S)
html = re.sub(r'(data-composition-id="main" data-start="0" data-duration=")[^"]*(")', lambda m: f"{m.group(1)}{DUR}{m.group(2)}", html)
import json
block = "<script id=\"holds\">window.HOLDS = " + json.dumps(HOLDS) + ";</script>"
html = re.sub(r'<script id="holds">.*?</script>', block, html) if 'id="holds"' in html else html.replace("</head>", "  " + block + "\n</head>")
open(p, "w").write(html)
print("scenes:", {k: v for k, v in NEW.items()}, "total", DUR)
print(f"wrote {len(lines)} audio clips")
