import asyncio
import base64
import json

import numpy as np
import pytest
import websockets
from pedalboard.io import AudioFile

from hyperframes_vst.server import VstServer
from hyperframes_vst.stream import decode_frame


@pytest.fixture
def dry_wav(tmp_path):
    sr = 48000
    audio = (np.ones((2, sr)) * 0.25).astype(np.float32)
    path = str(tmp_path / "dry.wav")
    with AudioFile(path, "w", sr, 2) as f:
        f.write(audio)
    return path


CHAIN = {
    "version": 1,
    "plugins": [{"format": "builtin", "path": "Gain", "pluginName": None, "name": "Gain", "stateB64": None}],
}


async def recv_json(ws):
    while True:
        msg = await asyncio.wait_for(ws.recv(), timeout=5)
        if isinstance(msg, str):
            return json.loads(msg)


async def recv_binary(ws):
    while True:
        msg = await asyncio.wait_for(ws.recv(), timeout=5)
        if isinstance(msg, bytes):
            return msg


@pytest.mark.asyncio
async def test_load_chain_and_stream(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": dry_wav}))
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"
        assert loaded["trackId"] == "music"

        await ws.send(json.dumps({"cmd": "transport", "action": "play", "timeSec": 0.0, "rate": 1.0}))
        frame = await recv_binary(ws)
        idx, pos, pcm = decode_frame(frame)
        assert idx == 0
        assert pcm.shape[0] == 2
        await ws.send(json.dumps({"cmd": "transport", "action": "pause"}))
    await server.stop()


@pytest.mark.asyncio
async def test_missing_plugin_reports_error(dry_wav):
    server = VstServer()
    port = await server.start(0)
    bad = {"version": 1, "plugins": [{"format": "vst3", "path": "/no/Gone.vst3", "pluginName": None, "name": "Gone", "stateB64": None}]}
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "t", "chainJson": bad, "wavPath": dry_wav}))
        err = await recv_json(ws)
        assert err["event"] == "error"
        assert err["code"] == "plugin_missing"
        assert err["plugin"] == "Gone"
    await server.stop()


@pytest.mark.asyncio
async def test_get_state_roundtrip(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "m", "chainJson": CHAIN, "wavPath": dry_wav}))
        await recv_json(ws)
        await ws.send(json.dumps({"cmd": "set-param", "trackId": "m", "pluginIndex": 0, "param": "gain_db", "value": -6.0}))
        await ws.send(json.dumps({"cmd": "get-state", "trackId": "m"}))
        state = await recv_json(ws)
        assert state["event"] == "state"
        params = json.loads(base64.b64decode(state["plugins"][0]))
        assert abs(params["gain_db"] + 6.0) < 1e-6
    await server.stop()
