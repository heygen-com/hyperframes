"""WebSocket sidecar server: JSON control lane + binary PCM lane on one socket."""
from __future__ import annotations

import asyncio
import json
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

    async def _dispatch(self, ws, msg: dict) -> None:
        cmd = msg.get("cmd")
        try:
            if cmd == "scan":
                plugins = await asyncio.to_thread(scan_paths, msg.get("paths") or default_plugin_dirs())
                await ws.send(json.dumps({"event": "registry", "plugins": plugins}))
            elif cmd == "load-chain":
                track_id = msg["trackId"]
                spec = load_chain_spec(json.dumps(msg["chainJson"]))
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
                plugin = self._plugins[msg["trackId"]][msg["pluginIndex"]]
                threading.Thread(target=plugin.show_editor, daemon=True).start()
            elif cmd == "close-editor":
                pass  # pedalboard editors close from their own window chrome
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
    async def _run() -> None:
        server = VstServer()
        await server.start(port)
        await asyncio.Future()

    asyncio.run(_run())
