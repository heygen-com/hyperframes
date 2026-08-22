"""Python SDK for HyperFrames — write HTML, render video.

A thin, dependency-free wrapper around the `hyperframes` Node CLI. It does not
reimplement rendering; it discovers the CLI, builds argv, and turns failures
into exceptions that carry stderr.

    >>> from hyperframes import Project
    >>> project = Project.init("promo", example="blank")
    >>> project.render("promo.mp4")
    PosixPath('/abs/path/promo/promo.mp4')
"""

from ._cli import CLINotFoundError, HyperframesError, cli_version, resolve_cli
from .project import Project

__all__ = [
    "Project",
    "HyperframesError",
    "CLINotFoundError",
    "cli_version",
    "resolve_cli",
]

__version__ = "0.1.0"
