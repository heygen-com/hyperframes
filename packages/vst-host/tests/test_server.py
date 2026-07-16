import asyncio
import base64
import json
import threading
import time

import numpy as np
import pytest
import websockets
from pedalboard.io import AudioFile

from hyperframes_vst.server import VstServer
from hyperframes_vst.stream import (
    MAX_STABLE_PEAK,
    TrackStream,
    decode_frame,
    output_is_stable,
    probe_chain_stability,
)


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
async def test_chain_loaded_reports_the_dry_files_real_sample_rate(tmp_path):
    # dry_wav (used by most other tests here) happens to be 48000Hz already,
    # so it can't catch a client that ignores this field and hardcodes a
    # constant instead — a 44100Hz file (the common case for real music
    # tracks) makes the mismatch concrete: the sidecar must report the
    # FILE's own rate, not the wire protocol's usual round-number default.
    sr = 44100
    audio = (np.ones((2, sr)) * 0.25).astype(np.float32)
    path = str(tmp_path / "dry-44100.wav")
    with AudioFile(path, "w", sr, 2) as f:
        f.write(audio)

    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": path}))
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"
        assert loaded["sampleRate"] == 44100


def test_builtin_registry_entries_are_real_pedalboard_effect_classes():
    import pedalboard
    from hyperframes_vst.scan import builtin_registry

    entries = builtin_registry()
    assert len(entries) >= 10
    names = {e["name"] for e in entries}
    assert {"Reverb", "Delay", "Distortion"} <= names  # the staples must be offered
    for e in entries:
        assert e["format"] == "builtin"
        # `path` must resolve to a real pedalboard class (chain.py builds it via
        # getattr(pedalboard, path)); a typo here would 404 the effect at add time.
        assert isinstance(getattr(pedalboard, e["path"], None), type), e["path"]


@pytest.mark.asyncio
async def test_scan_lists_builtins_ahead_of_discovered_plugins(monkeypatch):
    # Isolate from whatever plugins happen to be installed on the test machine.
    monkeypatch.setattr("hyperframes_vst.server.scan_paths", lambda *a, **k: [])
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "scan"}))
        reg = await recv_json(ws)
        assert reg["event"] == "registry"
        names = [p["name"] for p in reg["plugins"]]
        assert "Reverb" in names and "Delay" in names
        assert all(p["format"] == "builtin" for p in reg["plugins"])  # only builtins, since disk scan is stubbed empty
    await server.stop()


def test_output_is_stable_accepts_normal_and_rejects_nan_inf_and_runaway():
    sr = 1000
    assert output_is_stable(np.zeros((2, sr), dtype=np.float32)) is True
    assert output_is_stable((np.ones((2, sr)) * 0.8).astype(np.float32)) is True
    nan = np.zeros((2, sr), dtype=np.float32)
    nan[0, 5] = np.nan
    assert output_is_stable(nan) is False
    inf = np.zeros((2, sr), dtype=np.float32)
    inf[1, 3] = np.inf
    assert output_is_stable(inf) is False
    # Some plugins run away to astronomical (still-finite) magnitudes before
    # hitting NaN — those are unstable too (see ValhallaFreqEcho under pedalboard).
    runaway = np.full((2, sr), MAX_STABLE_PEAK * 10, dtype=np.float32)
    assert output_is_stable(runaway) is False


def test_probe_reports_a_working_builtin_chain_as_stable(dry_wav):
    from hyperframes_vst.chain import build_chain, load_chain_spec

    plugins = build_chain(load_chain_spec(json.dumps(CHAIN)))
    assert probe_chain_stability(dry_wav, plugins) is True


def test_unstable_track_never_emits_a_frame(dry_wav):
    # An unstable chain is still constructed (so its wire index stays in
    # lockstep with the client), but must never stream — the client keeps it dry.
    from hyperframes_vst.chain import build_chain, load_chain_spec

    plugins = build_chain(load_chain_spec(json.dumps(CHAIN)))
    track = TrackStream(0, dry_wav, plugins, stable=False)
    assert track.next_block() is None
    track.close()


