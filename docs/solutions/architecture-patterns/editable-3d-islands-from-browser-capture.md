---
module: "browser-capture"
date: 2026-08-31
problem_type: architecture_pattern
component: "extension-to-studio import"
severity: high
symptoms:
  - "WebGL canvases could only cross the clipboard as frozen pixels."
  - "Running a viewer inline inside a subcomposition failed after Studio scoped the library's Document access."
  - "Models with Meshopt, KTX2, or Draco compression attempted decoder network requests."
root_cause: boundary_mismatch
resolution_type: code_fix
tags:
  - browser-capture
  - glb
  - model-viewer
  - offline
  - trust-boundary
---

# Editable 3D islands from browser capture

## Context

A browser extension can observe a WebGL canvas, but pixels do not preserve the scene's camera,
transform, materials, environment, or animation controls. Copying page JavaScript would preserve
more behavior, but it would also cross the trust boundary with an unbounded executable payload.

The desired representation is an editable HTML capture with a typed 3D island. The source page
contributes only a self-contained GLB. Studio contributes the viewer and decoders.

## Root cause

Two different boundaries were initially collapsed:

1. The clipboard boundary decides whether untrusted model bytes are safe to persist.
2. The composition boundary decides where a trusted viewer library can execute.

The first implementation embedded the viewer as an inline child-composition script. Studio scopes
inline scripts by replacing their global `document` with a composition-aware facade. That behavior
is correct for authored composition code, but a third-party custom-element runtime expects a real
`Document`. Lit failed while creating its tree walker before `model-viewer` could register.

## Solution

### 1. Move typed cargo, not page capability

The extension discovers exactly one bounded same-origin `.glb` resource for a selected canvas. It
does not preserve the source URL in the artifact and never copies page scripts.

The shared contract validates the GLB before import:

- GLB magic, version, declared length, and chunk bounds
- valid glTF 2.0 JSON
- no external buffer or image URI
- canonical base64, declared bytes, SHA-256, and aggregate quotas

An ambiguous, cross-origin, oversized, or malformed candidate stays on the existing visual-island
fallback path.

### 2. Persist one model island inside the editable child

Studio replaces the typed placeholder with a `model-viewer` element. The model remains a local data
URL, while editable attributes expose camera, transform, material, environment, and animation
controls.

The child is explicitly static with `data-no-timeline`. This prevents the runtime from waiting for a
timeline registry that a locked browser frame does not need.

### 3. Put the trusted runtime in a shared project asset

The import planner writes a pinned support file at:

```text
assets/hyperframes-web-capture-3d-v1.js
```

The child references that project-root path as an external script. Studio's existing composition
compiler executes external project scripts against the real document and deduplicates a shared path
when multiple captured children use it. No scope-escape attribute is added to authored HTML.

The runtime is loaded by Studio only when a model island is present, so ordinary captures do not pay
the viewer cost.

### 4. Route decoder requests to pinned local bytes

`model-viewer` and Three.js normally fetch decoder files on demand. The support asset intercepts only
fixed internal decoder URLs and serves bundled bytes for:

- Meshopt JavaScript
- Basis/KTX2 JavaScript and WebAssembly
- Draco JavaScript fallback, WebAssembly wrapper, and WebAssembly decoder

Every other request continues through the native `fetch` implementation. The imported child has no
remote model URL, and Studio preview and reload require zero external requests.

## Why this works

The representation separates data ownership from capability ownership:

```text
source page GLB bytes
        |
        v
strict typed envelope
        |
        v
project-local model resource + Studio-owned renderer
```

The source page cannot decide what code executes in Studio. Studio can evolve the viewer without
changing the clipboard's executable surface. Multiple compression families share one destination
runtime instead of embedding a renderer into every model payload.

## Verification

The final implementation was verified through the public boundaries:

- Core web-capture contract: 52 focused tests passed.
- Extension package: 20 tests passed, including model discovery, ambiguity, protocol, and DOM
  promotion.
- Studio import boundary: 7 focused tests passed.
- Core, extension, and Studio type checks passed.
- Core, extension, and Studio production builds passed.
- Workspace lint and formatting passed.
- `hyperframes check` passed lint, runtime, and layout on imported 3D projects.
- Real extension E2E passed on a Meshopt plus KTX2 model and on a Draco-compressed animated model.
- Each E2E used one native paste, persisted the child and shared runtime asset, changed camera orbit,
  reloaded with non-local requests blocked, and produced different before and after pixel hashes.

A deliberate mutation of the GLB magic-byte inspector made the accepting test fail, then the restored
implementation returned the suite to green.

## When to apply

Use this pattern when rich imported content needs destination-side editability but the source runtime
is untrusted or incompatible with the destination's execution model. The same split works for chart
specifications, document widgets, shader graphs, and other typed resources whose behavior can be
recreated by a pinned destination-owned runtime.

## Related

- `docs/contracts/browser-capture-v2.html`
- `docs/contracts/browser-capture-3d-v1.html`
- `packages/core/src/webCaptureResourceInspection.ts`
- `packages/extension/src/capture/model.ts`
- `packages/studio/src/utils/webCaptureImport.ts`
- `packages/studio/src/utils/webCapture3dRuntime.ts`
- `packages/extension/tests/e2e/run-editable-capture.mjs`
