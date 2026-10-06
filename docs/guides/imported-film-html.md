---
title: "Imported film HTML"
description: "Connect preserved film-runner HTML to HyperFrames capture."
---

The runtime supports the `appifact-film:` message protocol used by current Claude Motion HTML exports. Keep the original `film-runner` HTML and scene modules intact. The MCP importer packages them with a HyperFrames wrapper; HyperFrames controls time and captures the resulting pixels using its existing renderer.

Create and mount an iframe with `sandbox="allow-scripts"`, explicit picture dimensions, and no player controls. Then connect it before assigning any runner HTML yourself:

```javascript
const bridge = window.__hyperframes.createFilmBridge({
  iframe: document.getElementById("film-stage"),
  runnerHtml: preservedRunnerHtml,
  load: { script, modules, assets, look, faces },
});
const unregister = window.__hyperframes.registerFrameSource({
  element: document.getElementById("film-clip"),
  ready: bridge.ready,
  render: bridge.render,
  dispose: bridge.dispose,
});
```

`preservedRunnerHtml` is the decoded JSON value of the original `film-runner` script, not the outer HTML player. `load` carries the original entry script, modules, look, fonts and asset records. Supply the existing protocol's asset buffers/URLs; the bridge structured-clones them without transferring ownership, allowing separate runner instances to reuse them. Asset packaging and HTML extraction belong to the importer.

The bridge installs its listener before setting `srcdoc`. It accepts messages only from that iframe's window with opaque origin `"null"`. It sends `load` after `hello`, waits for `ready`, and sends explicit `frame` requests with increasing sequence IDs. Capture waits for the matching frame acknowledgement; stale replies do not release it. The wrapper never calls the original player's autoplay path.

Startup has a 20-second deadline and a frame has a 15-second deadline. Startup, runner and timeout failures reject capture. An individual `frame-error` can recover on the next seek. Unregistering rejects outstanding bridge work and removes its listener. Use a separate bridge and runner iframe for each independently timed or overlapping scene.

Use screenshot capture for iframe pixels. This bridge does not read the sandbox DOM, expose internal scene nodes as Studio layers, or provide audio mixing and video extraction. Font/asset readiness depends on the preserved runner's `ready` and `frame` guarantees and must be checked for each supported export version.

The compatibility target is the current protocol, not every arbitrary animated web page. Visual comparison against the partner preview remains an integration acceptance step after MCP packaging.