@pytest.mark.asyncio
async def test_chain_loaded_reports_stability_and_unstable_never_streams(dry_wav, monkeypatch):
    # Force the probe to declare the chain unstable without needing a plugin
    # that actually misbehaves in CI.
    monkeypatch.setattr("hyperframes_vst.server.probe_chain_stability", lambda *a, **k: False)
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "m", "chainJson": CHAIN, "wavPath": dry_wav}))
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"
        assert loaded["stable"] is False

        await ws.send(json.dumps({"cmd": "transport", "action": "play", "timeSec": 0.0, "rate": 1.0}))
        # No PCM should ever arrive for an unstable track — the pump finds no
        # sendable frame and stops. Expect a timeout, not a binary frame.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(recv_binary(ws), timeout=1.0)
    await server.stop()


@pytest.mark.asyncio
async def test_load_chain_and_stream(dry_wav):
    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "music", "chainJson": CHAIN, "wavPath": dry_wav}))
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"
        assert loaded["trackId"] == "music"
        # The client hardcoding a sample rate instead of reading this field
        # plays streamed PCM at the wrong pitch/speed, and its drift-check
        # then misreads the resulting rate mismatch as ever-growing drift.
        assert loaded["sampleRate"] == 48000  # dry_wav's real rate
        assert loaded["stable"] is True  # a builtin Gain chain hosts fine

        await ws.send(json.dumps({"cmd": "transport", "action": "play", "timeSec": 0.0, "rate": 1.0}))
        frame = await recv_binary(ws)
        idx, pos, pcm = decode_frame(frame)
        assert idx == 0
        assert pcm.shape[0] == 2
        await ws.send(json.dumps({"cmd": "transport", "action": "pause"}))
    await server.stop()


@pytest.mark.asyncio
async def test_pump_keeps_up_with_real_time(tmp_path):
    # The client plays streamed PCM through a real-time AudioContext: it
    # consumes exactly `sample_rate` samples per wall-clock second. If the
    # sidecar's pump delivers fewer than that, the client's ring buffer
    # starves — the worklet zero-fills the gaps (choppy/degraded audio) and
    # the shortfall accumulates as genuine drift until the drift-check trips
    # a destructive reseek (playback "cuts out").
    #
    # `_pump`'s open-loop `await sleep(block/rate)` never subtracts the time
    # spent processing+sending a block, nor the sleep's own overshoot, so the
    # real period is always LONGER than one block — a systematic production
    # deficit. This test drives real playback and asserts the delivered
    # sample count keeps pace with the wall clock it took to deliver them.
    sr = 48000
    seconds = 6
    audio = (np.ones((2, sr * seconds)) * 0.25).astype(np.float32)
    path = str(tmp_path / "long.wav")
    with AudioFile(path, "w", sr, 2) as f:
        f.write(audio)

    server = VstServer()
    port = await server.start(0)
    async with websockets.connect(ws_uri(server, port)) as ws:
        await ws.send(json.dumps({"cmd": "load-chain", "trackId": "m", "chainJson": CHAIN, "wavPath": path}))
        loaded = await recv_json(ws)
        assert loaded["event"] == "chain-loaded"

        await ws.send(json.dumps({"cmd": "transport", "action": "play", "timeSec": 0.0, "rate": 1.0}))

        # Drain the very first frame to mark the moment real streaming begins,
        # then measure only the steady-state pump from there (excludes the
        # one-time load/handshake latency, which the client anchors its drift
        # baseline to anyway).
        first = await recv_binary(ws)
        _idx, _pos, first_pcm = decode_frame(first)
        delivered = first_pcm.shape[1]
        start = time.monotonic()

        target_wall = 3.0
        while True:
            frame = await recv_binary(ws)
            _i, _p, pcm = decode_frame(frame)
            delivered += pcm.shape[1]
            if time.monotonic() - start >= target_wall:
                break

        elapsed = time.monotonic() - start
        await ws.send(json.dumps({"cmd": "transport", "action": "pause"}))

    real_time_samples = sr * elapsed
    ratio = delivered / real_time_samples
    # A real-time consumer needs >=100%; allow 1% for measurement jitter.
    assert ratio >= 0.99, (
        f"pump delivered {delivered} samples in {elapsed:.3f}s "
        f"({ratio:.1%} of the {real_time_samples:.0f} a real-time client consumes) "
        f"— production deficit starves the client ring buffer"
    )
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

        def __init__(self, track_index, wav_path, plugins, stable=True):
            self.sample_rate = 48000
            self.stable = stable

        def close(self):
            pass

    original = server_module.build_chain
    original_track_stream = server_module.TrackStream
    original_probe = server_module.probe_chain_stability
    server_module.build_chain = fake_build_chain
    server_module.TrackStream = _FakeTrackStream
    # The stability probe wraps plugins in a real Pedalboard, which the fake
    # _RecordingPlugin can't join; this test is only about thread affinity.
    server_module.probe_chain_stability = lambda *a, **k: True
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
        server_module.probe_chain_stability = original_probe

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


