#!/usr/bin/env bash

set -u

max_attempts=3
retry_delay_seconds="${HF_BUN_INSTALL_RETRY_DELAY_SECONDS:-5}"

for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  if bun install --frozen-lockfile "$@"; then
    exit 0
  else
    install_status=$?
  fi

  if ((attempt == max_attempts)); then
    echo "::error::Bun dependency install failed after ${max_attempts} attempts."
    exit "$install_status"
  fi

  next_attempt=$((attempt + 1))
  echo "::warning::Bun dependency install failed; retrying dependency install (attempt ${next_attempt}/${max_attempts})."
  sleep "$((retry_delay_seconds * attempt))"
done
