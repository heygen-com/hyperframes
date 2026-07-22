"""Subprocess bridge to the `hyperframes` Node CLI.

Everything here is local process orchestration: discover the CLI, build an
argv, run it, turn a non-zero exit into an exception that carries stderr.
No rendering logic is reimplemented — the Node CLI owns all of that.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

__all__ = [
    "HyperframesError",
    "CLINotFoundError",
    "resolve_cli",
    "run",
    "cli_version",
    "build_flags",
]

# packages/cli/src/runtimeVersion.ts — the shim rejects older Node before any
# CLI code loads, so the failure surfaces as exit 1 with this on stderr.
MIN_NODE_MAJOR = 22

#: Env applied to every CLI invocation. The SDK promises no network and no
#: telemetry; these are the CLI's own opt-out switches.
#: - HYPERFRAMES_NO_TELEMETRY / DO_NOT_TRACK: packages/cli/src/telemetry/client.ts
#: - HYPERFRAMES_SKIP_SKILLS: stops `init` phoning GitHub for a skills check
#: - NO_COLOR: keeps ANSI escapes out of captured stderr
DEFAULT_ENV: dict[str, str] = {
    "HYPERFRAMES_NO_TELEMETRY": "1",
    "DO_NOT_TRACK": "1",
    "HYPERFRAMES_SKIP_SKILLS": "1",
    "NO_COLOR": "1",
}


class HyperframesError(RuntimeError):
    """A `hyperframes` CLI invocation failed.

    Carries the full context of the failed process so callers can log or
    re-raise without re-running anything.
    """

    def __init__(
        self,
        message: str,
        *,
        command: Sequence[str] = (),
        returncode: int | None = None,
        stdout: str = "",
        stderr: str = "",
    ) -> None:
        super().__init__(message)
        self.command: list[str] = list(command)
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class CLINotFoundError(HyperframesError):
    """The `hyperframes` executable (or Node itself) could not be located."""


def _as_argv(cli: str | Path | Sequence[str]) -> list[str]:
    if isinstance(cli, Path):
        return [str(cli)]
    if isinstance(cli, str):
        # Allows HYPERFRAMES_CLI="npx --yes hyperframes@latest".
        return shlex.split(cli)
    return [str(part) for part in cli]


def _node_hint() -> str:
    node = shutil.which("node")
    if node is None:
        return (
            f"Node.js was not found on PATH either. HyperFrames needs Node.js "
            f">= {MIN_NODE_MAJOR}."
        )
    return f"Node.js was found at {node}; only the hyperframes CLI is missing."


def _walk_up_node_modules(start: Path) -> Path | None:
    name = "hyperframes.cmd" if os.name == "nt" else "hyperframes"
    for directory in (start, *start.parents):
        candidate = directory / "node_modules" / ".bin" / name
        if candidate.exists():
            return candidate
    return None


def resolve_cli(
    cli: str | Path | Sequence[str] | None = None,
    *,
    search_from: str | Path | None = None,
) -> list[str]:
    """Return the argv prefix used to invoke the CLI.

    Resolution order:

    1. an explicit ``cli`` argument (string, path, or argv sequence),
    2. the ``HYPERFRAMES_CLI`` environment variable,
    3. ``hyperframes`` on ``PATH``,
    4. ``node_modules/.bin/hyperframes``, walking up from ``search_from``.

    Raises:
        CLINotFoundError: if none of the above resolve.
    """
    if cli is not None:
        return _as_argv(cli)

    env_cli = os.environ.get("HYPERFRAMES_CLI")
    if env_cli:
        return _as_argv(env_cli)

    found = shutil.which("hyperframes")
    if found:
        return [found]

    local = _walk_up_node_modules(Path(search_from or Path.cwd()).resolve())
    if local is not None:
        return [str(local)]

    raise CLINotFoundError(
        "Could not find the `hyperframes` CLI.\n"
        f"{_node_hint()}\n"
        "Fix it with any one of:\n"
        "  npm install -g hyperframes\n"
        "  npm install hyperframes           (then run from that project)\n"
        "  export HYPERFRAMES_CLI='npx --yes hyperframes'\n"
        "  Project(path, cli='/path/to/hyperframes')"
    )


def _flag_name(key: str) -> str:
    return key.replace("_", "-").strip("-")


def build_flags(opts: Mapping[str, Any]) -> list[str]:
    """Map python kwargs onto CLI flags.

    ``None`` values are dropped, ``True``/``False`` become ``--flag`` /
    ``--no-flag`` (citty's negation convention), dicts and lists are JSON
    encoded, and everything else is stringified. Underscores become dashes,
    so ``page_side_compositing=False`` yields ``--no-page-side-compositing``.
    """
    argv: list[str] = []
    for key, value in opts.items():
        if value is None:
            continue
        name = _flag_name(key)
        if value is True:
            argv.append(f"--{name}")
        elif value is False:
            argv.append(f"--no-{name}")
        elif isinstance(value, (dict, list)):
            argv += [f"--{name}", json.dumps(value, separators=(",", ":"))]
        elif isinstance(value, Path):
            argv += [f"--{name}", str(value)]
        else:
            argv += [f"--{name}", str(value)]
    return argv


def run(
    args: Iterable[str],
    *,
    cli: str | Path | Sequence[str] | None = None,
    cwd: str | Path | None = None,
    env: Mapping[str, str] | None = None,
    timeout: float | None = None,
    capture: bool = True,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Invoke the CLI once.

    Args:
        args: CLI arguments after the executable, e.g. ``["render", "-o", "a.mp4"]``.
        cli: Override the executable (see :func:`resolve_cli`).
        cwd: Working directory. Matters: the CLI resolves ``--output`` and its
            default ``renders/`` directory against the *process* cwd, not the
            project directory.
        env: Extra environment variables, layered over :data:`DEFAULT_ENV`.
        timeout: Seconds before the process is killed.
        capture: Capture stdout/stderr. Pass ``False`` to stream to the
            terminal (used by the blocking preview server).
        check: Raise :class:`HyperframesError` on a non-zero exit.

    Raises:
        HyperframesError: on non-zero exit, timeout, or a CLI that cannot run.
        CLINotFoundError: if the executable cannot be resolved or spawned.
    """
    argv = [*resolve_cli(cli, search_from=cwd), *args]
    process_env = {**os.environ, **DEFAULT_ENV, **(env or {})}

    try:
        completed = subprocess.run(  # noqa: S603 - argv is built, never shell
            argv,
            cwd=str(cwd) if cwd is not None else None,
            env=process_env,
            capture_output=capture,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise CLINotFoundError(
            f"Could not execute {argv[0]!r}. {_node_hint()}", command=argv
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HyperframesError(
            f"`{' '.join(argv)}` timed out after {timeout}s.",
            command=argv,
            stdout=_text(exc.stdout),
            stderr=_text(exc.stderr),
        ) from exc

    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise HyperframesError(
            f"`{' '.join(argv)}` failed with exit code {completed.returncode}."
            + (f"\n{detail}" if detail else ""),
            command=argv,
            returncode=completed.returncode,
            stdout=completed.stdout or "",
            stderr=completed.stderr or "",
        )
    return completed


def _text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else value.decode("utf-8", "replace")


def cli_version(cli: str | Path | Sequence[str] | None = None) -> str:
    """Return the CLI version. Cheap — `--version` short-circuits before any
    heavy import in the CLI, so this doubles as a health probe."""
    return run(["--version"], cli=cli).stdout.strip()
