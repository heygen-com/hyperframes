"""Batch Omni edit: restyle each Tokyo beat into vox collage (human untouched), remux voice, concat.

Usage: python3 omni_edit_batch.py <case_dir> <beat_ids...>   e.g.  c1-avatar 1 2 3
Reads <case_dir>/tokyo-beatN.mp4, writes <case_dir>/edit-beatN.mp4 and <case_dir>/grid-omniedit.mp4
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

PROMPT = """Transform the raw talking-head footage into a mixed-media editorial collage animation rendered
entirely in 2D motion graphics. The aesthetic draws directly from analog collage art: torn paper edges
with raw, uneven white borders; dense halftone dot patterns on monochrome photographic cutouts; vintage
newspaper and magazine typography fragments layered as texture; and bold geometric color blocks including
deep purple, hot pink, kraft tan, and signal red. Every element casts a distinct drop shadow that shifts
subtly with movement. The overall feel is a kinetic editorial spread from a high-end design magazine.
Output Specifications: motion graphics only around the person. Subtle paper grain overlay at 8% opacity
throughout. Drop shadows on all paper elements offset 3-6px. Palette: Deep purple, Signal red, Mustard,
Kraft tan, Hot pink, and White. Keep the talking human in original format. Do not animate the human
himself. Do not change the person's face, body, clothing or lip movements. No added dialogue. No music."""


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


def edit_beat(case, n, tok):
    src = os.path.join(case, f"tokyo-beat{n}.mp4")
    padded = os.path.join(case, f"tokyo-beat{n}-916.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src,
                    "-vf", "scale=1080:1080,pad=1080:1920:0:420:color=0x9aa06b",
                    "-c:v", "libx264", "-crf", "18", "-an", padded], check=True)
    with open(padded, "rb") as f:
        vid = base64.b64encode(f.read()).decode()
    body = {"model": "gemini-omni-flash-preview",
            "input": [{"type": "video", "data": vid, "mime_type": "video/mp4"},
                      {"type": "text", "text": PROMPT}],
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
    raw_out = os.path.join(case, f"edit-beat{n}-raw.mp4")
    with open(raw_out, "wb") as f:
        f.write(data)
    out = os.path.join(case, f"edit-beat{n}.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw_out, "-i", src,
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", out], check=True)
    print(f"  beat{n} done {time.time()-t0:.0f}s ~${usage.get('total_output_tokens',0)*17.5/1e6:.2f}")
    return out


def main():
    case = os.path.join(GRID, sys.argv[1]) if not os.path.isabs(sys.argv[1]) else sys.argv[1]
    beats = [int(b) for b in sys.argv[2:]]
    tok = token()
    outs = []
    for n in beats:
        target = os.path.join(case, f"edit-beat{n}.mp4")
        if os.path.exists(target):
            print(f"  beat{n} exists, skip")
        else:
            edit_beat(case, n, tok)
        outs.append(f"edit-beat{n}.mp4")
    with open(os.path.join(case, "concat-edit.txt"), "w") as f:
        for o in outs:
            f.write(f"file '{o}'\n")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", os.path.join(case, "concat-edit.txt"),
                    "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    os.path.join(case, "grid-omniedit.mp4")], check=True, cwd=case)
    d = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                        os.path.join(case, "grid-omniedit.mp4")], capture_output=True, text=True).stdout.strip()
    print(f"CONCAT DONE grid-omniedit.mp4 {d}s")


if __name__ == "__main__":
    main()
