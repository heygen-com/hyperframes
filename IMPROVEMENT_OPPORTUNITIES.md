# Improvement Opportunities (Repo Scan)

This is a quick, code-level opportunity scan based on static inspection. It is intentionally practical: each item includes why it matters and where to start.

## 1) Implement transitive registry dependency resolution (CLI)

**Opportunity**
The registry resolver explicitly documents that transitive dependency resolution is not implemented yet.

**Why this matters**
As soon as blocks/components start depending on other registry items, install/add flows can become incomplete or order-dependent.

**Suggested next step**
Implement a dependency graph walk (`registryDependencies`) with cycle detection and topological sort, and return a deterministic install list.

**Evidence**
- `packages/cli/src/registry/resolver.ts` contains an explicit TODO for transitive walk + topo ordering.

## 2) Reduce monolithic file size in high-churn areas

**Opportunity**
Several files are very large (roughly 800–1,600 LOC), especially around runtime, rendering, and Studio UI orchestration.

**Why this matters**
Large files increase review risk and regression probability, and they make ownership boundaries unclear.

**Suggested next step**
Define soft limits (for example, 400–600 LOC per module), then incrementally extract feature-focused modules (state selectors, side-effect services, view helpers, protocol adapters).

**Evidence (largest files found)**
- `packages/core/src/runtime/init.ts` (~1632 LOC)
- `packages/producer/src/services/renderOrchestrator.ts` (~1267 LOC)
- `packages/producer/src/services/htmlCompiler.ts` (~1150 LOC)
- `packages/studio/src/App.tsx` (~951 LOC)
- `packages/studio/src/components/editor/FileTree.tsx` (~944 LOC)

## 3) Pay down `any`/unsafe cast usage in production paths

**Opportunity**
There are multiple `as any` and `: any` usages in runtime paths (not only tests), especially around browser page evaluation and CDP hooks.

**Why this matters**
This weakens type contracts at boundary seams where failures are expensive (capture/render/snapshot pipelines).

**Suggested next step**
Create small boundary types (e.g., typed `window` facades and CDP payload interfaces), then enforce a gradual reduction target per package.

**Evidence (sample production locations)**
- `packages/cli/src/commands/snapshot.ts`
- `packages/cli/src/server/studioServer.ts`
- `packages/cli/src/capture/animationCataloger.ts`
- `packages/engine/src/utils/urlDownloader.ts`
- `packages/producer/src/services/renderOrchestrator.ts`

## 4) Add bounded concurrency + retry strategy for registry item loading

**Opportunity**
`loadAllItems` currently uses unbounded `Promise.allSettled` across all entries.

**Why this matters**
If registry size grows, this can create bursty outbound load and noisy partial failures under transient network pressure.

**Suggested next step**
Use bounded concurrency (e.g., 8–16 workers) and retry/backoff for retryable HTTP failures; keep warning behavior for hard failures.

**Evidence**
- `packages/cli/src/registry/resolver.ts` loads all manifests in parallel via `Promise.allSettled(entries.map(...))`.

## 5) Revisit very large generated font payload strategy

**Opportunity**
A generated source file embeds a ~964 KB base64 payload directly in TypeScript.

**Why this matters**
Large generated literals can slow diffs/indexing and inflate package/bundle processing.

**Suggested next step**
Consider moving large assets to external artifacts with checksums/versioning, or split by font family/weight for selective loading.

**Evidence**
- `packages/producer/src/services/fontData.generated.ts` is a large generated payload file (~964 KB).

## 6) Align lint suppression comments with current lint stack

**Opportunity**
Many files include `eslint-disable` comments while repo standards/tools center around `oxlint`/`oxfmt`.

**Why this matters**
Suppression comments that do not map to active linters create confusion and can hide true intent.

**Suggested next step**
Audit suppression comments and either:
1. Replace with active-linter suppressions where needed, or
2. Refactor code so suppressions are unnecessary.

**Evidence (sample locations)**
- `packages/studio/src/App.tsx`
- `packages/studio/src/components/nle/NLELayout.tsx`
- `packages/studio/src/player/hooks/useTimelinePlayer.ts`
- `packages/engine/src/utils/urlDownloader.ts`

---

## Suggested execution order

1. Registry dependency resolver (correctness blocker for scalable catalog installs).
2. Bounded concurrency/retries in registry loading (reliability).
3. Type boundary hardening (`any` reductions) in CLI/engine/producer pathways.
4. Monolithic file decomposition in Studio + producer + core runtime.
5. Generated font payload strategy update.
6. Lint-suppression cleanup.
