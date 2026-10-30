# Component source inspection (opt-in)

Recover original HTML/CSS/GSAP context for **known elements before an edit**. This is not a video check, screenshot, diff, or affected-component verifier. It combines the I002 runtime/compiler provenance approach with the I003 HF-owned service boundary. The agent adapter holds no DOM or animation state.

Published as `@hyperframes/inspector`. It does not modify the shared installation or register itself in a harness.

## Start

From this checkout, with Bun and an installed Chrome/headless-shell:

```sh
bun install --ignore-scripts
bun run --filter '@hyperframes/{parsers,lint,studio-server}' build
bun run build:hyperframes-runtime
# Optional when Chrome is not already under ~/.cache/hyperframes/chrome:
export HF_INSPECT_CHROME=/absolute/path/to/chrome
bun packages/inspector/src/server.ts /absolute/video/project
```

The service prints its loopback URL. Starting it does **not** start a browser. First inspection loads the project once.

The package ships the capability, not agent tools: a harness defines its own tool names, descriptions and schemas, and calls `POST /inspect` with the JSON below. The service is bound to one project at startup, so no per-call project path is needed. `GET /info` returns project identity and startup/query counters. Stop with SIGINT/SIGTERM; the service disposes its own pages/browser.

## Input

```json
{
  "targets": [
    { "selector": "#title" },
    { "selector": ".subtitle", "within": "#chapter-flow" },
    { "hfId": "hf-8e8x" },
    { "ref": "hfi:GENERATION:NUMBER" }
  ]
}
```

- `within` is optional. Exactly one match succeeds; multiple matches return candidates, never the first match silently. A bad target does not discard valid targets in the same batch.
- Refs identify actual elements, including children without IDs, and expire on source change, idle release, or disposal. HF IDs can repeat across component instances; those return ambiguity too.
- Descendants are included by default (up to 1,000, with an explicit truncation flag).
- Ordinary requests do not seek, take pictures, render frames or encode video.
- Optional `time` requests an exact HF seek and reports player time/duration. It is for deliberate runtime exploration, not required to inspect scheduled animation code.

## Output

The default JSON is capped at 12,000 UTF-8 bytes, including metadata. Each snippet's `id` names its file and its start and end lines (`file:start-end`); a snippet also carries its kinds, **unmodified full source lines**, and whether that exact block occurs only once in the file. When a query names more than one target, `targets` gives the input target indices it serves. No pretty-printing or ellipses are inserted into code. Adjacent/overlapping blocks merge across targets.

```json
{
  "generation": "...",
  "results": [{ "target": 0, "status": "found", "animations": 4 }],
  "snippets": [
    {
      "id": "scene.html:20-24",
      "kind": ["animation creation"],
      "targets": [0, 1],
      "code": "the exact original source lines, including whitespace",
      "uniqueInFile": true
    }
  ]
}
```

This illustration omits metadata. Actual files in the implementation report show the full output.

Shared helpers appear once with all **queried** targets using them. `coTargets` names up to three observed additional DOM targets of the same tween, prioritizing elements outside the query, and `coTargetsOmitted` counts the rest; it does not claim to enumerate all separate calls to a helper. Creation statements and authored caller statements are mapped; small named helper functions are returned whole. Variable assignments are not a stack/data-flow history. A missing source origin increments `unmappedAnimations`, rather than guessing an editable location.

HTML snippets are uniquely identified authored opening tags (their full source lines); dynamically generated markup may have no authored tag match. CSS is an authored-selector candidate scan, not proof of active cascade, media-query state, or inherited styles. In particular, a class reused in different scoped scene styles can have multiple candidate source rules.

### Larger results

Code blocks are atomic. `omitted`, `omittedCount`, and `nextOffset` describe missing blocks. Repeat the same targets with returned `generation` and `offset: nextOffset`, or request selected IDs:

```json
{ "targets": [], "generation": "RETURNED_GENERATION", "snippets": ["scene.html:20-24"] }
```

`maxBytes` can be raised explicitly (2,048–256,000). A block larger than the budget is not cut in half: request that ID with a larger budget or read its file/range. Pagination can therefore remain at the same offset until the budget increases. Old-generation continuations are rejected.

Full runtime evidence is only available by an explicit HTTP request with `debug: true`; it is deliberately not part of the default request or its output budget.

## Timeline

`POST /timeline` answers which animations are scheduled when, from the same browser, page and generation as `/inspect`. It never seeks, renders or edits files.

```json
{ "component": { "selector": "#title" }, "boundary": 7.9 }
```

`component` is optional and resolves like an `/inspect` target; omit it for every registered HF timeline. Give at most one of `at`, `range: [start, end]` or `boundary`, in global seconds; omit all three for the schedule overview. Results are short text grouped by component, with event times, targets, properties and source locations; `generation` and `offset` page through them. Coverage is registered DOM-target GSAP animations and explicit HF items only; anything outside that, or past the expansion limits, is reported as incomplete coverage rather than guessed.

## Element map

`POST /element-map` returns the composition's element map from the same page. It reads no query fields. A project with no `index.html` answers `404` `{ "error": "no-composition", "code": "no-composition" }`.

## Errors

Every refusal is JSON `{ "error", "code" }`. `code` is the stable token (`no-composition`, `stale_generation`, `source_changed_during_query`, `request_too_large`); a sentence with no token is `invalid_request`. A missing browser is `503` `browser_unavailable`, and an unexpected failure is `500` `internal_error`. Importing the module does not listen; `createInspectorServer(project)` builds one. An unknown route is `404` `{ "error": "not_found", "code": "not_found" }`. `GET /info` adds `version`, this package's version. The process listens on `127.0.0.1` and refuses a `Host` that is not loopback, so a rebinding request cannot read the project path. Install the server with the package: `hyperframes-inspector <project> [port]`, or `node dist/server.js`.

## Lifecycle and overhead

One lazy browser, one immutable bundled page per project service. Warm queries reuse both. Source HTML/JS/CSS/JSON are content-hashed; a change closes the old page and creates a new one, reusing the browser. The service serializes requests and checks the source fingerprint again after querying. No Studio hot-patching or old timeline objects survive a rebuild. Two idle minutes release both page and browser. Changes to only media bytes are not part of this source-context invalidation mechanism.

GSAP hooks are installed before authored page scripts. They live only in inspection pages, not the normal Studio, check, or rendering paths. Runtime records are capped at 20,000. No recorder is injected into normal HF output. Unexecuted callback-created animations, raw constructors, other animation systems, iframe contents and removed animations are outside coverage. An explicit time query can execute callbacks; it cannot prove all future paths are covered.

## Verification

```sh
bun run --filter @hyperframes/inspector test
bunx tsc -p packages/inspector/tsconfig.json --noEmit
bun packages/inspector/tests/browser.ts /absolute/path/to/gsap.min.js
bun packages/inspector/tests/lifecycle.ts /absolute/path/to/gsap.min.js
bun packages/inspector/tests/transport.ts /absolute/path/to/Rowan-film
bun packages/inspector/tests/film.ts /absolute/path/to/Rowan-film /tmp/film-inspection.json
```

Browser tests generate disposable fixtures. The film audit copies source/assets into a temporary project before editing; it never edits the supplied original. It checks fixed-frame parity, exact-source snippets, page replacement, browser reuse, and player time/duration. This is engineering verification, not an additional paid agent A/B or a demonstrated token/cost benefit.
