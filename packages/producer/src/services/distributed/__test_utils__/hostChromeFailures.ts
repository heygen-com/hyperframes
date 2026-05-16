/**
 * Shared soft-skip regex used by every `services/distributed/*.test.ts` that
 * drives `renderChunk()` through a real chrome-headless-shell. Matches the
 * failure signatures we've observed on dev/CI hosts whose GL stack can't
 * initialize:
 *
 *   - `chrome://gpu` / `BROWSER_GPU_NOT_SOFTWARE` / SwiftShader text:
 *     `assertSwiftShader` can't read the gpu info table.
 *   - `HeadlessExperimental.beginFrame` / `Target closed`:
 *     chrome-headless-shell's GL process exited because the build doesn't
 *     honor `--use-gl=swiftshader` on the host distro (`gl_factory.cc:111`
 *     errors out before BeginFrame can run).
 *
 * Production-shaped Docker images (`Dockerfile.test` / `Dockerfile.chunk-runner`)
 * carry a chrome-headless-shell build matched to the planDir's `ffmpegVersion`,
 * so the determinism contract is exercised there. Tests that fail to render
 * on the host soft-skip and rely on the Docker harness for ground truth.
 *
 * This module lives under `__test_utils__/` and is excluded from `tsc`'s
 * declaration output via `tsconfig.json` so it never ships in the published
 * package.
 */
export const HOST_CHROME_FAILURE_PATTERNS =
  /chrome:\/\/gpu|BROWSER_GPU_NOT_SOFTWARE|SwiftShader|HeadlessExperimental\.beginFrame|Target closed/i;
