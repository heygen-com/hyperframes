import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stagePublishFiles } from "./publishProject.js";
import type { LeftOutReference } from "./leftOutReference.js";
import { terminalText } from "@hyperframes/core";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Stages `<root>/<project>` from `files` (`<root>` in a body is the root's path) and hears what it leaves out. */
function leftOutOf(project: string, files: Record<string, string>, received?: string[]) {
  const root = mkdtempSync(join(tmpdir(), "hf-left-out-"));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body.replaceAll("<root>", root));
  }
  if (received) {
    mkdirSync(join(root, project, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(root, project, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: received }),
    );
  }
  const heard: { warning: string; reference: LeftOutReference }[] = [];
  stagePublishFiles(join(root, project), Infinity, (warning, reference) =>
    heard.push({ warning, reference }),
  );
  return { root, heard };
}

describe("each file an upload leaves out is also reported for a program", () => {
  it("names the referring file, the reference as written, where it leads and how far up", () => {
    const { heard } = leftOutOf("work/p", {
      ".ssh/id_ed25519": "KEY",
      "work/p/index.html": `<img src="../../.ssh/id_ed25519">`,
    });
    expect(heard).toEqual([
      {
        warning: expect.stringContaining("index.html references ../../.ssh/id_ed25519"),
        reference: {
          file: "index.html",
          reference: "../../.ssh/id_ed25519",
          path: "../../.ssh/id_ed25519",
          reason: "blocklisted",
          levels_up: 2,
        },
      },
    ]);
  });

  it("gives an absolute reference its path from the project, and a received one its reason", () => {
    const { heard } = leftOutOf(
      "p",
      { "shared/logo.png": "png", "p/index.html": `<img src="<root>/shared/logo.png">` },
      ["index.html"],
    );
    expect(heard.map(({ reference }) => reference)).toEqual([
      {
        file: "index.html",
        reference: expect.stringMatching(/\/shared\/logo\.png$/),
        path: "../shared/logo.png",
        reason: "received",
        levels_up: 1,
      },
    ]);
  });

  it.skipIf(process.platform === "win32")("reports a link by its own path and its target", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-left-out-link-"));
    dirs.push(root);
    mkdirSync(join(root, ".config"));
    writeFileSync(join(root, ".config", "token"), "KEY");
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, "p", "index.html"), "<html></html>");
    symlinkSync(join(root, ".config", "token"), join(root, "p", "token.txt"));
    const heard: LeftOutReference[] = [];
    stagePublishFiles(join(root, "p"), Infinity, (_warning, reference) => heard.push(reference));
    expect(heard).toEqual([
      {
        file: "token.txt",
        reference: "token.txt",
        path: "../.config/token",
        reason: "blocklisted",
        levels_up: 1,
      },
    ]);
  });
});

describe("a left-out warning", () => {
  it("prints the reference without its control characters and reports it as written", () => {
    const query = "?\u001b[2K\u001b[1A\u0007";
    const { root, heard } = leftOutOf("p", {
      ".ssh/id_ed25519": "KEY",
      "p/index.html": `<img src="<root>/.ssh/id_ed25519${query}">`,
    });
    const reference = `${root}/.ssh/id_ed25519${query}`;
    expect(heard).toHaveLength(1);
    expect(heard[0]?.warning).toContain(`/.ssh/id_ed25519?\\x1b[2K\\x1b[1A\\x07,`);
    expect(heard[0]?.warning).toBe(terminalText(heard[0]?.warning ?? ""));
    expect(JSON.stringify(heard[0]?.reference)).toBe(
      JSON.stringify({
        file: "index.html",
        reference,
        path: "../.ssh/id_ed25519",
        reason: "blocklisted",
        levels_up: 1,
      }),
    );
  });
});
