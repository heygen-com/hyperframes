import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser({ autoplay: "gesture" });

try {
  const page = await browser.newPage();
  await page.goto(`${server.origin}/host.html?fixture=sealed-audio`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  await page.evaluate(() => {
    const player = document.getElementById("player")!;
    player.removeAttribute("muted");
    window.__playerReady = false;
    player.setAttribute("sandbox-origin", "opaque");
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  type Player = HTMLElement & {
    play: () => void;
    _audioOwner: string;
    _parentMedia: { el: HTMLMediaElement }[];
  };
  await page.evaluate(() => (document.getElementById("player") as Player).play());
  await page.waitForFunction(
    () => (document.getElementById("player") as Player)._audioOwner === "parent",
    { timeout: 30_000 },
  );
  const copies = await page.evaluate(() =>
    (document.getElementById("player") as Player)._parentMedia.map((m) => m.el.src),
  );
  assert.deepEqual(
    copies,
    [`${server.origin}/fixtures/sealed-audio/tone.m4a`],
    "a sealed player loaded by src copies its film's sound into the page when the frame may not start it",
  );
  console.log("[sealed-audio] a refused sealed frame's sound plays from a copy in the page");
} finally {
  await browser.close();
  await server.stop();
}
