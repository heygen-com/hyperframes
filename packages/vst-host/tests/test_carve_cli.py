import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np


def _write_wav(path: Path, freq: float = 1000.0, sr: int = 44100, seconds: float = 1.0) -> None:
    t = np.arange(int(sr * seconds)) / sr
    sig = (0.5 * np.sin(2 * np.pi * freq * t) * 32767).astype(np.int16)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(sig.tobytes())


def test_carve_verb_prints_bands_json(tmp_path: Path):
    voice = tmp_path / "voice.wav"
    _write_wav(voice, freq=1000.0)
    proc = subprocess.run(
        [sys.executable, "-m", "hyperframes_vst", "carve", "--voice", str(voice), "--json"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert "bands" in payload
    assert 2 <= len(payload["bands"]) <= 4
    for b in payload["bands"]:
        assert set(b) == {"freq", "gainDb", "q"}