def test_raise_editor_window_is_a_safe_noop_off_macos(monkeypatch):
    # The editor-raise helper is macOS-only (System Events activation); on any
    # other platform it must return without spawning anything. Also proves it
    # never throws — it's best-effort and called from a fire-and-forget timer.
    import hyperframes_vst.server as server_module

    monkeypatch.setattr(server_module.sys, "platform", "linux")
    called = False

    def _fail(*a, **k):
        nonlocal called
        called = True
        raise AssertionError("must not spawn osascript off macOS")

    monkeypatch.setattr(server_module.subprocess, "run", _fail)
    server_module._raise_editor_window_macos()  # must not raise, must not call run
    assert called is False


def test_watch_parent_exits_when_orphaned(monkeypatch):
    # The sidecar self-reaps when its parent dies (getppid changes) so an
    # ungraceful studio-server death doesn't leave a stale `serve` process.
    import hyperframes_vst.server as server_module

    monkeypatch.setattr(server_module.time, "sleep", lambda *_: None)
    # First poll: parent unchanged (still alive) → keep waiting. Second poll:
    # ppid changed (orphaned) → must exit.
    ppids = iter([1234, 1234, 1])

    def fake_getppid():
        return next(ppids)

    monkeypatch.setattr(server_module.os, "getppid", fake_getppid)

    class _Exit(Exception):
        pass

    def fake_exit(code):
        raise _Exit(code)

    monkeypatch.setattr(server_module.os, "_exit", fake_exit)
    with pytest.raises(_Exit) as exc:
        server_module._watch_parent_and_exit(watch_pid=None, initial_ppid=1234, interval_sec=0)
    assert exc.value.args[0] == 0


def test_watch_parent_stays_alive_while_parent_lives(monkeypatch):
    # Never exit while getppid keeps returning the original parent — guards
    # against a watchdog that reaps a still-healthy sidecar.
    import hyperframes_vst.server as server_module

    calls = {"n": 0}

    def fake_sleep(*_):
        calls["n"] += 1
        if calls["n"] >= 5:
            raise KeyboardInterrupt  # break the loop after a few clean polls

    monkeypatch.setattr(server_module.time, "sleep", fake_sleep)
    monkeypatch.setattr(server_module.os, "getppid", lambda: 4242)

    def fail_exit(_code):
        raise AssertionError("must not exit while parent is alive")

    monkeypatch.setattr(server_module.os, "_exit", fail_exit)
    with pytest.raises(KeyboardInterrupt):
        server_module._watch_parent_and_exit(watch_pid=None, initial_ppid=4242, interval_sec=0)


def test_watch_parent_exits_when_watched_pid_dies(monkeypatch):
    # With an explicit --parent-pid (the studio-server pid), the sidecar polls
    # that pid via os.kill(pid, 0) — NOT getppid — because `uv run` sits
    # between them and would otherwise mask the spawner's death.
    import hyperframes_vst.server as server_module

    monkeypatch.setattr(server_module.time, "sleep", lambda *_: None)
    # getppid stays constant (the uv wrapper is alive) — proving the exit is
    # driven by the watched pid, not the ppid heuristic.
    monkeypatch.setattr(server_module.os, "getppid", lambda: 999)
    alive = iter([True, True, False])
    monkeypatch.setattr(server_module, "_process_alive", lambda _pid: next(alive))

    class _Exit(Exception):
        pass

    monkeypatch.setattr(server_module.os, "_exit", lambda code: (_ for _ in ()).throw(_Exit(code)))
    with pytest.raises(_Exit) as exc:
        server_module._watch_parent_and_exit(watch_pid=54321, initial_ppid=999, interval_sec=0)
    assert exc.value.args[0] == 0
