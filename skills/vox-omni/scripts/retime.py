"""Retime route-A demo: ASR each VO, speed up each beat's video to match speech duration."""
import json
import os
import subprocess

from faster_whisper import WhisperModel

OUT = os.path.dirname(os.path.abspath(__file__))
SRC_BEAT_LEN = 10.0
LEAD = 0.4          # silence before VO starts in each beat
TAIL = 0.6          # breathing room after VO ends
TAIL_LAST = 1.2     # longer hold on the static payoff beat
MAX_SPEEDUP = 2.0


def run(cmd):
    subprocess.run(cmd, check=True, cwd=OUT, capture_output=True)


def main():
    try:
        model = WhisperModel("base", device="cpu", compute_type="int8")
    except Exception:
        model = None
    with open(os.path.join(OUT, "beats.json")) as f:
        beats = json.load(f)["beats"]

    plan = []
    for i, b in enumerate(beats):
        try:
            if model is None: raise RuntimeError("no model")
            segs, _ = model.transcribe(os.path.join(OUT, f"vo{b['id']}.mp3"), word_timestamps=True)
            words = [w for s in segs for w in s.words]
            speech_end = words[-1].end if words else 6.0
        except Exception:
            out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "csv=p=0", os.path.join(OUT, f"vo{b['id']}.mp3")],
                                 capture_output=True, text=True, check=True)
            speech_end = float(out.stdout.strip()) - 0.05
        tail = TAIL_LAST if i == len(beats) - 1 else TAIL
        target = max(LEAD + speech_end + tail, SRC_BEAT_LEN / MAX_SPEEDUP)
        plan.append({"beat": b["id"], "label": b["label"], "speech": round(speech_end, 2),
                     "target": round(target, 2), "speedup": round(SRC_BEAT_LEN / target, 2)})

    # retime each clip (video only)
    for p in plan:
        factor = p["target"] / SRC_BEAT_LEN
        run(["ffmpeg", "-y", "-v", "error", "-i", f"beat{p['beat']}.mp4",
             "-vf", f"setpts=PTS*{factor}", "-an", "-r", "24",
             "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", f"beat{p['beat']}-fast.mp4"])

    with open(os.path.join(OUT, "concat-fast.txt"), "w") as f:
        for p in plan:
            f.write(f"file 'beat{p['beat']}-fast.mp4'\n")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "concat-fast.txt",
         "-c", "copy", "picture-lock-fast.mp4"])

    # mux VO at new offsets
    inputs, filters, amix = ["-i", "picture-lock-fast.mp4"], [], []
    t = 0.0
    for i, p in enumerate(plan):
        p["starts_at"] = round(t, 2)
        delay = int((t + LEAD) * 1000)
        inputs += ["-i", f"vo{p['beat']}.mp3"]
        filters.append(f"[{i+1}:a]adelay={delay}|{delay},apad[a{i}]")
        amix.append(f"[a{i}]")
        t += p["target"]
    total = round(t, 2)
    fc = ";".join(filters) + f";{''.join(amix)}amix=inputs={len(plan)}:normalize=0,atrim=0:{total},loudnorm=I=-16:TP=-1.5[aout]"
    run(["ffmpeg", "-y", "-v", "error"] + inputs + [
        "-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "final-route-a-v2.mp4"])

    print(json.dumps(plan, indent=2))
    print(f"total: {total}s (was 40.0s)")


if __name__ == "__main__":
    main()
