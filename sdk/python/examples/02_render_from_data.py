#!/usr/bin/env python3
"""Generate a composition from a Python data dict, then render it.

The point of HyperFrames is that a video is just HTML. So a chart video is a
template call away — build the markup from your data, write index.html, render.

    python examples/02_render_from_data.py

Needs Node >= 22 and the `hyperframes` CLI (npm i -g hyperframes).
"""

from __future__ import annotations

import html
import sys
import tempfile
from pathlib import Path

from hyperframes import HyperframesError, Project

REPORT = {
    "title": "Q3 Revenue",
    "duration": 4.0,
    "bars": [
        {"label": "North", "value": 82},
        {"label": "South", "value": 45},
        {"label": "EMEA", "value": 96},
        {"label": "APAC", "value": 61},
    ],
}

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0b0b0f; }}
      #root {{ font-family: Inter, system-ui, sans-serif; color: #f5f5f7; }}
      #title {{ position: absolute; top: 120px; left: 160px; font-size: 84px; font-weight: 700; }}
      #chart {{ position: absolute; left: 160px; right: 160px; bottom: 160px;
                display: flex; gap: 48px; align-items: flex-end; height: 560px; }}
      .bar {{ flex: 1; display: flex; flex-direction: column; justify-content: flex-end;
              align-items: center; gap: 20px; }}
      .fill {{ width: 100%; background: linear-gradient(#7c5cff, #4bd4ff); border-radius: 12px 12px 0 0;
               transform-origin: bottom; animation: grow 0.9s cubic-bezier(.2,.7,.3,1) both; }}
      .label {{ font-size: 34px; opacity: .7 }}
      .value {{ font-size: 40px; font-weight: 600 }}
      @keyframes grow {{ from {{ transform: scaleY(0) }} to {{ transform: scaleY(1) }} }}
    </style>
  </head>
  <body>
    <!-- data-no-timeline: motion is pure CSS, so there is no window.__timelines
         entry to register. Without it the producer polls 45s before giving up. -->
    <div id="root" data-composition-id="main" data-start="0" data-duration="{duration}"
         data-width="1920" data-height="1080" data-no-timeline>
      <h1 id="title" class="clip" data-start="0" data-duration="{duration}" data-track-index="0">{title}</h1>
      <div id="chart" class="clip" data-start="0" data-duration="{duration}" data-track-index="1">
{bars}
      </div>
    </div>
  </body>
</html>
"""

BAR = """        <div class="bar">
          <div class="value">{value}</div>
          <div class="fill" style="height: {height:.1f}%; animation-delay: {delay:.2f}s"></div>
          <div class="label">{label}</div>
        </div>"""


def build_page(report: dict) -> str:
    """Render the data dict into a HyperFrames composition.

    Animation is pure CSS keyframes — a supported frame adapter, and it keeps
    the render deterministic and offline (no CDN script tag).
    """
    peak = max(bar["value"] for bar in report["bars"]) or 1
    bars = "\n".join(
        BAR.format(
            value=bar["value"],
            label=html.escape(bar["label"]),
            height=100 * bar["value"] / peak,
            delay=0.12 * index,
        )
        for index, bar in enumerate(report["bars"])
    )
    return PAGE.format(
        title=html.escape(report["title"]),
        duration=report["duration"],
        bars=bars,
    )


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix="hyperframes-"))
    project = Project.init(workdir / "revenue", example="blank")
    project.index.write_text(build_page(REPORT), encoding="utf-8")
    print(f"Wrote {project.index}")

    project.run("lint")  # raises HyperframesError if the markup is malformed

    output = project.render("revenue.mp4", fps=30, quality="draft")
    print(f"Wrote {output} ({output.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except HyperframesError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
