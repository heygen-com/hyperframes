// Probe, removed before review: pulls into a project Desktop's project history is watching, as Desktop watches it.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectHistory } from "@hyperframes/studio-server";
import { expect, it, vi } from "vitest";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ authorization: "Bearer test" }),
  resolveCloudBaseUrl: () => "https://api.heygen.test",
}));

import { pullTemplate, TEMPLATES } from "./templates.js";

const LINK = "https://signed.test/bundle.tar.gz?sig=1";

function bigArchive(root: string): Buffer {
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "SKILL.md"), "# sample\n");
  for (let i = 0; i < 40; i++) writeFileSync(join(src, `scene-${i}.html`), randomBytes(1_500_000).toString("base64"));
  const out = join(root, "bundle.tar.gz");
  execFileSync("tar", ["-czf", out, "-C", src, "."]);
  return readFileSync(out);
}

it("pulls into a project its history is watching, every time", { timeout: 600_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-probe-"));
  const archive = bigArchive(root);
  TEMPLATES["sample"] = {
    id: "M9001",
    sha256: createHash("sha256").update(archive).digest("hex"),
    bytes: archive.length,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === LINK
        ? new Response(new Uint8Array(archive))
        : new Response(JSON.stringify({ data: { url: LINK, expires_in: 300 } })),
    ),
  );
  const failures: string[] = [];
  const rounds = 12;
  for (let round = 0; round < rounds; round++) {
    const project = mkdtempSync(join(root, "project-"));
    writeFileSync(join(project, "index.html"), "<html></html>");
    const history = await openProjectHistory({
      projectDir: project,
      historyRoot: mkdtempSync(join(root, "history-")),
      onError: () => {},
    });
    const watcher = watch(project, { recursive: true }, (_event, name) => {
      if (name) history.noteChange(name.toString());
    });
    try {
      await pullTemplate("sample", project);
    } catch (error) {
      failures.push(`round ${round}: ${(error as Error).message}`);
    } finally {
      watcher.close();
      await history.close();
    }
  }
  console.log(`PROBE ${process.platform}: ${failures.length} of ${rounds} pulls failed`);
  for (const failure of failures) console.log(`PROBE ${failure}`);
  expect(failures).toEqual([]);
});
