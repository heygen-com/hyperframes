import base64
import json

import pytest

from hyperframes_vst.chain import (
    ChainError,
    PluginMissingError,
    build_chain,
    load_chain_spec,
    serialize_states,
)


def make_spec_json(plugins):
    return json.dumps({"version": 1, "plugins": plugins})


def test_load_chain_spec_roundtrip():
    text = make_spec_json(
        [{"format": "builtin", "path": "Reverb", "pluginName": None, "name": "Reverb", "stateB64": None}]
    )
    spec = load_chain_spec(text)
    assert spec.version == 1
    assert spec.plugins[0].format == "builtin"
    assert spec.plugins[0].path == "Reverb"


def test_load_chain_spec_rejects_bad_version():
    with pytest.raises(ChainError):
        load_chain_spec(json.dumps({"version": 99, "plugins": []}))


def test_load_chain_spec_rejects_unknown_format():
    with pytest.raises(ChainError):
        load_chain_spec(make_spec_json([{"format": "vst2", "path": "x", "pluginName": None, "name": "x", "stateB64": None}]))


def test_build_chain_builtin_applies_state():
    state = base64.b64encode(json.dumps({"room_size": 0.75}).encode()).decode()
    spec = load_chain_spec(
        make_spec_json([{"format": "builtin", "path": "Reverb", "pluginName": None, "name": "Reverb", "stateB64": state}])
    )
    plugins = build_chain(spec)
    assert abs(plugins[0].room_size - 0.75) < 1e-6


def test_build_chain_missing_vst3_raises_named_error():
    spec = load_chain_spec(
        make_spec_json([{"format": "vst3", "path": "/nonexistent/Nope.vst3", "pluginName": None, "name": "Nope", "stateB64": None}])
    )
    with pytest.raises(PluginMissingError) as exc:
        build_chain(spec)
    assert "Nope" in str(exc.value)


def test_serialize_states_builtin_roundtrip():
    spec = load_chain_spec(
        make_spec_json([{"format": "builtin", "path": "Reverb", "pluginName": None, "name": "Reverb", "stateB64": None}])
    )
    plugins = build_chain(spec)
    plugins[0].room_size = 0.42
    states = serialize_states(plugins)
    restored = json.loads(base64.b64decode(states[0]))
    assert abs(restored["room_size"] - 0.42) < 1e-6


def test_enabled_defaults_true_and_reads_false():
    spec = load_chain_spec(
        make_spec_json(
            [
                {"format": "builtin", "path": "Reverb", "pluginName": None, "name": "R", "stateB64": None},
                {"format": "builtin", "path": "Gain", "pluginName": None, "name": "G", "stateB64": None, "enabled": False},
            ]
        )
    )
    assert spec.plugins[0].enabled is True  # absent -> enabled (old files)
    assert spec.plugins[1].enabled is False


def test_enabled_plugins_filters_the_board_but_build_keeps_all():
    from hyperframes_vst.chain import enabled_plugins

    spec = load_chain_spec(
        make_spec_json(
            [
                {"format": "builtin", "path": "Reverb", "pluginName": None, "name": "R", "stateB64": None},
                {"format": "builtin", "path": "Gain", "pluginName": None, "name": "G", "stateB64": None, "enabled": False},
                {"format": "builtin", "path": "Delay", "pluginName": None, "name": "D", "stateB64": None},
            ]
        )
    )
    built = build_chain(spec)
    assert len(built) == 3  # ALL constructed — indices stay chain-file aligned
    active = enabled_plugins(spec, built)
    assert [type(p).__name__ for p in active] == ["Reverb", "Delay"]  # bypassed Gain excluded
