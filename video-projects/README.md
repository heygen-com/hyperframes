# Video Projects

Each directory under `video-projects/` is a concrete Hyperframes video project
managed by the shared `video-framework/` contracts.

Recommended shape:

```text
video-projects/<domain>/<project-id>/
  project.json          # source authority, scene map, render target
  README.md             # project-specific notes
  source/               # user media and captions; large media ignored
  plan/                 # generated reviewable plan JSON
  render/               # future Hyperframes HTML
  audit/                # lint, inspect, render evidence
  out/                  # generated videos; ignored
```

The framework contract comes first. A pilot project proves the loop only after
the reusable project shape is clear.
