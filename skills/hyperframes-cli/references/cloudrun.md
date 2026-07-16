# Cloud Run rendering on Google Cloud

Use `hyperframes cloudrun` only when the user explicitly wants self-managed Google Cloud infrastructure. It deploys Cloud Run, Workflows, and Cloud Storage. For a managed default use `hyperframes cloud`; for AWS use `hyperframes lambda`.

## Prerequisites

- `gcloud` is authenticated and the target project has billing enabled.
- Terraform 1.5 or newer is on `PATH`.
- Docker or permission to use Cloud Build is available.

## Lifecycle

```bash
npx hyperframes cloudrun deploy --project <gcp-project> --region us-central1
npx hyperframes cloudrun sites create ./project
npx hyperframes cloudrun render ./project --width 1920 --height 1080 --wait
npx hyperframes cloudrun progress <execution-name>
npx hyperframes cloudrun destroy --project <gcp-project>
```

`deploy` enables the required Google APIs, builds or accepts a container image, applies the bundled Terraform module, and stores the resulting coordinates in `~/.hyperframes/cloudrun-state.json`. Use deploy flags such as `--image`, `--repo`, `--cpu`, `--memory`, `--max-instances`, and `--timeout` only when the infrastructure needs those overrides.

`sites create` uploads a content-addressed project archive for reuse by `render-batch`; pass its `--site-id` to that command to skip the batch upload. Single `cloudrun render` currently resolves the project from its directory and does not consume `--site-id`. Both render commands require `--width` and `--height`; supported output formats are `mp4`, `mov`, `png-sequence`, and `webm`. Use `--output-resolution 4k` to supersample an authored composition without changing its layout dimensions.

Common render flags are `--fps 24|30|60`, `--quality draft|standard|high`, `--codec h264|h265` for MP4, `--chunk-size`, `--max-parallel-chunks`, `--target-chunk-frames`, `--render-id`, `--output-key`, `--wait`, and `--wait-interval-ms`. Use `--json` for machine-readable output.

For a variable-driven single render:

```bash
npx hyperframes cloudrun render ./template \
  --width 1920 --height 1080 \
  --variables-file ./alice.json \
  --strict-variables \
  --wait
```

Use exactly one of `--variables` and `--variables-file`. Read [`variables-and-media.md`](../../hyperframes-core/references/variables-and-media.md#variables) for the composition-side contract.

## JSONL batches

```bash
npx hyperframes cloudrun render-batch ./template \
  --batch ./users.jsonl \
  --width 1920 --height 1080 \
  --max-concurrent 10 \
  --site-id <site-id> \
  --json
```

Each nonblank line must contain an `outputKey`; `variables` is optional:

```json
{ "outputKey": "renders/alice.mp4", "variables": { "name": "Alice" } }
```

- `--max-concurrent` defaults to `50` and limits in-flight executions. `--max-parallel-chunks` separately limits chunks inside one render.
- `--dry-run` parses the file and prints `would-start` rows without starting executions.
- The template uploads once unless `--site-id` is supplied.
- Per-entry start errors remain visible and make the command exit nonzero.
- Do not rely on `--strict-variables` for `cloudrun render-batch`: the current command accepts the flag but does not validate batch rows. Validate the JSONL variable objects against the composition schema before dispatch. The strict gate does work for single `cloudrun render`.

`render` without `--wait` returns an execution name. Use `cloudrun progress <execution-name>` until it succeeds, then verify the reported GCS output. `destroy` removes the Terraform-managed stack and its scratch bucket; preserve any deliverables that must outlive the stack.
