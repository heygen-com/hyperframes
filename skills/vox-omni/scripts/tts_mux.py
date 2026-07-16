"""Route A demo: editorial VO via Google Cloud TTS + mux over picture-lock."""
import base64
import json
import os
import subprocess
import sys
import urllib.request
import warnings

warnings.filterwarnings("ignore")
from google.oauth2 import service_account
import google.auth.transport.requests

OUT = os.path.dirname(os.path.abspath(__file__))
PREFERRED = ["en-US-Studio-Q", "en-US-Neural2-J", "en-US-Neural2-D", "en-US-Wavenet-D"]
BEAT_LEN = 10.0
VO_OFFSET = 0.8


def token():
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GOOGLE_TTS_SERVICE_ACCOUNT"]),
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def api(path, body=None, tok=None):
    req = urllib.request.Request(
        f"https://texttospeech.googleapis.com/v1{path}",
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def dur(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def main():
    tok = token()
    voices = {v["name"] for v in api("/voices?languageCode=en-US", tok=tok)["voices"]}
    voice = next((v for v in PREFERRED if v in voices), sorted(voices)[0])
    print("voice:", voice)

    with open(os.path.join(OUT, "beats.json")) as f:
        beats = json.load(f)["beats"]

    vo_files = []
    for b in beats:
        rate = 1.0
        for _ in range(3):
            resp = api("/text:synthesize", {
                "input": {"text": b["vo"]},
                "voice": {"languageCode": "en-US", "name": voice},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": rate},
            }, tok)
            path = os.path.join(OUT, f"vo{b['id']}.mp3")
            with open(path, "wb") as f:
                f.write(base64.b64decode(resp["audioContent"]))
            d = dur(path)
            if d <= BEAT_LEN - VO_OFFSET - 0.4:
                print(f"vo{b['id']}: {d:.1f}s @rate {rate}")
                break
            rate = round(rate + 0.08, 2)
            print(f"vo{b['id']}: {d:.1f}s too long, retry @rate {rate}")
        vo_files.append(path)

    # mux: silent picture-lock + 4 VO tracks at offsets
    inputs, filters, amix = ["-i", os.path.join(OUT, "picture-lock.mp4")], [], []
    for i, p in enumerate(vo_files):
        inputs += ["-i", p]
        delay_ms = int((i * BEAT_LEN + VO_OFFSET) * 1000)
        filters.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms},apad[a{i}]")
        amix.append(f"[a{i}]")
    fc = ";".join(filters) + f";{''.join(amix)}amix=inputs={len(vo_files)}:normalize=0,atrim=0:{len(vo_files)*BEAT_LEN},loudnorm=I=-16:TP=-1.5[aout]"
    cmd = ["ffmpeg", "-y", "-v", "error"] + inputs + [
        "-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        os.path.join(OUT, "final-route-a.mp4"),
    ]
    subprocess.run(cmd, check=True)
    print("DONE final-route-a.mp4", f"{dur(os.path.join(OUT, 'final-route-a.mp4')):.1f}s")


if __name__ == "__main__":
    main()
