#!/usr/bin/env bun
// fallow keeps one base-snapshot worktree per checkout and base commit in the temp dir
// (`fallow-audit-base-cache-<xxh3 of the checkout path>-<base sha[:16]>`); 2.75 never removes
// the one for an old base. Run after `fallow audit`: keeps only the current base's.
import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "fallow-audit-base-cache-";

/** The entries in `names` that are this checkout's caches for a base other than `keepSha`. */
export function staleAuditCaches(names, repoHash, keepSha) {
  const own = `${PREFIX}${repoHash}-`;
  const keep = `${own}${keepSha.slice(0, 16)}`;
  return names.filter((name) => name.startsWith(own) && !name.includes(".") && name !== keep);
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

if (import.meta.main) {
  const base = process.argv[2] ?? "origin/main";
  const root = realpathSync(git(process.cwd(), ["rev-parse", "--show-toplevel"]).stdout.trim());
  const keepSha = git(root, ["rev-parse", base]).stdout.trim();
  if (!keepSha) {
    console.error(`prune-fallow-audit-caches: cannot resolve ${base}; nothing removed`);
    process.exit(0);
  }
  const repoHash = Bun.hash.xxHash3(root).toString(16).padStart(16, "0");
  const dir = tmpdir();
  const stale = staleAuditCaches(readdirSync(dir), repoHash, keepSha);
  for (const name of stale) {
    // A registered cache must leave git's worktree list too, or `git worktree add` refuses the path later.
    git(root, ["worktree", "remove", "--force", join(dir, name)]);
    rmSync(join(dir, name), { recursive: true, force: true });
  }
}
