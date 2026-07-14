# cloud — HeyGen-hosted rendering (zero-infra)

`hyperframes cloud render` renders a composition on HeyGen's managed cloud. The CLI zips the project, uploads it, runs the render on HeyGen's infrastructure (Chromium + FFmpeg), and downloads the finished video. Nothing to deploy, and no Chrome/FFmpeg/AWS to manage; you pay per credit.

```bash
npx hyperframes auth login            # one-time sign-in
npx hyperframes cloud render          # zip, upload, render, download
```

## When to use cloud vs lambda vs local

- **`hyperframes render`** (local): fastest iteration loop, use while authoring.
- **`hyperframes cloud render`**: zero-infra. HeyGen runs the render and you pay per credit. This is the default answer to "render in the cloud" when you don't want to manage Chrome/FFmpeg/AWS.
- **`hyperframes lambda render`**: bring-your-own-AWS distributed rendering with chunked parallelism. Only worth it when you've already invested in AWS (see `lambda.md`).

## Authentication

Cloud rendering needs a HeyGen credential, stored at `~/.heygen/credentials` (`0600`) and shared with the [`heygen` CLI](https://github.com/heygen-com/heygen-cli): sign in with one and the other picks up the session.

```bash
npx hyperframes auth login              # OAuth 2.0 + PKCE, opens the browser
npx hyperframes auth login --api-key    # CI/headless: hidden prompt, or pipe: echo "$HEYGEN_API_KEY" | ... --api-key
npx hyperframes auth status             # active credential source, identity, billing snapshot
npx hyperframes auth refresh            # force-refresh an OAuth token before a long job
npx hyperframes auth logout             # clear the stored credential
```

Credential resolution order (first match wins): `HEYGEN_API_KEY`, then `HYPERFRAMES_API_KEY`, then `~/.heygen/credentials`. Point at a different backend with `HEYGEN_API_URL` (default `https://api.heygen.com`).

## The render pipeline

`cloud render` runs end-to-end:

1. **Resolve the project**: a local directory (default `.`), or skip the upload with `--asset-id` / `--url`.
2. **Auto-detect aspect ratio** from the entry HTML's `data-width`/`data-height`.
3. **Zip** the project (same ignore set as `hyperframes publish`, so it excludes `.git`, `node_modules`, `dist`, and so on).
4. **Upload** the zip to `POST /v3/assets`, yielding an `asset_id`.
5. **Submit** the render to `POST /v3/hyperframes/renders`, yielding a `render_id`.
6. **Poll** `GET /v3/hyperframes/renders/{id}` until it completes or fails (skip with `--no-wait`).
7. **Download** the signed video URL to disk.

## Render options

| Flag                   | Default                     | Meaning                                                                                                                        |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--fps`                | `30`                        | Frames per second, 1–240.                                                                                                      |
| `--quality`            | `standard`                  | `draft`, `standard`, or `high`.                                                                                                |
| `--format`             | `mp4`                       | `mp4`, `webm`, or `mov` (webm/mov carry alpha).                                                                                |
| `--resolution`         | `1080p`                     | `1080p` or `4k` (4k billed at 1.5×).                                                                                           |
| `--aspect-ratio`       | auto                        | `16:9`, `9:16`, or `1:1`. Auto from a local project's `data-width`/`data-height`; defaults to `16:9` for `--asset-id`/`--url`. |
| `--composition` / `-c` | `index.html`                | Entry HTML file inside the zip.                                                                                                |
| `--output` / `-o`      | `renders/<render_id>.<ext>` | Local download destination.                                                                                                    |

```bash
npx hyperframes cloud render . \
  --composition compositions/intro.html \
  --output ./renders/intro.mp4

npx hyperframes cloud render --quality high --fps 60
```

`--resolution 4k` cannot combine with `--format webm`/`mov`: the 4k supersampling path has no alpha channel. Render 4k as mp4, or render alpha at native resolution.

## Templates and variables

Cloud rendering supports [variables](../SKILL.md#variables-parametrized--template-renders): declare `data-composition-variables` on the composition, then fill them at render time.

```bash
npx hyperframes cloud render --variables '{"title":"Q4 Recap","theme":"dark"}'
npx hyperframes cloud render --variables-file ./vars.json
npx hyperframes cloud render --variables '{"title":"Q4 Recap"}' --strict-variables
```

For a **local project** the CLI validates `--variables` against the declared schema _before_ uploading. For `--asset-id`/`--url` the schema lives server-side, so mismatches surface as a `hyperframes_project_invalid` API error.

**Upload once, re-render many** is the idiomatic template loop: render a local project to get its `asset_id`, then re-submit against that asset with new values (no re-zip, no re-upload).

```bash
npx hyperframes cloud render ./card-template                              # note the asset_id printed on upload
npx hyperframes cloud render --asset-id asst_abc123 --variables '{"name":"Ada"}'
npx hyperframes cloud render --asset-id asst_abc123 --variables '{"name":"Linus"}'
```

For high-volume personalized batches, the Lambda path adds a JSONL fan-out (see `lambda.md`). The full variables schema (types, declarative bindings, sub-composition overrides, precedence) lives in the `hyperframes-core` skill.

## Fire-and-forget and webhooks

By default the CLI blocks, polls, and downloads. Combine `--no-wait` (submit and exit with just the `render_id`) with `--callback-url` (HTTPS webhook on terminal status) for true fire-and-forget:

```bash
npx hyperframes cloud render --callback-url https://example.com/hf-hook --no-wait
#    Poll later with: hyperframes cloud get hfr_def456
```

| Flag              | Meaning                                             |
| ----------------- | --------------------------------------------------- |
| `--no-wait`       | Submit and exit immediately; print the `render_id`. |
| `--callback-url`  | HTTPS webhook fired when the render terminates.     |
| `--callback-id`   | Opaque tracking ID echoed in webhook payloads.      |
| `--poll-interval` | Poll cadence in seconds (default `10`).             |
| `--max-wait`      | Max poll duration in minutes (default `60`).        |

## Managing renders

```bash
npx hyperframes cloud list                 # recent renders (--limit, --token, --all)
npx hyperframes cloud get hfr_def456       # full detail + short-lived signed video_url
npx hyperframes cloud delete hfr_def456    # soft-delete (--no-confirm to skip the prompt)
```

`video_url` and `thumbnail_url` are short-lived presigned URLs, so re-fetch with `cloud get` rather than caching them.

## Safe retries

The CLI transparently retries a `401` by force-refreshing the OAuth token and replaying. That's harmless for reads, but the zip upload (`POST /v3/assets`) is **not** idempotent: a blind retry creates a duplicate asset and bills twice. Pass `--idempotency-key` so retries are safe:

```bash
npx hyperframes cloud render . --idempotency-key "$(uuidgen)"
```

The key is forwarded to both upload and submit (the server scopes idempotency per-endpoint, so reusing one value is safe). Use any opaque string in `[A-Za-z0-9_:.-]`, 1–255 chars.

Full flag reference: docs `/deploy/cloud` and `/packages/cli#hyperframes-cloud`.
