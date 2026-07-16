"""Omni edit v2: content-aware per-beat prompts + per-beat host layout (pre-composed before edit).

Usage: python3 omni_edit_batch2.py <case: c1|c2|c3>
Reads tokyo-beatN.mp4 from the case dir, writes edit2-beatN.mp4 + grid-omniedit-v2.mp4.
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
GRID = os.path.dirname(os.path.abspath(__file__))

STYLE = """Visual style: analog paper-collage editorial animation with RESTRAINT. Large flat paper
color fields (deep purple, mustard, kraft tan, signal red) and generous empty space - the scene
must read at a glance. Only a small number of big, clear elements: ONE hero prop tells the story,
at most one small supporting scrap. Torn paper edges with white borders, halftone texture on
cutouts, soft 3-6px drop shadows, subtle paper grain. Elements slide in with stop-motion jitter,
settle, and hold calmly; the background stays quiet behind the person.
Keep the talking human in original format exactly where they are placed. Do not animate, move,
resize or redraw the human. Do not change the person's face, body, clothing or lip movements.
Avoid rendering words or letters; tell the story with objects, not text. No added dialogue. No music."""

# host layouts on a 1080x1920 canvas: (scale, x, y)
LAYOUTS = {
    "large":  (1080, 0, 840),
    "medium": (840, 120, 700),
    "small":  (620, 430, 1280),
    "small-left": (620, 30, 1280),
}

CASES = {
    "c1": {"dir": "c1-avatar", "beats": [
        ("large", "The collage world tells this beat's story: the biggest stock market debut in history. ONE hero prop: a vintage etched rocket cutout lifting off diagonally with a short torn-paper smoke trail. One small supporting scrap: an old paper admission ticket drifting in and settling."),
        ("small", "The collage world tells this beat's story: a satellite internet business spanning the planet. ONE hero prop: a big paper-cut world map on a flat field, with a few small white satellite-dish cutouts popping up across it one by one."),
        ("medium", "The collage world tells this beat's story: the stock doubled, fell back, and still sits above its launch price. ONE hero prop: a jagged signal-red paper chart line that climbs steeply, peaks, tears downward, and settles above a dashed baseline."),
    ]},
    "c2": {"dir": "c2-edit", "beats": [
        ("large", "The collage world tells this beat's story: shipping a finished launch video faster than a coffee cools. ONE hero prop: a paper-cut laptop with a filmstrip unspooling from its screen. One small supporting scrap: a paper coffee cup with two wavy steam strips."),
        ("small-left", "The collage world tells this beat's story: a three-step machine - script, skill, render. ONE hero prop: three numbered paper cards cascading into a neat vertical stack, one after another."),
        ("medium", "The collage world tells this beat's story: change one line, re-render free, a tenth of the cost. ONE hero prop: a big red paper pencil redrawing one strip of a filmstrip. One small supporting scrap: a paper price tag scissor-cut down to a small piece."),
    ]},
    "c3": {"dir": "c3-avatar", "beats": [
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


def compose_source(case_dir, n, layout):
    """Pre-compose the person onto a 1080x1920 canvas at the beat's layout."""
    scale, x, y = LAYOUTS[layout]
    src = os.path.join(case_dir, f"tokyo-beat{n}.mp4")
    out = os.path.join(case_dir, f"lay-beat{n}.mp4")
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                         capture_output=True, text=True).stdout.strip()
    subprocess.run(["ffmpeg", "-y", "-v", "error",
                    "-f", "lavfi", "-i", f"color=0x9aa06b:s=1080x1920:d={dur}",
                    "-i", src,
                    "-filter_complex", f"[1:v]scale={scale}:{scale}[p];[0:v][p]overlay={x}:{y}:shortest=1[v]",
                    "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "18", out], check=True)
    return out, src


def edit_beat(case_dir, n, layout, content, tok):
    padded, src = compose_source(case_dir, n, layout)
    with open(padded, "rb") as f:
        vid = base64.b64encode(f.read()).decode()
    prompt = content + "\n\n" + STYLE
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
    raw_out = os.path.join(case_dir, f"edit2-beat{n}-raw.mp4")
    with open(raw_out, "wb") as f:
        f.write(data)
    out = os.path.join(case_dir, f"edit2-beat{n}.mp4")
    sdur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                capture_output=True, text=True).stdout.strip())
    edur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw_out],
                                capture_output=True, text=True).stdout.strip())
    factor = sdur / edur
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw_out, "-i", src,
                    "-filter_complex", f"[0:v]setpts=PTS*{factor:.6f}[v]",
                    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-crf", "18", "-c:a", "copy",
                    "-shortest", out], check=True)
    print(f"    conform {edur:.3f}s -> {sdur:.3f}s (x{factor:.4f})")
    print(f"  beat{n} [{layout}] done {time.time()-t0:.0f}s ~${usage.get('total_output_tokens',0)*17.5/1e6:.2f}")


def main():
    spec = CASES[sys.argv[1]]
    case_dir = os.path.join(GRID, spec["dir"])
    tok = token()
    for i, (layout, content) in enumerate(spec["beats"], 1):
        edit_beat(case_dir, i, layout, content, tok)
    with open(os.path.join(case_dir, "concat-edit2.txt"), "w") as f:
        for i in range(1, len(spec["beats"]) + 1):
            f.write(f"file 'edit2-beat{i}.mp4'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", os.path.join(case_dir, "concat-edit2.txt"),
                    "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    os.path.join(case_dir, "grid-omniedit-v2.mp4")], check=True, cwd=case_dir)
    print("CONCAT DONE grid-omniedit-v2.mp4")


if __name__ == "__main__":
    main()
