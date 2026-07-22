"""One real end-to-end render. Skipped unless Node >= 22 and the CLI are present.

Run explicitly:  pytest -m integration
"""

from __future__ import annotations

import shutil
import subprocess

import pytest

from hyperframes import CLINotFoundError, Project, cli_version, resolve_cli
from hyperframes._cli import MIN_NODE_MAJOR

def _skip_reason() -> str | None:
    try:
        resolve_cli()
    except CLINotFoundError:
        return "hyperframes CLI not installed"

    node = shutil.which("node")
    if node is None:
        return "node not on PATH"
    raw = subprocess.run([node, "--version"], capture_output=True, text=True).stdout
    major = int(raw.lstrip("v").split(".")[0] or 0)
    if major < MIN_NODE_MAJOR:
        return f"node {raw.strip()} < required v{MIN_NODE_MAJOR}"
    return None


SKIP = _skip_reason()
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(SKIP is not None, reason=SKIP or ""),
]


def test_scaffold_and_render(tmp_path):
    assert cli_version()

    project = Project.init(tmp_path / "smoke", example="blank")
    assert project.exists()

    # The blank template is a video shell with placeholder sources; replace it
    # with a self-contained 1-second composition so the render needs no assets.
    project.index.write_text(
        """<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #101014; }
  #title { position: absolute; inset: 0; display: grid; place-items: center;
           font: 700 96px sans-serif; color: #fff; }
</style></head><body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="1"
       data-width="1920" data-height="1080" data-no-timeline>
    <h1 id="title" class="clip" data-start="0" data-duration="1" data-track-index="0">
      Hello from Python
    </h1>
  </div>
</body></html>
""",
        encoding="utf-8",
    )

    project.run("lint")
    output = project.render("smoke.mp4", fps=24, quality="draft")

    assert output == project.path / "smoke.mp4"
    assert output.stat().st_size > 0
