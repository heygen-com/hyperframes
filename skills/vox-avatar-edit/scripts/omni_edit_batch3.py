"""Omni edit v3 (skills v2): grammar-aware style half per case + content prompts per beat.

Reuses v1 Tokyo talking clips from ../grid/<case>/tokyo-beatN.mp4 (lips+voice untouched).
Usage: python3 omni_edit_batch3.py <case: c1|c2|c3>
Writes edit3-beatN.mp4 + grid-omniedit-v3.mp4 into grid-v2/<case>-edit/.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import warnings

warnings.filterwarnings("ignore")
from google.oauth2 import service_account
import google.auth.transport.requests

BASE = "https://generativelanguage.googleapis.com/v1beta"
HERE = os.path.dirname(os.path.abspath(__file__))
GRID_V1 = os.path.join(HERE, "..", "grid")

KEEP_HUMAN = """Keep the talking human in original format exactly where they are placed. Do not animate, move,
resize or redraw the human. Do not change the person's face, body, clothing or lip movements.
Avoid rendering words or letters; tell the story with objects, not text. No added dialogue. No music."""

STYLES = {
    "dark-data": """Visual style: dark data-journalism editorial animation with RESTRAINT. A charcoal page with
subtle print grain and heavy vignette; flat paper chart graphics in a single yellow accent, large
and clear; generous empty dark space - the scene must read at a glance. ONE hero prop tells the
story, at most one small supporting scrap. Elements slide in, settle, and hold calmly; the
background stays quiet behind the person.
""" + KEEP_HUMAN,
    "diagram": """Visual style: clean editorial diagram animation with RESTRAINT. A paper-white page with faint
print grain and generous negative space; objects drawn as thin dark outline line-art with flat
fills; thin blue annotation arrows that draw on; one hand-drawn red circle at most. ONE hero
diagram tells the story, at most one small supporting element. Lines draw on, settle, and hold
calmly; the background stays quiet behind the person.
""" + KEEP_HUMAN,
    "collage": """Visual style: analog paper-collage editorial animation with RESTRAINT. Large flat paper
