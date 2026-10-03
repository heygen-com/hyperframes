# Quiver Source procedure

Use this procedure only for an `asset_needs[]` item with
`provider: "quiver"`. The bundled official `quiverai` skill and its hosted MCP
tools own Quiver operations. This document supplies the motion-graphics
handoff and authorization boundary; it does not add a client, parser,
resolver, adapter, or dependency.

## Read and choose

Read the need's `operation` and inspect the supplied or existing material
before spending anything:

- `reuse` uses an acceptable supplied local SVG or an existing Quiver creation.
  Use the official read-only `list`, `get`, and `content` tools to inspect an
  existing creation and retrieve completed content. A local asset still needs
  truthful provenance and a matching preview.
- `generate` creates a new vector asset through the official Quiver skill/tool.
  Keep the prompt concrete and appearance-focused: subject, geometry, palette,
  background, and embedded text only when requested. Do not put motion
  instructions in a generation prompt.
- `vectorize` sends the supplied raster through the official vectorization
  operation. Preserve the raster as source provenance and inspect whether
  meaningful shapes are actually separable.
- `edit` is the user-requested genuine REST edit lane below. Do not use
  generation or vectorization as a silent edit fallback.
- `animate` would require a Quiver-native animated source and a proven
  HyperFrames compatibility contract. Current evidence is
  **INDETERMINATE / BLOCKED**. Record that unmet state and stop/replan before
  delivery claims; do not claim completion or silently substitute local SVG
  editing, prompt regeneration, or ordinary GSAP motion for a request for
  Quiver-native animation. If a future approved proof enables this lane, the
  animation prompt describes motion only; the accepted source owns appearance.

If Quiver is absent and no Quiver asset work is required, preserve the
existing HyperFrames path and do not create a synthetic Quiver need.

## Edit REST lane

Use this lane only when the user explicitly requests an edit and the operation
is authorized. The documented request is:

```text
POST /v1/svgs/edits
Authorization: Bearer $QUIVERAI_API_KEY
{
  "model": "<permitted edit-capable model>",
  "prompt": "<the narrow requested edit>",
  "stream": false,
  "max_review_steps": 0,
  "svg": "<inline SVG, at most 200,000 characters>"
}
```

Send exactly one of `svg` or `svg_source`; use `svg_source` when the official
edit contract supports a referenced source instead of inline content. Require
the API key, a permitted edit-capable model, and API Platform balance before
the call. A successful non-stream response carries edited content in
`data[].svg`. Keep prompts narrow and preserve unrelated artwork.

Never print or persist the bearer key. Redact request bodies and credentials in
errors, report only the safe operation/status detail, and do not retry
automatically. A REST response ID, if present, is a REST response/request ID;
never label it as an MCP `creation_id`. Only an official MCP creation response
can supply an MCP creation ID.

## Spend and status rules

- A user-requested paid operation needs explicit operation authority. Keep the
  requested count and remaining budget visible, and make no automatic retry.
- Agent-proposed paid work must be consolidated into one confirmation naming
  every proposed operation and count. Keep all of it pending until the user
  explicitly authorizes it; do not split consent into hidden calls.
- When a result is poor and the authorized iteration or spend budget is
  exhausted, retain the best completed result, record its limitation, and route
  a downstream adaptation. New provider spend requires new authorization.
- Record the actual state: `unavailable` (MCP/tool absent), `unauthorized`
  (missing key, user authority, or model permission), `insufficient_balance`,
  `failed` (explicit failed response), `incomplete` (generating/pending with
  no completed content), `blocked` (compatibility or policy gate), or
  `completed` (content and preview actually returned). Do not collapse one
  state into another.

## Request identity and reconciliation

Before a paid provider create, privately record the agent attempt number,
operation, model, exact prompt hash, request start time, and a bounded
read-only before-set of creation IDs/latest time. Prefer an exact returned
task or creation ID for every later read.

If the create call returns a synchronous error without an ID, record that
synchronous error separately from any persisted task or creation status. The
synchronous error alone is not an explicit provider `failed` state. Perform
only bounded read-only reconciliation. Use a persisted result only when
provider evidence correlates it to this request or a documented exclusive
submission boundary was established before the attempt; a singleton match on
model, operation, prompt, and time is insufficient when another client could
have submitted the same request.

Zero candidates, multiple or concurrent candidates, incomplete pagination, or
missing correlation remain request-level `unresolved`, `incomplete`, or
`ambiguous` as applicable, even when one metadata match is returned. Select no
content, make no asset or provenance claim, and make no paid retry in those
states. Record both synchronous and persistent states. Reserve `failed` for an
explicit persisted provider `failed` status correlated to this attempt.

## Freeze and handoff

For a completed accepted Quiver asset, freeze the actual SVG and a separate
matching PNG preview under the project `assets/` directory. When the provider
returns PNG content, decode and save those returned bytes. If it does not, a
local render of that exact frozen SVG is the only allowed preview fallback. Do
not use the SVG path as `preview`, alias the SVG as a PNG, or substitute a
composition snapshot for the asset preview. If the PNG cannot be retrieved or
rendered from the same SVG, Source is incomplete; stop without a false
completed handoff or a new provider create.

In `assets/index.md`, put `role`, `path`, and `provenance` first, followed by
`preview`, `purpose`, and observed limitations. The source and preview paths
must be distinct local files. Before Builder starts, the same controller must
re-read the SVG, PNG, and ledger and verify that both files are regular,
non-empty, readable, and recorded in that canonical field order. Missing,
empty, unreadable, aliased, or mismatched files keep Source incomplete. The
Builder receives only those verified frozen local paths. A failed, incomplete,
unauthorized, unavailable, insufficient-balance, or blocked operation produces
no fabricated SVG, preview, creation, or provenance claim.
