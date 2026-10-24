# CLI conventions for agents and CI

- Prefer `--json` for agent and CI calls. Server-mode `render`, `preview`, and `play` do not provide ordinary JSON output; `preview --selection --json` and `preview --context --json` are query-mode exceptions.
- `doctor --json` always exits zero. Gate on its payload:

  ```bash
  npx hyperframes doctor --json | jq -e '.ok' >/dev/null
  ```

- Non-TTY mode is automatic and scaffolds the centered blank. Pass `--example` only to start from a named example. Use `--non-interactive` to force flag-only mode on a TTY.
- Use one `HYPERFRAMES_RUN_ID` for all commands in the same verification loop.
- When disk is tight, run `npx hyperframes clean` (`--dry-run` to list first); it removes what dead renders left and idle caches that rebuild themselves, never outputs, sources or anything a running render uses. Write disposable QC frames to a temp dir, then remove only that owned directory. Managed snapshot runs retain the newest 10 plus current/latest/rendered evidence; active captures and runs younger than 24 hours are protected. Copy intentional before/after evidence outside managed storage before it ages out. Never delete `.hyperframes` wholesale: it also holds project history.
- Use `--strict`, `--strict-all`, and `--strict-variables` when the corresponding warnings, variables, or CI conditions must gate the render.
- For `shader_unbounded_cosine_pow`, clamp the cosine to `[0, 1]` before `pow(1 - cosine, exponent)`; a lower-only `max` is insufficient. Then preview and export on the affected GPU to confirm. Lint only recognizes static shader expressions, and software rendering can miss hardware-specific invalid pixels.
- JSON paths redact the home directory as `$HOME`; do not try to reverse the redaction.
- When a hosted cloud project approaches or exceeds the 200 MB upload limit, use `cloud render --dry-run --json` and follow the `.hyperframesignore` investigation in `references/cloud.md`. Never ignore an asset merely because it is large.
- Never render merely because checks pass. Pause at the final preview and wait for approval.
