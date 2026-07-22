"""Unit tests for Project — argv construction and artifact handling."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from hyperframes import HyperframesError, Project

COMPOSITION = '<main data-composition-id="main" data-width="1920" data-height="1080"></main>'


@pytest.fixture
def project(tmp_path) -> Project:
    (tmp_path / "demo").mkdir()
    (tmp_path / "demo" / "index.html").write_text(COMPOSITION)
    return Project(tmp_path / "demo")


@pytest.fixture
def spy(monkeypatch):
    """Record CLI calls; optionally create the file the CLI was asked for."""
    calls: list[dict] = []

    def _fake(argv, **kwargs):
        calls.append({"argv": argv, **kwargs})
        if "--output" in argv:
            target = Path(argv[argv.index("--output") + 1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"\x00")
        return subprocess.CompletedProcess(argv, 0, stdout=_fake.stdout, stderr="")

    _fake.stdout = ""
    monkeypatch.setattr("hyperframes._cli.subprocess.run", _fake)
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    return calls


def flag(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


# -- render ----------------------------------------------------------------


def test_render_defaults_to_renders_dir(project, spy):
    result = project.render()
    assert result == project.path / "renders" / "demo.mp4"
    argv = spy[0]["argv"]
    assert argv[1:3] == ["render", str(project.path)]
    assert flag(argv, "--output") == str(result)
    assert flag(argv, "--format") == "mp4"
    assert "--quiet" in argv


def test_relative_output_resolves_against_project_not_cwd(project, spy):
    # The CLI resolves --output against process.cwd(); the SDK pins it to the
    # project directory so the returned path is what the caller expects.
    result = project.render("out/final.mp4")
    assert result == project.path / "out" / "final.mp4"
    assert flag(spy[0]["argv"], "--output") == str(result)
    assert spy[0]["cwd"] == str(project.path)


def test_absolute_output_is_respected(project, spy, tmp_path):
    target = tmp_path / "elsewhere" / "clip.mp4"
    assert project.render(target) == target


def test_format_picks_the_extension(project, spy):
    assert project.render(format="webm").name == "demo.webm"
    assert project.render(format="gif").name == "demo.gif"
    assert project.render(format="png-sequence").name == "demo"


def test_opts_become_flags(project, spy):
    project.render(
        fps=60,
        quality="high",
        resolution="portrait",
        variables={"title": "Hello"},
        composition="scenes/intro.html",
        page_side_compositing=False,
    )
    argv = spy[0]["argv"]
    assert flag(argv, "--fps") == "60"
    assert flag(argv, "--quality") == "high"
    assert flag(argv, "--resolution") == "portrait"
    assert flag(argv, "--variables") == '{"title":"Hello"}'
    assert flag(argv, "--composition") == "scenes/intro.html"
    assert "--no-page-side-compositing" in argv


def test_quiet_can_be_turned_off(project, spy):
    project.render(quiet=False)
    assert "--no-quiet" in spy[0]["argv"]


def test_render_without_composition_raises(tmp_path, spy):
    with pytest.raises(HyperframesError, match="No composition at"):
        Project(tmp_path / "empty").render()
    assert spy == []


def test_render_that_produces_nothing_raises(project, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr(
        "hyperframes._cli.subprocess.run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 0, "", ""),
    )
    with pytest.raises(HyperframesError, match="produced nothing"):
        project.render()


def test_render_failure_surfaces_stderr(project, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr(
        "hyperframes._cli.subprocess.run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 1, "", "Invalid quality"),
    )
    with pytest.raises(HyperframesError) as excinfo:
        project.render(quality="maximum")
    assert excinfo.value.stderr == "Invalid quality"


# -- init ------------------------------------------------------------------


def test_init_runs_from_parent_with_a_bare_name(spy, tmp_path):
    # `hyperframes init` resolves the project name against process.cwd().
    created = Project.init(tmp_path / "nested" / "promo")
    argv = spy[0]["argv"]
    assert argv[1:3] == ["init", "promo"]
    assert flag(argv, "--example") == "blank"
    assert "--non-interactive" in argv
    assert spy[0]["cwd"] == str(tmp_path / "nested")
    assert created.path == tmp_path / "nested" / "promo"


def test_init_passes_through_extra_flags(spy, tmp_path):
    Project.init(tmp_path / "vertical", example="warm-grain", resolution="portrait")
    argv = spy[0]["argv"]
    assert flag(argv, "--example") == "warm-grain"
    assert flag(argv, "--resolution") == "portrait"


# -- preview ---------------------------------------------------------------


def test_blocking_preview_streams_and_returns_none(project, spy):
    assert project.preview() is None
    argv = spy[0]["argv"]
    assert argv[1:3] == ["preview", str(project.path)]
    assert flag(argv, "--port") == "3002"
    assert "--no-open" in argv
    assert "--background" not in argv
    assert spy[0]["capture_output"] is False


def test_background_preview_returns_the_reported_url(project, spy, monkeypatch):
    # The CLI may bind a different port than requested when 3002 is busy.
    monkeypatch.setattr(
        "hyperframes._cli.subprocess.run",
        lambda argv, **kw: spy.append({"argv": argv, **kw})
        or subprocess.CompletedProcess(argv, 0, "Studio  http://localhost:3007\n", ""),
    )
    assert project.preview(port=3002, background=True) == "http://localhost:3007"
    assert "--background" in spy[0]["argv"]


def test_background_preview_falls_back_to_requested_port(project, spy):
    assert project.preview(port=4000, background=True) == "http://localhost:4000"


def test_stop_preview(project, spy):
    project.stop_preview(port=4000)
    assert spy[0]["argv"][1:] == ["preview", str(project.path), "--port", "4000", "--stop"]


# -- escape hatch ----------------------------------------------------------


def test_run_passes_arbitrary_subcommands(project, spy):
    project.run("lint", "--json")
    assert spy[0]["argv"][1:] == ["lint", "--json"]
    assert spy[0]["cwd"] == str(project.path)


def test_run_can_tolerate_failure(project, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv("HYPERFRAMES_CLI", raising=False)
    monkeypatch.setattr(
        "hyperframes._cli.subprocess.run",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 1, "", "2 errors"),
    )
    assert project.run("lint", check=False).returncode == 1