color fields (deep purple, mustard, kraft tan, signal red) and generous empty space - the scene
must read at a glance. Only a small number of big, clear elements: ONE hero prop tells the story,
at most one small supporting scrap. Torn paper edges with white borders, halftone texture on
cutouts, soft 3-6px drop shadows, subtle paper grain. Elements slide in with stop-motion jitter,
settle, and hold calmly; the background stays quiet behind the person.
""" + KEEP_HUMAN,
}

# host layouts on a 1080x1920 canvas: (scale, x, y)
LAYOUTS = {
    "large":  (1080, 0, 840),
    "medium": (840, 120, 700),
    "small":  (620, 430, 1280),
    "small-left": (620, 30, 1280),
}

CASES = {
    "c1": {"src_dir": "c1-avatar", "style": "dark-data", "canvas": "0x1E1B18", "beats": [
        ("large", "The dark data world tells this beat's story: the biggest stock market debut in history selling out in days. ONE hero prop: a huge flat yellow paper line shooting up a charcoal chart grid behind the person. One small supporting scrap: a white price-tag card drifting in and settling."),
        ("small", "The dark data world tells this beat's story: a satellite internet business is the real engine of revenue. ONE hero prop: a large flat two-color pie chart whose yellow wedge sweeps open to dominate. One small supporting scrap: a few tiny satellite dots blinking into a mesh above it."),
        ("medium", "The dark data world tells this beat's story: the stock doubled, dipped under gravity, and still sits above launch price. ONE hero prop: a jagged yellow chart line that climbs steeply, peaks, tears downward, and settles above a dashed baseline."),
    ]},
    "c2": {"src_dir": "c2-edit", "style": "diagram", "canvas": "0xF4F1EA", "beats": [
        ("large", "The diagram world tells this beat's story: shipping a finished launch video faster than a coffee cools. ONE hero diagram: a thin-outline laptop with a filmstrip unspooling from its screen, a thin blue arrow drawing from the laptop toward the strip. One small supporting element: an outline coffee cup with two wavy steam lines."),
        ("small-left", "The diagram world tells this beat's story: a three-step machine - script, skill, render. ONE hero diagram: three empty outline cards cascading into a vertical column, connected one to the next by thin blue arrows drawing on in sequence."),
        ("medium", "The diagram world tells this beat's story: change one line, re-render free, a tenth of the cost. ONE hero diagram: a flat outline browser window where a red pencil stroke redraws one line inside; a hand-drawn red circle draws on around that line. One small supporting element: an outline price tag cut visibly smaller by outline scissors."),
    ]},
    "c3": {"src_dir": "c3-avatar", "style": "collage", "canvas": "0xE7D7B5", "beats": [
        ("large", "The collage world tells this beat's story: a stock that doubles twice at once. ONE hero prop: two stacks of gold paper coins side by side, each stack doubling in height one after the other."),
        ("small", "The collage world tells this beat's story: profits double and the market pays a doubled multiple. ONE hero prop: a cream paper speedometer dial whose indigo needle sweeps from low to high in two steps."),
        ("medium", "The collage world tells this beat's story: two times two makes four - and the same math cuts downward. ONE hero prop: four gold paper squares assembling into one bigger square, then one mustard up-arrow and one deep-purple down-arrow settling side by side."),
    ]},
}


def token():
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GEMINI_PREFAB_KEY"]),
        scopes=["https://www.googleapis.com/auth/generative-language"],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def api(method, path, body=None, tok=None, raw=False, timeout=560):
    req = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if raw else json.load(r)


def compose_source(src_dir, out_dir, n, layout, canvas):
    scale, x, y = LAYOUTS[layout]
    src = os.path.join(src_dir, f"tokyo-beat{n}.mp4")
    out = os.path.join(out_dir, f"lay-beat{n}.mp4")
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                         capture_output=True, text=True).stdout.strip()
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-threads", "2",
                    "-f", "lavfi", "-i", f"color={canvas}:s=1080x1920:d={dur}",
                    "-i", src,
                    "-filter_complex", f"[1:v]scale={scale}:{scale}[p];[0:v][p]overlay={x}:{y}:shortest=1[v]",
                    "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "18", out], check=True)
    return out, src


def edit_beat(spec, out_dir, n, layout, content, tok):
    src_dir = os.path.join(GRID_V1, spec["src_dir"])
    padded, src = compose_source(src_dir, out_dir, n, layout, spec["canvas"])
    with open(padded, "rb") as f:
        vid = base64.b64encode(f.read()).decode()
    prompt = content + "\n\n" + STYLES[spec["style"]]
    body = {"model": "gemini-omni-flash-preview",
            "input": [{"type": "video", "data": vid, "mime_type": "video/mp4"},
                      {"type": "text", "text": prompt}],
            "response_format": {"type": "video", "delivery": "uri"},
            "generation_config": {"video_config": {"task": "edit"}}}
    t0 = time.time()
    for attempt in range(3):
        try:
            resp = api("POST", "/interactions", body, tok)
            break
        except urllib.error.HTTPError as e:
            print(f"  beat{n} attempt {attempt+1}: HTTP {e.code} {e.read().decode()[:150]}")
            if attempt == 2:
                raise
            time.sleep(8)
    status, iid = resp.get("status"), resp.get("id")
    while status in ("in_progress", "queued", "pending", "processing"):
        time.sleep(10)
        resp = api("GET", f"/interactions/{iid}", tok=tok)
        status = resp.get("status")
    if status != "completed":
        raise RuntimeError(f"beat{n} status={status}: {json.dumps(resp)[:250]}")
    uri = next(c["uri"] for step in resp.get("steps", []) if isinstance(step.get("content"), list)
               for c in step["content"] if c.get("type") == "video" and c.get("uri"))
    usage = resp.get("usage", {})
    data = api("GET", uri.split(BASE)[-1] if uri.startswith(BASE) else uri, tok=tok, raw=True, timeout=300)
    raw_out = os.path.join(out_dir, f"edit3-beat{n}-raw.mp4")
    with open(raw_out, "wb") as f:
        f.write(data)
    out = os.path.join(out_dir, f"edit3-beat{n}.mp4")
    sdur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                capture_output=True, text=True).stdout.strip())
    edur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw_out],
                                capture_output=True, text=True).stdout.strip())
    factor = sdur / edur
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-threads", "2", "-i", raw_out, "-i", src,
                    "-filter_complex", f"[0:v]setpts=PTS*{factor:.6f}[v]",
                    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-crf", "18", "-c:a", "copy",
                    "-shortest", out], check=True)
    print(f"    conform {edur:.3f}s -> {sdur:.3f}s (x{factor:.4f})")
    print(f"  beat{n} [{layout}] done {time.time()-t0:.0f}s ~${usage.get('total_output_tokens',0)*17.5/1e6:.2f}")


def main():
    case = sys.argv[1]
    spec = CASES[case]
    out_dir = os.path.join(HERE, f"{case}-edit")
    os.makedirs(out_dir, exist_ok=True)
    tok = token()
    for i, (layout, content) in enumerate(spec["beats"], 1):
        edit_beat(spec, out_dir, i, layout, content, tok)
    with open(os.path.join(out_dir, "concat-edit3.txt"), "w") as f:
        for i in range(1, len(spec["beats"]) + 1):
            f.write(f"file 'edit3-beat{i}.mp4'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-threads", "2", "-f", "concat", "-safe", "0",
                    "-i", os.path.join(out_dir, "concat-edit3.txt"),
                    "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    os.path.join(out_dir, "grid-omniedit-v3.mp4")], check=True, cwd=out_dir)
    print("CONCAT DONE grid-omniedit-v3.mp4")


if __name__ == "__main__":
    main()
