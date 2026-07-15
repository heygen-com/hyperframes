import asyncio
import base64
import json
import threading

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


_USE_REAL_TOKEN = object()


def ws_uri(server: VstServer, port: int, token: object = _USE_REAL_TOKEN) -> str:
    """Builds the sidecar's WS URI with the shared-secret `?token=` query
    param (see server.py's `_authenticate`). Defaults to the server's real
    token; pass `token=None` for no query param at all, or any other string
    to test rejection with a wrong token."""
    used_token = server.token if token is _USE_REAL_TOKEN else token
    if used_token is None:
        return f"ws://127.0.0.1:{port}"
    return f"ws://127.0.0.1:{port}/?token={used_token}"


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
    async with websockets.connect(ws_uri(server, port)) as ws:
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
    # format="vst3" routes load-chain through the pedalboard thread (see
    # module docstring on server.py) — needs a consumer running, unlike the
    # builtin-only chains most other tests in this file use.
    host_thread = threading.Thread(target=server.run_pedalboard_thread, name="pedalboard", daemon=True)
    host_thread.start()
    bad = {"version": 1, "plugins": [{"format": "vst3", "path": "/no/Gone.vst3", "pluginName": None, "name": "Gone", "stateB64": None}]}
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "t", "chainJson": bad, "wavPath": dry_wav}))
        err = await recv_json(ws)
        assert err["event"] == "error"
        assert err["code"] == "plugin_missing"
        assert err["plugin"] == "Gone"
    server.stop_pedalboard_thread()
    host_thread.join(timeout=2)
    await server.stop()


@pytest.mark.asyncio
async def test_get_state_roundtrip(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "m", "chainJson": CHAIN, "wavPath": dry_wav}))
        await recv_json(ws)
        await ws.send(json.dumps({"cmd": "set-param", "trackId": "m", "pluginIndex": 0, "param": "gain_db", "value": -6.0}))
        await ws.send(json.dumps({"cmd": "get-state", "trackId": "m"}))
        state = await recv_json(ws)
        assert state["event"] == "state"
        params = json.loads(base64.b64decode(state["plugins"][0]))
        assert abs(params["gain_db"] + 6.0) < 1e-6
    await server.stop()


@pytest.mark.asyncio
async def test_unrelated_client_disconnect_does_not_kill_other_clients_playback(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws_a:
        await ws_a.send(
            json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": dry_wav})
        )
        loaded = await recv_json(ws_a)
        assert loaded["event"] == "chain-loaded"

        await ws_a.send(json.dumps({"cmd": "transport", "action": "play", "timeSec": 0.0, "rate": 1.0}))
        frame = await recv_binary(ws_a)
        idx, _pos, _pcm = decode_frame(frame)
        assert idx == 0

        # Client B connects and disconnects without ever calling play.
        ws_b = await websockets.connect(ws_uri(server, port))
        await ws_b.close()

        # Client A's playback must still be alive: another frame should arrive.
        frame2 = await recv_binary(ws_a)
        idx2, _pos2, _pcm2 = decode_frame(frame2)
        assert idx2 == 0

        await ws_a.send(json.dumps({"cmd": "transport", "action": "pause"}))
    await server.stop()


@pytest.mark.asyncio
async def test_unrelated_client_pause_does_not_kill_other_clients_playback(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws_a:
        await ws_a.send(
            json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": dry_wav})
        )
        loaded = await recv_json(ws_a)
        assert loaded["event"] == "chain-loaded"

        await ws_a.send(json.dumps({"cmd": "transport", "action": "play", "timeSec": 0.0, "rate": 1.0}))
        frame = await recv_binary(ws_a)
        idx, _pos, _pcm = decode_frame(frame)
        assert idx == 0

        # Client B connects and sends pause without ever having loaded or played anything itself.
        async with websockets.connect(ws_uri(server, port)) as ws_b:
            await ws_b.send(json.dumps({"cmd": "transport", "action": "pause"}))

            # Client A's playback must still be alive: another frame should arrive.
            frame2 = await recv_binary(ws_a)
            idx2, _pos2, _pcm2 = decode_frame(frame2)
            assert idx2 == 0

        await ws_a.send(json.dumps({"cmd": "transport", "action": "pause"}))
    await server.stop()


@pytest.mark.asyncio
async def test_command_for_unknown_track_id_replies_bad_command_instead_of_closing(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "get-state", "trackId": "never-loaded"}))
        err = await recv_json(ws)
        assert err["event"] == "error"
        assert err["code"] == "bad_command"

        # Connection must still be alive and able to handle further commands.
        await ws.send(
            json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": dry_wav})
        )
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"
    await server.stop()


@pytest.mark.asyncio
async def test_connect_with_correct_token_succeeds(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port, server.token)) as ws:
        await ws.send(json.dumps({"cmd": "get-state", "trackId": "never-loaded"}))
        err = await recv_json(ws)
        assert err["event"] == "error"
        assert err["code"] == "bad_command"
    await server.stop()


@pytest.mark.asyncio
async def test_connect_with_missing_token_is_rejected(dry_wav):
    server = VstServer()
    port = await server.start(0)
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(ws_uri(server, port, token=None)):
            pass
    await server.stop()


@pytest.mark.asyncio
async def test_connect_with_wrong_token_is_rejected(dry_wav):
    server = VstServer()
    port = await server.start(0)
    with pytest.raises(websockets.exceptions.InvalidStatus):
        async with websockets.connect(ws_uri(server, port, token="not-the-real-token")):
            pass
    await server.stop()


