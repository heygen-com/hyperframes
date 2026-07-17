"""Chain spec: the persisted .vstchain.json contents and live plugin construction."""
from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass

import pedalboard

VALID_FORMATS = {"vst3", "au", "builtin"}


class ChainError(ValueError):
    pass


class PluginMissingError(ChainError):
    def __init__(self, name: str):
        super().__init__(f"Plugin not available on this machine: {name}")
        self.plugin_name = name


@dataclass
class PluginSpec:
    format: str
    path: str
    plugin_name: str | None
    name: str
    state_b64: str | None
    # Bypass toggle — absent in the JSON means enabled (backward compatible
    # with chain files written before the field existed). A disabled plugin
    # is still CONSTRUCTED (so set-param/get-state indices stay aligned with
    # the chain file) but excluded from the processing board — see
    # `enabled_plugins`.
    enabled: bool = True


@dataclass
class ChainSpec:
    version: int
    plugins: list[PluginSpec]


def load_chain_spec(json_text: str) -> ChainSpec:
    raw = json.loads(json_text)
    if raw.get("version") != 1:
        raise ChainError(f"Unsupported chain version: {raw.get('version')}")
    plugins = []
    for p in raw.get("plugins", []):
        fmt = p.get("format")
        if fmt not in VALID_FORMATS:
            raise ChainError(f"Unknown plugin format: {fmt}")
        plugins.append(
            PluginSpec(
                format=fmt,
                path=p["path"],
                plugin_name=p.get("pluginName"),
                name=p.get("name", p["path"]),
                state_b64=p.get("stateB64"),
                enabled=p.get("enabled", True) is not False,
            )
        )
    return ChainSpec(version=1, plugins=plugins)


def _build_builtin(spec: PluginSpec):
    cls = getattr(pedalboard, spec.path, None)
    if cls is None:
        raise PluginMissingError(spec.name)
    plugin = cls()
    if spec.state_b64:
        params = json.loads(base64.b64decode(spec.state_b64))
        for key, value in params.items():
            setattr(plugin, key, value)
    return plugin


def _build_external(spec: PluginSpec):
    if not os.path.exists(spec.path):
        raise PluginMissingError(spec.name)
    try:
        plugin = pedalboard.load_plugin(spec.path, plugin_name=spec.plugin_name)
    except Exception as exc:
        raise PluginMissingError(spec.name) from exc
    if spec.state_b64:
        plugin.raw_state = base64.b64decode(spec.state_b64)
    return plugin


def build_chain(spec: ChainSpec) -> list:
    return [_build_builtin(p) if p.format == "builtin" else _build_external(p) for p in spec.plugins]


def enabled_plugins(spec: ChainSpec, built: list) -> list:
    """The subset of `built` (from `build_chain(spec)`, same order) that should
    actually process audio. Disabled plugins are constructed but bypassed —
    keeping the full list's indices aligned with the chain file for
    set-param/get-state while the processing board skips them. An all-disabled
    chain yields an empty board, which pedalboard treats as a passthrough."""
    return [plugin for plugin, p in zip(built, spec.plugins) if p.enabled]


def _is_builtin(plugin) -> bool:
    return not hasattr(plugin, "raw_state")


def serialize_states(plugins: list) -> list[str]:
    states = []
    for plugin in plugins:
        if _is_builtin(plugin):
            params = {
                key: float(getattr(plugin, key))
                for key in dir(plugin)
                if not key.startswith("_") and isinstance(getattr(plugin, key), float)
            }
            states.append(base64.b64encode(json.dumps(params).encode()).decode())
        else:
            states.append(base64.b64encode(plugin.raw_state).decode())
    return states
