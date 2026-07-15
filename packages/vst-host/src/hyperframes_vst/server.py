"""WebSocket sidecar server: JSON control lane + binary PCM lane on one socket.

pedalboard enforces a single-thread affinity for ALL native VST3/AU work in
a process, not just editor windows: whichever thread first loads a plugin
becomes "the" thread for every later load, and showing a native editor
window additionally requires that thread to be the true OS main thread (a
hard Cocoa/AppKit constraint on macOS — windows can only be created there).
Loading a plugin from a second, different thread raises
`RuntimeError('... must be reloaded on the main thread ...')`; showing an
editor from a non-main thread raises `RuntimeError('Plugin UI windows can
only be shown from the main thread.')` or a JUCE-side ObjC exception,
depending on which check trips first.

So every pedalboard-native call in this process — both `build_chain`
(loading plugins) and `show_editor` (opening a window) — is funneled
through `VstServer.run_pedalboard_thread`, one dedicated loop that runs on
the process's real main thread (`serve()`, bottom of this file) and
processes requests from a thread-safe queue, one at a time. The asyncio
WebSocket server itself runs on a background thread instead.
"""
from __future__ import annotations

import asyncio
import json
import queue
import secrets
import threading
from urllib.parse import parse_qs, urlsplit

import websockets
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

from .chain import PluginMissingError, build_chain, load_chain_spec, serialize_states
from .scan import default_plugin_dirs, scan_paths
from .stream import TrackStream


