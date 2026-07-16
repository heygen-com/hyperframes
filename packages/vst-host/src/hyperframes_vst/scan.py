"""Plugin discovery. Every bundle probe runs in a throwaway subprocess:
a malformed bundle can SIGBUS the probing process (observed with macOS
CoreAudio.component), so the sidecar process itself never loads candidates."""
from __future__ import annotations

import json
import os
import subprocess
import sys

BUNDLE_EXTENSIONS = {".vst3": "vst3", ".component": "au"}
PROBE_TIMEOUT_SEC = 10

# pedalboard's built-in effects that host cleanly with no constructor args and
# no external plugin file — the reliable, always-available options (unlike
# third-party VST3/AU, which pedalboard's headless host can't run for a real
# subset; see the stability guard). Each maps to a `pedalboard.<name>` class in
# chain.py's `_build_builtin` (format "builtin", path = the class name).
# Ordered most-useful-first for the FX picker. Convolution and IIRFilter are
# excluded: they require constructor arguments (an impulse response / filter
# coefficients) this add flow can't supply.
BUILTIN_EFFECTS = [
    "Reverb", "Delay", "Chorus", "Phaser", "Distortion", "Compressor",
    "Limiter", "NoiseGate", "Gain", "PitchShift", "Bitcrush", "Clipping",
    "LadderFilter", "LowpassFilter", "HighpassFilter", "PeakFilter",
    "LowShelfFilter", "HighShelfFilter", "MP3Compressor", "Invert",
]


def builtin_registry() -> list[dict]:
    """The built-in effects, in FX-picker registry form. `pluginName` is None
    (builtins take no sub-name), `path` is the pedalboard class name."""
    return [{"path": name, "name": name, "format": "builtin"} for name in BUILTIN_EFFECTS]


def default_plugin_dirs() -> list[str]:
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        return [
            "/Library/Audio/Plug-Ins/VST3",
            f"{home}/Library/Audio/Plug-Ins/VST3",
            "/Library/Audio/Plug-Ins/Components",
            f"{home}/Library/Audio/Plug-Ins/Components",
        ]
    if sys.platform == "win32":
        return [r"C:\Program Files\Common Files\VST3"]
    return []


def _probe(bundle: str, probe_cmd: list[str]) -> list[dict]:
    try:
        proc = subprocess.run(
            probe_cmd + [bundle], capture_output=True, text=True, timeout=PROBE_TIMEOUT_SEC
        )
    except subprocess.TimeoutExpired:
        return []
    if proc.returncode != 0:
        return []
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return []


def scan_paths(dirs: list[str], probe_cmd: list[str] | None = None) -> list[dict]:
    cmd = probe_cmd or [sys.executable, "-m", "hyperframes_vst", "probe"]
    registry: list[dict] = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for entry in sorted(os.listdir(d)):
            _, ext = os.path.splitext(entry)
            fmt = BUNDLE_EXTENSIONS.get(ext.lower())
            if fmt is None:
                continue
            bundle = os.path.join(d, entry)
            for item in _probe(bundle, cmd):
                registry.append({"path": bundle, "name": item["name"], "format": fmt})
    return registry


def probe_bundle(path: str) -> list[dict]:
    """Runs IN the throwaway subprocess. May crash; caller tolerates."""
    from pedalboard._pedalboard import AudioUnitPlugin, VST3Plugin

    cls = AudioUnitPlugin if path.lower().endswith(".component") else VST3Plugin
    names = cls.get_plugin_names_for_file(path)
    return [{"name": n} for n in names]
