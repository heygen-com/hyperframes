import { snippetSource } from "./snippetSource";
import { Inspector } from "../src/service";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const original = process.argv[2],
  output = process.argv[3];
if (!original || !output) throw new Error("Pass film directory and output JSON");
const project = mkdtempSync(join(tmpdir(), "hf-inspector-film-"));
for (const entry of ["index.html", "compositions", "assets"])
  cpSync(join(original, entry), join(project, entry), { recursive: true });
const inspector = new Inspector(project);
const control = new Inspector(project, { instrument: false });
const notes: Record<string, unknown> = {};
async function state() {
  return inspector.withPage((page) =>
    page.evaluate(() => {
      const win = window as Window & {
        __player?: { getTime: () => number; getDuration: () => number };
        __timelines?: Record<string, { duration: () => number }>;
      };
      return {
        time: win.__player?.getTime?.(),
        duration: win.__player?.getDuration?.(),
        timelines: Object.fromEntries(
          Object.entries(win.__timelines ?? {}).map(([k, v]) => [k, v.duration()]),
        ),
      };
    }),
  );
}
try {
  const cold = await inspector.inspect({ targets: [{ selector: "#flow-title" }] });
  notes.cold = cold;
  notes.coldBytes = Buffer.byteLength(JSON.stringify(cold));
  const target = { selector: ".sm-body", within: "#sys-module-e" };
  const card = await inspector.inspect({ targets: [target] });
  notes.card = card;
  notes.cardBytes = Buffer.byteLength(JSON.stringify(card));
  assert(Buffer.byteLength(JSON.stringify(card)) <= 12000);
  const multi = await inspector.inspect({
    targets: [
      { selector: "#flow-title" },
      { selector: ".sm-knob", within: "#sys-module-e" },
      { selector: "#finish-title" },
    ],
  });
  notes.multi = multi;
  const before = await state();
  notes.before = before;
  const path = join(project, "compositions/components/system-module.html");
  const source = readFileSync(path, "utf8");
  writeFileSync(path, source + "\n<!-- inspection generation regression -->\n");
  const after = await inspector.inspect({ targets: [target], time: 61.56 });
  notes.after = after;
  notes.afterState = await state();
  assert.equal(inspector.stats.browserStarts, 1);
  assert.equal(inspector.stats.pageLoads, 2);
  for (const snippet of after.snippets)
    assert.equal(snippet.code, snippetSource(project, snippet.id));
  const afterState = notes.afterState as typeof before;
  assert.deepEqual(afterState.timelines, before.timelines);
  const parity = [];
  for (const time of [5, 30, 65, 85]) {
    const capture = async (i: Inspector) =>
      i.withPage(async (page) => {
        await page.evaluate((t) => {
          const w = window as Window & {
            __player?: { renderSeek: (t: number, o: { exact: boolean }) => void };
          };
          w.__player!.renderSeek(t, { exact: true });
        }, time);
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        return Buffer.from(await page.screenshot());
      });
    const on = await capture(inspector),
      off = await capture(control);
    parity.push({ time, equal: on.equals(off) });
    assert(on.equals(off));
  }
  notes.parity = parity;
  notes.stats = inspector.stats;
  notes.metrics = await inspector.withPage(async (page) => {
    const root = page.browser().process()?.pid;
    const entries = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const pids = new Set([root]);
    for (let i = 0; i < 10; i++)
      for (const [pid, parent] of entries) if (pids.has(parent)) pids.add(pid);
    return {
      page: await page.metrics(),
      browserTreeRssKiB: entries
        .filter(([pid]) => pids.has(pid))
        .reduce((sum, row) => sum + row[2], 0),
      processes: pids.size,
    };
  });
  writeFileSync(output, JSON.stringify(notes, null, 2));
  console.log(
    JSON.stringify({
      coldMs: cold.elapsedMs,
      warmMs: card.elapsedMs,
      afterEditMs: after.elapsedMs,
      coldBytes: notes.coldBytes,
      cardBytes: notes.cardBytes,
      parity,
      stats: inspector.stats,
    }),
  );
} finally {
  await inspector.dispose();
  await control.dispose();
  rmSync(project, { recursive: true, force: true });
}
