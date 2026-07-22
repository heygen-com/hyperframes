"""The `Project` handle — a composition directory you can render or preview."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence

from ._cli import HyperframesError, build_flags, run

__all__ = ["Project"]

# packages/cli/src/commands/render/plan.ts — FORMAT_EXT
_FORMAT_EXT: dict[str, str] = {
    "mp4": ".mp4",
    "webm": ".webm",
    "mov": ".mov",
    "gif": ".gif",
    "png-sequence": "",
}

_URL_RE = re.compile(r"https?://(?:localhost|127\.0\.0\.1):\d+")


class Project:
    """A HyperFrames composition directory.

    A project is just a folder containing ``index.html``. Construct one around
    an existing folder, or scaffold a new one with :meth:`init`.

        >>> project = Project("my-video")
        >>> project.render("out.mp4")
        PosixPath('/abs/path/my-video/out.mp4')
    """

    def __init__(
        self,
        path: str | Path,
        *,
        cli: str | Path | Sequence[str] | None = None,
        env: Mapping[str, str] | None = None,
    ) -> None:
        self.path = Path(path).expanduser().resolve()
        self._cli = cli
        self._env = dict(env or {})

    # -- construction -------------------------------------------------------

    @classmethod
    def init(
        cls,
        path: str | Path,
        *,
        example: str | None = "blank",
        cli: str | Path | Sequence[str] | None = None,
        env: Mapping[str, str] | None = None,
        timeout: float | None = None,
        **opts: Any,
    ) -> "Project":
        """Scaffold a new project with ``hyperframes init`` and return it.

        Args:
            path: Directory to create. Must not exist, or must be empty.
            example: Registry example to scaffold from. ``"blank"`` is bundled
                with the CLI; anything else is downloaded from the registry.
                Pass ``None`` only alongside ``video=`` or ``audio=``.
            timeout: Seconds to allow. Registry downloads and whisper
                transcription can be slow; default is no limit.
            **opts: Extra flags, e.g. ``resolution="portrait"``,
                ``tailwind=True``, ``video="clip.mp4"``.

        Non-interactive mode is forced, because the CLI only prompts when
        stdout is a TTY and it demands one of ``--example`` / ``--video`` /
        ``--audio`` when it is not.
        """
        target = Path(path).expanduser().resolve()
        opts.setdefault("non_interactive", True)
        argv = [
            "init",
            target.name,
            *build_flags({"example": example, **opts}),
        ]
        # `init` resolves the project name against the process cwd, so run
        # from the parent and pass a bare name.
        target.parent.mkdir(parents=True, exist_ok=True)
        run(argv, cli=cli, cwd=target.parent, env=env, timeout=timeout)
        return cls(target, cli=cli, env=env)

    # -- properties ---------------------------------------------------------

    @property
    def name(self) -> str:
        """Project name — the directory's basename, as the CLI derives it."""
        return self.path.name

    @property
    def index(self) -> Path:
        """Path to the root composition."""
        return self.path / "index.html"

    def exists(self) -> bool:
        """True if the directory holds a root composition."""
        return self.index.is_file()

    def __repr__(self) -> str:
        return f"Project({str(self.path)!r})"

    # -- actions ------------------------------------------------------------

    def render(
        self,
        output: str | Path | None = None,
        *,
        format: str = "mp4",
        timeout: float | None = None,
        **opts: Any,
    ) -> Path:
        """Render the composition and return the path to the artifact.

        Args:
            output: Where to write. Relative paths resolve against the project
                directory. Defaults to ``renders/<name>.<ext>`` — note this
                differs from the CLI, which appends a timestamp; the SDK pins
                the name so it has a path to hand back.
            format: ``mp4`` (default), ``webm``, ``mov``, ``gif``, or
                ``png-sequence``. ``png-sequence`` writes a directory.
            timeout: Seconds to allow. Renders are slow — default is no limit.
            **opts: Any other ``hyperframes render`` flag, in snake_case.
                ``composition="scenes/intro.html"``, ``fps=60``,
                ``quality="high"``, ``resolution="portrait"``,
                ``variables={"title": "Hi"}``, ``workers=4``,
                ``page_side_compositing=False`` → ``--no-page-side-compositing``.

        Raises:
            HyperframesError: if the CLI fails, or exits 0 without producing
                the artifact.
        """
        if not self.exists():
            raise HyperframesError(
                f"No composition at {self.index}. "
                "Scaffold one with Project.init(...) or point at a project directory."
            )

        ext = _FORMAT_EXT.get(format, "")
        target = (
            self.path / "renders" / f"{self.name}{ext}"
            if output is None
            else Path(output).expanduser()
        )
        if not target.is_absolute():
            target = self.path / target
        target.parent.mkdir(parents=True, exist_ok=True)

        opts.setdefault("quiet", True)
        argv = [
            "render",
            str(self.path),
            *build_flags({"output": target, "format": format, **opts}),
        ]
        # cwd is the project dir regardless: `--output` is already absolute,
        # but any relative path the CLI derives itself lands inside the project.
        self._run(argv, timeout=timeout)

        if not target.exists():
            raise HyperframesError(
                f"Render reported success but produced nothing at {target}.",
                command=argv,
            )
        return target

    def preview(
        self,
        *,
        port: int = 3002,
        open_browser: bool = False,
        background: bool = False,
        timeout: float | None = None,
        **opts: Any,
    ) -> str | None:
        """Start the studio preview server.

        Args:
            port: Preferred port. The CLI picks another if it is taken, which
                is why the background URL is read back from its output.
            open_browser: Let the CLI open a browser window.
            background: Return immediately with the server URL instead of
                blocking. Stop it later with :meth:`stop_preview`.
            timeout: Only meaningful with ``background=True``.

        Returns:
            The server URL when ``background=True``; ``None`` when blocking
            (the call returns once the server is interrupted or exits).
        """
        argv = [
            "preview",
            str(self.path),
            *build_flags({"port": port, "open": open_browser, **opts}),
        ]
        if not background:
            self._run(argv, capture=False, timeout=timeout)
            return None

        completed = self._run([*argv, "--background"], timeout=timeout)
        match = _URL_RE.search(completed.stdout or "")
        return match.group(0) if match else f"http://localhost:{port}"

    def stop_preview(self, *, port: int = 3002) -> None:
        """Stop the background preview server for this project."""
        self._run(["preview", str(self.path), "--port", str(port), "--stop"])

    def run(
        self, *args: str, timeout: float | None = None, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        """Escape hatch: run any CLI subcommand against this project.

            >>> project.run("lint")
            >>> project.run("check")
            >>> project.run("compositions", "--json")
        """
        return self._run(list(args), timeout=timeout, check=check)

    # -- internals ----------------------------------------------------------

    def _run(
        self,
        argv: list[str],
        *,
        timeout: float | None = None,
        capture: bool = True,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return run(
            argv,
            cli=self._cli,
            cwd=self.path if self.path.is_dir() else None,
            env=self._env,
            timeout=timeout,
            capture=capture,
            check=check,
        )
