import { fileURLToPath } from "node:url";

const child = Bun.spawn(
  [
    "bunx",
    "vitest",
    "run",
    "src/routes/files.test.ts",
    "src/routes/gsapMutationCapabilities.test.ts",
  ],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, HYPERFRAMES_GSAP_WRITER: "acorn" },
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.exitCode = await child.exited;
