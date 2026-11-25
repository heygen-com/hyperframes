import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dropReceivedArrivals,
  dropReceivedLeavers,
  onDiskPath,
  plannedReceivedChange,
  recordReceivedArrivals,
} from "./receivedRecordFollow.js";

let projectDir: string;

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function project(listed: string[]): string {
  projectDir = realpathSync.native(mkdtempSync(join(tmpdir(), "hf-record-follow-")));
  mkdirSync(join(projectDir, ".hyperframes"));
  writeFileSync(
    join(projectDir, ".hyperframes", "received-files.json"),
    JSON.stringify({ files: listed }),
  );
  for (const line of listed) writeFileSync(join(projectDir, line), "<p>received</p>");
  return projectDir;
}

const listed = (dir: string): string[] =>
  JSON.parse(readFileSync(join(dir, ".hyperframes", "received-files.json"), "utf-8")).files;

async function followRename(dir: string, planned: string, actual: string): Promise<void> {
  const change = await plannedReceivedChange(dir, join(dir, "intro.html"), join(dir, planned));
  const started = await recordReceivedArrivals(change);
  renameSync(join(dir, "intro.html"), join(dir, actual));
  await dropReceivedLeavers(started);
}

describe("following a rename in the received-files record", () => {
  it("drops the old line once the file sits at the path the record now lists", async () => {
    const dir = project(["intro.html"]);
    await followRename(dir, "opening.html", "opening.html");
    expect(listed(dir)).toEqual(["opening.html"]);
  });

  it("keeps the old line when the file is not at the path the record now lists", async () => {
    const dir = project(["intro.html"]);
    await followRename(dir, "opening.html", "elsewhere.html");
    expect(listed(dir)).toEqual(["intro.html", "opening.html"]);
  });

  it("keeps the old line when the file stays put and a copy of it appears at the planned path", async () => {
    const dir = project(["intro.html"]);
    const change = await plannedReceivedChange(
      dir,
      join(dir, "intro.html"),
      join(dir, "opening.html"),
    );
    const started = await recordReceivedArrivals(change);
    writeFileSync(join(dir, "opening.html"), "<p>received</p>");
    await dropReceivedLeavers(started);
    expect(listed(dir)).toEqual(["intro.html", "opening.html"]);
  });

  it("keeps the new line a refused rename listed when another rename moved the file there", async () => {
    const dir = project(["intro.html"]);
    const plan = () =>
      plannedReceivedChange(dir, join(dir, "intro.html"), join(dir, "opening.html"));
    const refused = await recordReceivedArrivals(await plan());
    const done = await recordReceivedArrivals(await plan());
    renameSync(join(dir, "intro.html"), join(dir, "opening.html"));
    await dropReceivedLeavers(done);
    await dropReceivedArrivals(refused);
    expect(listed(dir)).toEqual(["opening.html"]);
  });

  it("takes back the new line of a refused rename when the file did not move", async () => {
    const dir = project(["intro.html"]);
    const change = await plannedReceivedChange(
      dir,
      join(dir, "intro.html"),
      join(dir, "opening.html"),
    );
    await dropReceivedArrivals(await recordReceivedArrivals(change));
    expect(listed(dir)).toEqual(["intro.html"]);
  });

  it("keeps the old line when the planned path is the old line itself", async () => {
    const dir = project(["intro.html"]);
    await followRename(dir, "intro.html", "elsewhere.html");
    expect(listed(dir)).toEqual(["intro.html"]);
  });
});

describe("onDiskPath", () => {
  it("spells a path as the folder lists it only when the disk opens one file under both spellings", () => {
    const dir = project(["intro.html"]);
    const foldsCase = existsSync(join(dir, "INTRO.html"));
    expect(onDiskPath(join(dir, "INTRO.html"))).toBe(
      join(dir, foldsCase ? "intro.html" : "INTRO.html"),
    );
    expect(onDiskPath(join(dir, "intro.html"))).toBe(join(dir, "intro.html"));
  });
});