class VstServer:
    def __init__(self) -> None:
        self._tracks: dict[str, TrackStream] = {}
        self._plugins: dict[str, list] = {}
        self._play_task: asyncio.Task | None = None
        self._play_owner: object | None = None
        self._server: websockets.WebSocketServer | None = None
        self._rate = 1.0
        # Shared-secret handshake (see `_authenticate`): the sidecar accepts
        # native-plugin-loading and arbitrary-file-read commands over a plain
        # loopback WebSocket, so without this any local process — or a
        # webpage that guesses/scans the ephemeral port — could drive it.
        # Generated once per process and printed alongside the ready line;
        # only a client that already has it (relayed by studio-server's
        # `/vst/start`, itself only reachable by the studio's own trusted
        # HTTP server) can open a connection.
        self._token = secrets.token_urlsafe(32)
        # All pedalboard-native work (plugin loading + editor windows) hands
        # off to the main thread through this queue (see module docstring).
        # Each item is (fn, args, kwargs, future, loop); the main-thread loop
        # calls fn(*args, **kwargs) and posts the result/exception back onto
        # the asyncio loop that's awaiting it via call_soon_threadsafe.
        self._pedalboard_queue: "queue.Queue[tuple | None]" = queue.Queue()
        # Keyed by (trackId, pluginIndex) so a later `close-editor` can find
        # and signal the right window before it's opened/while it's open.
        self._editor_close_events: dict[tuple[str, int], threading.Event] = {}

    @property
    def token(self) -> str:
        return self._token

    async def start(self, port: int = 0) -> int:
        self._server = await websockets.serve(
            self._handle, "127.0.0.1", port, process_request=self._authenticate,
        )
        bound = self._server.sockets[0].getsockname()[1]
        print(f"VST-HOST-LISTENING port={bound} token={self._token}", flush=True)
        return bound

    async def _authenticate(self, connection, request: Request) -> Response | None:
        """`process_request` hook: rejects the HTTP upgrade (before any
        WebSocket connection — and so before `_handle`/`_dispatch` ever see a
        message) unless the request carries the correct `?token=` query
        param. Returning `None` lets the handshake proceed normally."""
        query = parse_qs(urlsplit(request.path).query)
        supplied = query.get("token", [None])[0]
        if supplied != self._token:
            body = b"Unauthorized: missing or invalid token\n"
            return Response(401, "Unauthorized", Headers(), body)
        return None

    async def stop(self) -> None:
        if self._play_task:
            self._play_task.cancel()
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, ws) -> None:
        try:
            async for raw in ws:
                if not isinstance(raw, str):
                    continue
                msg = json.loads(raw)
                await self._dispatch(ws, msg)
        finally:
            if self._play_task and self._play_owner is ws:
                self._play_task.cancel()

    async def _run_on_pedalboard_thread(self, fn, *args):
        """Runs fn(*args) on the dedicated pedalboard thread (see module
        docstring) and awaits its result without blocking the event loop or
        this connection's other message handling."""
        loop = asyncio.get_running_loop()
        future = loop.create_future()

        def _call():
            try:
                result = fn(*args)
            except Exception as exc:
                loop.call_soon_threadsafe(future.set_exception, exc)
            else:
                loop.call_soon_threadsafe(future.set_result, result)

        self._pedalboard_queue.put(_call)
        return await future

    async def _dispatch(self, ws, msg: dict) -> None:
        cmd = msg.get("cmd")
        try:
            if cmd == "scan":
                plugins = await asyncio.to_thread(scan_paths, msg.get("paths") or default_plugin_dirs())
                await ws.send(json.dumps({"event": "registry", "plugins": plugins}))
            elif cmd == "load-chain":
                track_id = msg["trackId"]
                spec = load_chain_spec(json.dumps(msg["chainJson"]))
                # Only chains with an external VST3/AU plugin need the
                # dedicated pedalboard thread (see module docstring):
                # builtins never touch JUCE's native plugin-loading
                # machinery, so they're free to load off any thread pool
                # worker, same as before this thread-affinity fix existed.
                if any(p.format != "builtin" for p in spec.plugins):
                    plugins = await self._run_on_pedalboard_thread(build_chain, spec)
                else:
                    plugins = await asyncio.to_thread(build_chain, spec)
                old = self._tracks.pop(track_id, None)
                if old:
                    old.close()
                self._plugins[track_id] = plugins
                self._tracks[track_id] = TrackStream(len(self._tracks), msg["wavPath"], plugins)
                params = [
                    [{"name": k, "value": float(v.raw_value) if hasattr(v, "raw_value") else None}
                     for k, v in getattr(p, "parameters", {}).items()]
                    for p in plugins
                ]
                await ws.send(json.dumps({"event": "chain-loaded", "trackId": track_id, "params": params}))
            elif cmd == "unload-chain":
                track = self._tracks.pop(msg["trackId"], None)
                self._plugins.pop(msg["trackId"], None)
                if track:
                    track.close()
            elif cmd == "set-param":
                plugin = self._plugins[msg["trackId"]][msg["pluginIndex"]]
                setattr(plugin, msg["param"], msg["value"])
            elif cmd == "open-editor":
                track_id, plugin_index = msg["trackId"], msg["pluginIndex"]
                plugin = self._plugins[track_id][plugin_index]
                close_event = threading.Event()
                self._editor_close_events[(track_id, plugin_index)] = close_event

                def _open(plugin=plugin, close_event=close_event):
                    try:
                        plugin.show_editor(close_event)
                    finally:
                        self._editor_close_events.pop((track_id, plugin_index), None)

                # Fire-and-forget: don't await, so this connection's other
                # messages (e.g. close-editor) keep being handled while the
                # window is open (show_editor blocks the pedalboard thread,
                # not this coroutine).
                asyncio.create_task(self._run_on_pedalboard_thread(_open))
            elif cmd == "close-editor":
                close_event = self._editor_close_events.get((msg["trackId"], msg["pluginIndex"]))
                if close_event:
                    close_event.set()
            elif cmd == "get-state":
                states = serialize_states(self._plugins[msg["trackId"]])
                await ws.send(json.dumps({"event": "state", "trackId": msg["trackId"], "plugins": states}))
            elif cmd == "transport":
                await self._transport(ws, msg)
            else:
                await ws.send(json.dumps({"event": "error", "code": "bad_command"}))
        except PluginMissingError as exc:
            await ws.send(json.dumps({
                "event": "error", "code": "plugin_missing",
                "plugin": exc.plugin_name, "trackId": msg.get("trackId"),
            }))
        except Exception:
            await ws.send(json.dumps({
                "event": "error", "code": "bad_command",
                "trackId": msg.get("trackId"),
            }))

    async def _transport(self, ws, msg: dict) -> None:
        action = msg.get("action")
        if action == "seek":
            for track in self._tracks.values():
                track.seek(msg["timeSec"])
        elif action == "play":
            self._rate = msg.get("rate", 1.0)
            for track in self._tracks.values():
                track.seek(msg.get("timeSec", 0.0))
            if self._play_task:
                self._play_task.cancel()
            self._play_task = asyncio.create_task(self._pump(ws))
            self._play_owner = ws
        elif action == "pause":
            if self._play_task and self._play_owner is ws:
                self._play_task.cancel()
                self._play_task = None
                self._play_owner = None

    def run_pedalboard_thread(self) -> None:
        """Must run on the process's real main thread (see module
        docstring). Blocks, processing one pedalboard-native call at a
        time — a `show_editor` call itself blocks this loop until its
        window is closed (by the user or `close-editor`), which is exactly
        why plugin loading and editor windows must serialize through this
        one thread rather than pedalboard's calls being split across
        `asyncio.to_thread`'s pool. Returns when `stop_pedalboard_thread()`
        enqueues the shutdown sentinel."""
        while True:
            call = self._pedalboard_queue.get()
            if call is None:
                return
            call()

    def stop_pedalboard_thread(self) -> None:
        self._pedalboard_queue.put(None)

    async def _pump(self, ws) -> None:
        while True:
            sent_any = False
            delay = 1024 / 48000
            for track in list(self._tracks.values()):
                frame = track.next_block()
                if frame is None:
                    continue
                delay = track.block_size / track.sample_rate
                await ws.send(frame)
                sent_any = True
            if not sent_any:
                return
            await asyncio.sleep(delay / self._rate)


def serve(port: int = 0) -> None:
    server = VstServer()
    started = threading.Event()

    def _run_asyncio_server() -> None:
        async def _run() -> None:
            await server.start(port)
            started.set()
            await asyncio.Future()

        asyncio.run(_run())

    thread = threading.Thread(target=_run_asyncio_server, daemon=True)
    thread.start()
    started.wait()
    try:
        server.run_pedalboard_thread()
    except KeyboardInterrupt:
        server.stop_pedalboard_thread()
