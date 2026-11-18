import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { outsideAssetsAllowed } from "./receivedRender.js";

it("times the very-many-files case", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-timing-"));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".hyperframes"), { recursive: true });
  writeFileSync(join(dir, "index.html"), `<img src="../outside/pic.png">`);
  writeFileSync(join(dir, ".hyperframes", "received-files.json"), JSON.stringify({ files: [] }));
  const many = join(dir, "node_modules");
  mkdirSync(many);
  let t = performance.now();
  for (let i = 0; i <= 20_000; i++) writeFileSync(join(many, `f${i}`), "");
  const setup = performance.now() - t;
  t = performance.now();
  const allowed = outsideAssetsAllowed(dir, undefined, vi.fn());
  const decide = performance.now() - t;
  t = performance.now();
  rmSync(root, { recursive: true, force: true });
  const cleanup = performance.now() - t;
  console.log(
    `TIMING setup ${setup.toFixed(0)} ms, decide ${decide.toFixed(0)} ms, cleanup ${cleanup.toFixed(0)} ms, allowed ${allowed}`,
  );
}, 120_000);
