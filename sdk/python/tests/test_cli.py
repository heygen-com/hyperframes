"""Unit tests for CLI discovery, argv construction, and error handling."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from hyperframes import CLINotFoundError, HyperframesError, cli_version, resolve_cli
from hyperframes._cli import DEFAULT_ENV, build_flags, run


# -- resolve_cli -----------------------------------------------------------


def test_explicit_cli_wins(monkeypatch):
    monkeypatch.setenv("HYPERFRAMES_CLI", "from-env")
    assert resolve_cli("/opt/hyperframes") == ["/opt/hyperframes"]
    assert resolve_cli(Path("/opt/hf")) == ["/opt/hf"]
    assert resolve_cli(["node", "cli.js"]) == ["node", "cli.js"]


def test_env_var_is_shell_split(monkeypatch):
    monkeypatch.setenv("HYPERFRAMES_CLI", "npx --yes hyperframes@latest")
    assert resolve_cli() == ["npx", "--yes", "hyperframes@latest"]


def test_falls_back_to_path(monkeypatch):
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    assert resolve_cli() == ["/usr/bin/hyperframes"]


def test_finds_local_node_modules(monkeypatch, tmp_path):
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr("shutil.which", lambda name: None)
    binary = tmp_path / "node_modules" / ".bin" / "hyperframes"
    binary.parent.mkdir(parents=True)
    binary.touch()
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    assert resolve_cli(search_from=nested) == [str(binary)]


def test_missing_cli_raises_actionable_error(monkeypatch, tmp_path):
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr("shutil.which", lambda name: None)
    with pytest.raises(CLINotFoundError) as excinfo:
        resolve_cli(search_from=tmp_path)
    message = str(excinfo.value)
    assert "npm install -g hyperframes" in message
    assert "Node.js" in message


# -- build_flags -----------------------------------------------------------


@pytest.mark.parametrize(
    ("opts", "expected"),
    [
        ({"fps": 60}, ["--fps", "60"]),
        ({"quality": "high"}, ["--quality", "high"]),
        ({"skipped": None}, []),
        ({"strict": True}, ["--strict"]),
        ({"page_side_compositing": False}, ["--no-page-side-compositing"]),
        ({"variables": {"title": "Hi"}}, ["--variables", '{"title":"Hi"}']),
        ({"output": Path("/tmp/a.mp4")}, ["--output", "/tmp/a.mp4"]),
    ],
)
def test_flag_mapping(opts, expected):
    assert build_flags(opts) == expected


def test_flag_order_follows_kwargs():
    assert build_flags({"fps": 30, "quality": "draft"}) == [
        "--fps",
        "30",
        "--quality",
        "draft",
    ]


# -- run -------------------------------------------------------------------


@pytest.fixture
def fake_run(monkeypatch):
    """Capture the subprocess.run call instead of spawning anything."""
    calls: list[dict] = []

    def _fake(argv, **kwargs):
        calls.append({"argv": argv, **kwargs})
        return subprocess.CompletedProcess(argv, 0, stdout="0.7.65\n", stderr="")

    monkeypatch.setattr("hyperframes._cli.subprocess.run", _fake)
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    return calls


def test_run_builds_argv_and_disables_telemetry(fake_run):
    run(["render", "--fps", "30"], cwd="/projects/demo")
    call = fake_run[0]
    assert call["argv"] == ["/usr/bin/hyperframes", "render", "--fps", "30"]
    assert call["cwd"] == "/projects/demo"
    for key, value in DEFAULT_ENV.items():
        assert call["env"][key] == value


def test_caller_env_overrides_defaults(fake_run):
    run(["render"], env={"NO_COLOR": "0", "MY_KEY": "x"})
    env = fake_run[0]["env"]
    assert env["NO_COLOR"] == "0"
    assert env["MY_KEY"] == "x"
    assert env["HYPERFRAMES_NO_TELEMETRY"] == "1"


def test_cli_version_reads_stdout(fake_run):
    assert cli_version() == "0.7.65"
    assert fake_run[0]["argv"][1:] == ["--version"]


def test_non_zero_exit_raises_with_stderr(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr(
        "hyperframes._cli.subprocess.run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 2, "", "boom: bad fps"),
    )
    with pytest.raises(HyperframesError) as excinfo:
        run(["render"])
    error = excinfo.value
    assert error.returncode == 2
    assert error.stderr == "boom: bad fps"
    assert "boom: bad fps" in str(error)
    assert error.command[0] == "/usr/bin/hyperframes"


def test_check_false_returns_failed_process(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr(
        "hyperframes._cli.subprocess.run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 1, "", "nope"),
    )
    assert run(["lint"], check=False).returncode == 1


def test_timeout_becomes_hyperframes_error(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)

    def _timeout(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, 1.0, output=b"partial", stderr=None)

    monkeypatch.setattr("hyperframes._cli.subprocess.run", _timeout)
    with pytest.raises(HyperframesError) as excinfo:
        run(["render"], timeout=1.0)
    assert "timed out after 1.0s" in str(excinfo.value)
    assert excinfo.value.stdout == "partial"


def test_unspawnable_cli_raises_cli_not_found(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/hyperframes")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)

    def _missing(argv, **kwargs):
        raise FileNotFoundError(argv[0])

    monkeypatch.setattr("hyperframes._cli.subprocess.run", _missing)
    with pytest.raises(CLINotFoundError):
        run(["render"])