class _FakeEditorPlugin:
    """Mimics pedalboard's real-plugin contract just enough to test the
    hand-off: `show_editor(close_event)` blocks until the event is set."""

    def __init__(self):
        self.show_editor_calls = []
        self.calling_thread_name = None

    def show_editor(self, close_event=None):
        self.calling_thread_name = threading.current_thread().name
        self.show_editor_calls.append(close_event)
        if close_event is not None:
            close_event.wait(timeout=5)


async def _wait_until(predicate, timeout=5, interval=0.05):
    elapsed = 0.0
    while not predicate():
        await asyncio.sleep(interval)
        elapsed += interval
        if elapsed >= timeout:
            raise AssertionError("condition never became true")


@pytest.mark.asyncio
async def test_open_editor_runs_show_editor_on_the_pedalboard_thread_not_the_event_loop(dry_wav):
    """Regression test: pedalboard's show_editor() raises RuntimeError unless
    called from the process's real main thread (the pedalboard thread
    stands in for that here in tests). open-editor must hand off via the
    queue, not call show_editor() directly from the asyncio dispatch."""
    server = VstServer()
    port = await server.start(0)
    plugin = _FakeEditorPlugin()
    server._plugins["music"] = [plugin]

    host_thread = threading.Thread(target=server.run_pedalboard_thread, name="pedalboard", daemon=True)
    host_thread.start()

    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "open-editor", "trackId": "music", "pluginIndex": 0}))
        await _wait_until(lambda: len(plugin.show_editor_calls) == 1)

        assert plugin.calling_thread_name == "pedalboard"
        assert isinstance(plugin.show_editor_calls[0], threading.Event)
        assert ("music", 0) in server._editor_close_events

        await ws.send(json.dumps({"cmd": "close-editor", "trackId": "music", "pluginIndex": 0}))
        await _wait_until(lambda: ("music", 0) not in server._editor_close_events)

    server.stop_pedalboard_thread()
    host_thread.join(timeout=2)
    assert not host_thread.is_alive()
    await server.stop()


@pytest.mark.asyncio
async def test_load_chain_runs_on_the_same_pedalboard_thread_as_open_editor(dry_wav):
    """Regression test: pedalboard requires every native plugin-loading call
    AND every show_editor call to happen on the exact same thread for the
    life of the process (confirmed against a real VST3: loading a second
    plugin from a different thread than the first raises RuntimeError, and
    show_editor requires that same thread to be the true main thread). If
    load-chain's `build_chain` call ever goes back to running on
    `asyncio.to_thread`'s pool instead of the pedalboard thread, this test
    catches the regression before it reaches a real plugin."""
    server = VstServer()
    port = await server.start(0)

    host_thread = threading.Thread(target=server.run_pedalboard_thread, name="pedalboard", daemon=True)
    host_thread.start()

    calling_threads = []

    class _RecordingPlugin:
        def show_editor(self, close_event=None):
            calling_threads.append(threading.current_thread().name)
            if close_event is not None:
                close_event.wait(timeout=5)

    import hyperframes_vst.server as server_module

    # format="vst3" (not "builtin"): this is the case that must route
    # through the pedalboard thread, per the conditional in _dispatch.
    external_chain = {
        "version": 1,
        "plugins": [{"format": "vst3", "path": "/fake.vst3", "pluginName": None, "name": "Fake", "stateB64": None}],
    }

    def fake_build_chain(spec):
        calling_threads.append(threading.current_thread().name)
        return [_RecordingPlugin()]

    class _FakeTrackStream:
        """Stands in for the real TrackStream, which internally builds a
        real pedalboard.Pedalboard(plugins) — incompatible with the fake
        _RecordingPlugin above. This test is only about which thread
        build_chain/show_editor run on, not audio streaming."""

        def __init__(self, track_index, wav_path, plugins):
            pass

        def close(self):
            pass

    original = server_module.build_chain
    original_track_stream = server_module.TrackStream
    server_module.build_chain = fake_build_chain
    server_module.TrackStream = _FakeTrackStream
    try:
        async with websockets.connect(ws_uri(server, port)) as ws:
            await ws.send(
                json.dumps(
                    {"cmd": "load-chain", "trackId": "music", "chainJson": external_chain, "wavPath": dry_wav}
                )
            )
            loaded = await recv_json(ws)
            assert loaded["event"] == "chain-loaded"

            await ws.send(json.dumps({"cmd": "open-editor", "trackId": "music", "pluginIndex": 0}))
            await _wait_until(lambda: len(calling_threads) == 2)

            assert calling_threads == ["pedalboard", "pedalboard"]

            await ws.send(json.dumps({"cmd": "close-editor", "trackId": "music", "pluginIndex": 0}))
            await _wait_until(lambda: ("music", 0) not in server._editor_close_events)
    finally:
        server_module.build_chain = original
        server_module.TrackStream = original_track_stream

    server.stop_pedalboard_thread()
    host_thread.join(timeout=2)
    await server.stop()


@pytest.mark.asyncio
async def test_builtin_chain_load_does_not_require_the_pedalboard_thread(dry_wav):
    """A builtin plugin (Gain, Reverb, ...) never touches JUCE's native
    plugin-loading machinery, so load-chain must keep working even when
    nobody has started run_pedalboard_thread() — exactly the setup every
    other test in this file already uses. This guards the fast path the
    external-plugin fix (above) must not regress."""
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": dry_wav}))
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"
    await server.stop()
