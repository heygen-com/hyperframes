#!/usr/bin/env python3
"""Render one of the repo's example compositions to MP4.

    python examples/01_render_example.py       # scaffolds `swiss-grid` from the registry
    python examples/01_render_example.py ../../registry/examples/swiss-grid   # render in place

Needs Node >= 22 and the `hyperframes` CLI (npm i -g hyperframes).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from hyperframes import HyperframesError, Project, cli_version


def main() -> int:
    print(f"hyperframes CLI {cli_version()}")

    if len(sys.argv) > 1:
        project = Project(sys.argv[1])
        if not project.exists():
            print(f"No index.html in {project.path}", file=sys.stderr)
            return 1
    else:
        # `swiss-grid` is a registry example, so this one call downloads it.
        workdir = Path(tempfile.mkdtemp(prefix="hyperframes-"))
        print(f"Scaffolding swiss-grid in {workdir} ...")
        project = Project.init(workdir / "swiss-grid", example="swiss-grid")

    print(f"Rendering {project.name} ...")
    output = project.render("out.mp4", quality="draft")
    print(f"Wrote {output} ({output.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except HyperframesError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
