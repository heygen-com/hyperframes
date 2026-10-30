import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Invokes the function's `warm` action and waits, so its container image is loaded before the first render. */
export function warmFunction(opts: {
  functionName: string;
  region: string;
  awsProfile?: string;
}): void {
  const dir = mkdtempSync(join(tmpdir(), "hf-warm-"));
  try {
    const args = [
      "lambda",
      "invoke",
      "--function-name",
      opts.functionName,
      "--region",
      opts.region,
      "--output",
      "json",
      "--cli-binary-format",
      "raw-in-base64-out",
      "--payload",
      JSON.stringify({ Action: "warm" }),
      join(dir, "out.json"),
    ];
    if (opts.awsProfile) args.unshift("--profile", opts.awsProfile);
    const result = spawnSync("aws", args, { encoding: "utf-8", timeout: 120_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `aws lambda invoke exited with code ${result.status ?? "unknown"}: ${result.stderr}`,
      );
    }
    const { FunctionError } = JSON.parse(result.stdout) as { FunctionError?: string };
    if (FunctionError) throw new Error(`the function answered ${FunctionError}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
