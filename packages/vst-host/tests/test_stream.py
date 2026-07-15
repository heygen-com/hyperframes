import json

import numpy as np
import pytest
from pedalboard.io import AudioFile

from hyperframes_vst.chain import build_chain, load_chain_spec
from hyperframes_vst.stream import TrackStream, decode_frame, encode_frame


@pytest.fixture
def dry_wav(tmp_path):
    sr = 48000
    audio = (np.sin(np.linspace(0, 440 * 2 * np.pi, sr)) * 0.5).astype(np.float32)
    stereo = np.stack([audio, audio])
    path = str(tmp_path / "dry.wav")
    with AudioFile(path, "w", sr, 2) as f:
        f.write(stereo)
    return path


def gain_plugins():
    spec = load_chain_spec(json.dumps({
        "version": 1,
        "plugins": [{"format": "builtin", "path": "Gain", "pluginName": None, "name": "Gain", "stateB64": None}],
    }))
    return build_chain(spec)


def test_frame_encode_decode_roundtrip():
    pcm = np.ones((2, 4), dtype=np.float32) * 0.5
    idx, pos, out = decode_frame(encode_frame(3, 12345, pcm))
    assert (idx, pos) == (3, 12345)
    assert np.array_equal(out, pcm)


def test_stream_produces_sequential_blocks(dry_wav):
    ts = TrackStream(0, dry_wav, gain_plugins())
    _, pos0, pcm0 = decode_frame(ts.next_block())
    _, pos1, _ = decode_frame(ts.next_block())
    assert pos0 == 0
    assert pos1 == 1024
    assert pcm0.shape[0] == 2


def test_seek_jumps_sample_cursor(dry_wav):
    ts = TrackStream(0, dry_wav, gain_plugins())
    ts.next_block()
    ts.seek(0.5)
    _, pos, _ = decode_frame(ts.next_block())
    assert pos == 24000


def test_eof_returns_none(dry_wav):
    ts = TrackStream(0, dry_wav, gain_plugins())
    ts.seek(10.0)
    assert ts.next_block() is None
