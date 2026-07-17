import json
import subprocess
import sys

import numpy as np
import pytest
from pedalboard.io import AudioFile

from hyperframes_vst.bounce import bounce_file


@pytest.fixture
def dry_wav(tmp_path):
    sr = 48000
    rng = np.random.default_rng(7)
    audio = (rng.standard_normal((2, sr * 2)) * 0.1).astype(np.float32)
    path = str(tmp_path / "dry.wav")
    with AudioFile(path, "w", sr, 2) as f:
        f.write(audio)
    return path


@pytest.fixture
def reverb_chain(tmp_path):
    path = tmp_path / "chain.json"
    path.write_text(json.dumps({
        "version": 1,
        "plugins": [{"format": "builtin", "path": "Reverb", "pluginName": None, "name": "Reverb", "stateB64": None}],
    }))
    return str(path)


def read_wav(path):
    with AudioFile(path) as f:
        return f.read(f.frames)


def test_bounce_changes_audio_and_preserves_length(dry_wav, reverb_chain, tmp_path):
    out = str(tmp_path / "wet.wav")
    bounce_file(dry_wav, reverb_chain, out)
    dry, wet = read_wav(dry_wav), read_wav(out)
    assert wet.shape == dry.shape
    assert not np.array_equal(wet, dry)


def test_bounce_deterministic_for_builtin(dry_wav, reverb_chain, tmp_path):
    a, b = str(tmp_path / "a.wav"), str(tmp_path / "b.wav")
    bounce_file(dry_wav, reverb_chain, a)
    bounce_file(dry_wav, reverb_chain, b)
    assert np.array_equal(read_wav(a), read_wav(b))


def test_cli_bounce_exit_codes(dry_wav, tmp_path):
    missing_chain = tmp_path / "missing.json"
    missing_chain.write_text(json.dumps({
        "version": 1,
        "plugins": [{"format": "vst3", "path": "/nonexistent/Gone.vst3", "pluginName": None, "name": "Gone", "stateB64": None}],
    }))
    proc = subprocess.run(
        [sys.executable, "-m", "hyperframes_vst", "bounce",
         "--input", dry_wav, "--chain", str(missing_chain), "--output", str(tmp_path / "o.wav")],
        capture_output=True, text=True,
    )
    assert proc.returncode == 3
    assert "PLUGIN_MISSING Gone" in proc.stderr


def test_bounce_bypasses_disabled_plugins(dry_wav, tmp_path):
    """A chain whose only plugin is disabled must bounce bit-identical to dry."""
    import json

    import numpy as np
    from pedalboard.io import AudioFile

    chain_path = tmp_path / "disabled.vstchain.json"
    chain_path.write_text(json.dumps({
        "version": 1,
        "plugins": [{
            "format": "builtin", "path": "Distortion", "pluginName": None,
            "name": "Distortion", "stateB64": None, "enabled": False,
        }],
    }))
    out = tmp_path / "out.wav"
    bounce_file(str(dry_wav), str(chain_path), str(out))
    with AudioFile(str(dry_wav)) as a, AudioFile(str(out)) as b:
        dry = a.read(a.frames)
        wet = b.read(b.frames)
    assert dry.shape == wet.shape
    # Within WAV-write quantization (the bounce re-encodes the file; a
    # 16-bit round trip alone is ~3e-5) — NOT within a Distortion's reach,
    # which the un-bypassed same chain fails by orders of magnitude.
    assert np.allclose(dry, wet, atol=5e-4)
