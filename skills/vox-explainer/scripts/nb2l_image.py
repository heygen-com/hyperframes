#!/usr/bin/env python3
"""Generate one image asset via NB2L (gemini-3.1-flash-lite-image).

Usage:
  python3 nb2l_image.py "<prompt>" out.jpg [reference_image.jpg]

Env: GEMINI_PREFAB_KEY = Google service-account JSON (Infisical: experiment-framework/dev).
With a reference image, the face-protection rule is prepended automatically (identity
retention ArcFace-verified >= 0.88 with this rule).
"""
import base64
import json
import os
import sys
import urllib.request
import warnings

warnings.filterwarnings("ignore")
from google.oauth2 import service_account
import google.auth.transport.requests

MODEL = "gemini-3.1-flash-lite-image"
FACE_RULE = (
    "Keep the person's face 100% identical to the reference photo - same identity, same "
    "facial features, photorealistic face. Do NOT stylize, redraw, or cartoonify the face. "
    "Do not place any graphic elements over the face. "
)


def main():
    prompt, out = sys.argv[1], sys.argv[2]
    ref = sys.argv[3] if len(sys.argv) > 3 else None

    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GEMINI_PREFAB_KEY"]),
        scopes=["https://www.googleapis.com/auth/generative-language"],
    )
    creds.refresh(google.auth.transport.requests.Request())

    parts = []
    if ref:
        with open(ref, "rb") as f:
            parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(f.read()).decode()}})
        prompt = FACE_RULE + prompt
    parts.append({"text": prompt})

    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps({"contents": [{"parts": parts}],
                         "generationConfig": {"responseModalities": ["IMAGE"]}}).encode(),
        headers={"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=120))
    for cand in resp.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData")
            if inline and "image" in inline.get("mimeType", ""):
                with open(out, "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                print("saved", out)
                return
    print("ERROR: no image in response", json.dumps(resp, default=str)[:300])
    sys.exit(1)


if __name__ == "__main__":
    main()
