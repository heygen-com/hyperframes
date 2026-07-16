"""Route A demo: sequential Omni generation with last-frame chaining."""
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

OUT = os.path.dirname(os.path.abspath(__file__))
BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "gemini-omni-flash-preview"
MAX_RETRIES = 2


def token():
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GEMINI_PREFAB_KEY"]),
        scopes=["https://www.googleapis.com/auth/generative-language"],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def api(method, path, body=None, tok=None, raw=False, timeout=560):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if raw else json.load(r)


def gen_beat(beat, style, ref_frame_path, ledger):
    tok = token()
    prompt = f"{beat['visual']}\n\nStyle: {style}"
    inp = [{"type": "text", "text": prompt}]
    if beat["task"] == "image_to_video" and ref_frame_path:
        with open(ref_frame_path, "rb") as f:
            inp.insert(0, {
                "type": "image",
                "data": base64.b64encode(f.read()).decode(),
                "mime_type": "image/jpeg",
            })
    body = {
        "model": MODEL,
        "input": inp,
        "response_format": {"type": "video", "aspect_ratio": "9:16", "delivery": "uri"},
        "generation_config": {"video_config": {"task": beat["task"]}},
    }
    t0 = time.time()
    resp = api("POST", "/interactions", body, tok)
    status = resp.get("status")
    iid = resp.get("id")
    while status in ("in_progress", "queued", "pending", "processing"):
        time.sleep(8)
        resp = api("GET", f"/interactions/{iid}", tok=tok)
        status = resp.get("status")
        if time.time() - t0 > 520:
            raise RuntimeError("poll timeout")
    if status != "completed":
        raise RuntimeError(f"status={status} resp={json.dumps(resp)[:400]}")

    uri = None
    for step in resp.get("steps", []):
        for c in step.get("content", []) if isinstance(step.get("content"), list) else []:
            if c.get("type") == "video" and c.get("uri"):
                uri = c["uri"]
    if not uri:
        raise RuntimeError(f"no video uri: {json.dumps(resp)[:400]}")

    path = uri.split(BASE)[-1] if uri.startswith(BASE) else uri
    data = api("GET", path, tok=tok, raw=True, timeout=300)
    clip = os.path.join(OUT, f"beat{beat['id']}.mp4")
    with open(clip, "wb") as f:
        f.write(data)
    gen_s = time.time() - t0
    usage = resp.get("usage", {})
    ledger.append({
        "beat": beat["id"], "label": beat["label"], "task": beat["task"],
        "gen_seconds": round(gen_s), "bytes": len(data),
        "output_tokens": usage.get("total_output_tokens"),
        "usd_est": round(usage.get("total_output_tokens", 0) * 17.5 / 1e6, 3),
    })
    print(f"beat{beat['id']} [{beat['label']}] ok: {gen_s:.0f}s, {len(data)} bytes, ~${ledger[-1]['usd_est']}")

    last = os.path.join(OUT, f"beat{beat['id']}-last.jpg")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-sseof", "-0.1", "-i", clip, "-frames:v", "1", "-q:v", "2", last],
        check=True,
    )
    return last


def main():
    with open(os.path.join(OUT, "beats.json")) as f:
        spec = json.load(f)
    ledger = []
    ref = None
    for beat in spec["beats"]:
        for attempt in range(MAX_RETRIES + 1):
            try:
                ref = gen_beat(beat, spec["style_block"], ref, ledger)
                break
            except (RuntimeError, urllib.error.HTTPError, urllib.error.URLError) as e:
                msg = e.read().decode()[:400] if isinstance(e, urllib.error.HTTPError) else str(e)[:400]
                print(f"beat{beat['id']} attempt {attempt+1} failed: {msg}")
                if attempt == MAX_RETRIES:
                    print("giving up on this beat — aborting")
                    sys.exit(1)
                time.sleep(5)
    with open(os.path.join(OUT, "ledger.json"), "w") as f:
        json.dump(ledger, f, indent=2)
    # picture-lock concat (mute, re-encode for uniformity)
    with open(os.path.join(OUT, "concat.txt"), "w") as f:
        for b in spec["beats"]:
            f.write(f"file 'beat{b['id']}.mp4'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i",
         os.path.join(OUT, "concat.txt"), "-an", "-c:v", "libx264", "-crf", "18",
         "-pix_fmt", "yuv420p", os.path.join(OUT, "picture-lock.mp4")],
        check=True, cwd=OUT,
    )
    total = sum(l["usd_est"] for l in ledger)
    print(f"DONE picture-lock.mp4 · total gen cost ~${total:.2f}")


if __name__ == "__main__":
    main()
