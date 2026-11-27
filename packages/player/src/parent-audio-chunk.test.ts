// @vitest-environment node
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ENGINE = "core/src/runtime/webAudioTransport.ts";

// fails without the fix: the player's main file carried the decoded-audio engine, so every embed paid for it.
it("keeps the decoded-audio engine out of the player's main file, in a chunk of its own", async () => {
  const { metafile } = await build({
    entryPoints: [fileURLToPath(new URL("./hyperframes-player.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    splitting: true,
    outdir: "out",
    write: false,
    metafile: true,
    logLevel: "silent",
    external: ["@hyperframes/core/runtime-script"],
  });
  const outputs = Object.values(metafile.outputs);
  const carries = (output: (typeof outputs)[number]) =>
    Object.keys(output.inputs).some((input) => input.endsWith(ENGINE));
  const entry = outputs.find((output) => output.entryPoint?.endsWith("hyperframes-player.ts"));

  expect(entry && carries(entry)).toBe(false);
  expect(outputs.filter(carries)).toHaveLength(1);
}, 60_000);
