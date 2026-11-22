// A sealed preview never keeps the keyboard: when its own script focuses an input in it, the next real key still
// reaches Studio; a real Delete after a canvas click deletes the picked clip; a text edit Studio opens keeps the keys
// until it ends, or until Studio takes focus back, then gives them back. STUDIO_URL: a Studio started with
// VITE_STUDIO_OPAQUE_PREVIEW_ENABLED=1 on the sealed-keyboard fixture, whose folder is STUDIO_PROJECT_DIR.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchStudioChrome } from "./chrome-executable.mjs";

const url = process.env.STUDIO_URL;
const projectDir = process.env.STUDIO_PROJECT_DIR;
assert(
  url && projectDir,
  "STUDIO_URL and STUDIO_PROJECT_DIR must point at a sealed Studio's sealed-keyboard project",
);
const saved = () => readFileSync(join(projectDir, "index.html"), "utf8");
/** A person's click on an element of the preview, mapped through the frame's on-screen scale. */
async function clickInPreview(page, frame, selector) {
  const inFrame = await frame.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: innerWidth };
  }, selector);
  const iframe = await page.evaluateHandle(() =>
    document.querySelector("hyperframes-player").shadowRoot.querySelector("iframe"),
  );
  const box = await iframe.boundingBox();
  const scale = box.width / inFrame.width;
  await page.mouse.click(box.x + inFrame.x * scale, box.y + inFrame.y * scale, { delay: 120 });
}
const { browser } = await launchStudioChrome();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("hyperframes-player")?.painted === true);
  const frame = page.frames().find((f) => /\/preview\/~[\w-]{43}/.test(f.url()));
  const shownPreview = () => {
    const shown = page
      .frames()
      .find((f) => !f.isDetached() && /\/preview\/~[\w-]{43}/.test(f.url()));
    if (!shown) throw new Error("preview detached while it reloads");
    return shown;
  };
  // A save can reload the preview, so later steps run in the frame it shows now, again if it is replaced mid-step.
  const inPreview = (run, tries = 50) =>
    Promise.resolve()
      .then(() => run(shownPreview()))
      .catch(async (error) => {
        if (tries === 0 || !/detached/.test(String(error))) throw error;
        await new Promise((r) => setTimeout(r, 100));
        return inPreview(run, tries - 1);
      });
  assert.ok(frame, "the preview loads under its frame token");
  assert.equal(
    await frame.evaluate(() => String(window.origin)),
    "null",
    "the preview frame is sealed",
  );
  await page.evaluate(() => {
    window.__studioKeys = [];
    addEventListener("keydown", (e) => window.__studioKeys.push(e.key), true);
  });
  const keyboardBackInStudio = () =>
    page.waitForFunction(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return el?.tagName !== "IFRAME";
    });
  // The frame's own script puts focus on an ordinary input in it, as a composition may.
  await inPreview((f) => f.evaluate(() => document.getElementById("field").focus()));
  await keyboardBackInStudio();
  await page.keyboard.press("y");
  await page.waitForFunction(() => window.__studioKeys.includes("y"));
  assert.equal(
    await inPreview((f) => f.evaluate(() => document.getElementById("field").value)),
    "",
    "the frame got no key",
  );

  // A clip picked on the canvas, then a real Delete: Studio deletes it.
  assert.ok(saved().includes('id="plain"'));
  await inPreview((f) => clickInPreview(page, f, "#plain"));
  await page.waitForFunction(
    () => new URLSearchParams(location.hash.split("?")[1]).get("selId") === "plain",
  );
  await keyboardBackInStudio();
  await page.keyboard.press("Delete");
  for (let i = 0; i < 100 && saved().includes('id="plain"'); i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.ok(!saved().includes('id="plain"'), "a real Delete after a canvas click deletes the clip");

  // The heading picked on the canvas, Enter opens its text edit in the frame, typing goes on at its end.
  const typeInHeading = async (text) => {
    const opened = () =>
      inPreview((f) =>
        f.waitForFunction(
          () => {
            const head = document.getElementById("head");
            return head.isContentEditable && document.activeElement === head;
          },
          { timeout: 10_000 },
        ),
      ).then(
        () => true,
        () => false,
      );
    // A pick during a save's reload can miss or keep the old frame's selection: pick again, as a person would.
    let open = false;
    for (let tries = 0; tries < 3 && !open; tries++) {
      await page.waitForFunction(
        () => document.querySelector("hyperframes-player")?.painted === true,
      );
      await inPreview((f) => clickInPreview(page, f, "#head"));
      const picked = await page
        .waitForFunction(
          () => new URLSearchParams(location.hash.split("?")[1]).get("selId") === "head",
          { timeout: 10_000 },
        )
        .then(
          () => true,
          () => false,
        );
      if (!picked) continue;
      await keyboardBackInStudio();
      await page.keyboard.press("Enter");
      open = await opened();
    }
    assert.ok(open, "Enter on the picked heading opens its text edit");
    await page.keyboard.press("End");
    await page.keyboard.type(text);
  };
  const untilSaved = async (text) => {
    for (let i = 0; i < 100 && !saved().includes(text); i++)
      await new Promise((r) => setTimeout(r, 100));
    return saved().includes(text);
  };
  await typeInHeading(" again");
  await page.keyboard.press("Enter");
  assert.ok(await untilSaved("Hi again"), "typing in the sealed text edit is saved");
  await keyboardBackInStudio();

  // An edit the film never ends: the person moves to a Studio field, then the film focuses itself.
  await typeInHeading(" more");
  await page.evaluate(() => document.body.appendChild(document.createElement("input")).focus());
  await inPreview((f) => f.evaluate(() => document.getElementById("field").focus()));
  await keyboardBackInStudio();
  assert.ok(await untilSaved("Hi again more"), "Studio taking focus back saves the edit");
  await page.keyboard.press("z");
  assert.equal(
    await inPreview((f) => f.evaluate(() => document.getElementById("field").value)),
    "",
    "the film got no key after Studio took focus back",
  );
  console.log(JSON.stringify({ studioKeys: await page.evaluate(() => window.__studioKeys) }));
} finally {
  await browser.close();
}
