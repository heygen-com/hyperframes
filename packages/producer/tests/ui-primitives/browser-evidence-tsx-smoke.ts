import puppeteer from "puppeteer";
import {
  collectCanonicalEvidence,
  collectReducedMotionEvidence,
  collectSemanticStateEvidence,
  collectTimelineEvidence,
  loadFixture,
} from "./browser-evidence.js";
import { emulateVerifierMedia } from "./runner.js";
import { auditSemanticStateSnapshot } from "./verify.js";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true });
  await emulateVerifierMedia(page, { reducedMotion: false, forcedColors: true });
  if (!(await page.evaluate(() => matchMedia("(forced-colors: active)").matches))) {
    throw new Error("CDP forced-colors emulation did not activate");
  }
  await emulateVerifierMedia(page, { reducedMotion: false, forcedColors: false });
  if (await page.evaluate(() => matchMedia("(forced-colors: active)").matches)) {
    throw new Error("CDP forced-colors emulation did not reset");
  }
  await loadFixture(
    page,
    `<!doctype html>
      <html>
        <head>
          <style>
            label { position: relative; display: grid; width: 240px; gap: 8px; }
            select { width: 240px; height: 40px; }
            label::after { position: absolute; inset-inline: 0; bottom: -2px; height: 44px; content: ""; }
            [role="separator"] { width: 12px; height: 80px; margin-top: 60px; }
            .bad-focus { width: 80px; height: 44px; outline: none; }
            .motion-probe { transition: transform 160ms ease; }
            @media (prefers-reduced-motion: reduce) {
              .motion-probe { transition-duration: 0s; }
            }
          </style>
        </head>
        <body>
          <label data-hf-ui-root>
            <span>Quality</span>
            <select><option>Painted</option></select>
            <div class="resize-handle" role="separator" tabindex="0" aria-label="Resize"></div>
            <div class="bad-focus" role="button" tabindex="-1" aria-label="Bad focus"></div>
            <div class="motion-probe">Motion probe</div>
          </label>
        </body>
      </html>`,
  );
  await emulateVerifierMedia(page, { reducedMotion: true, forcedColors: false });
  const reducedProbe = await page.evaluate(() => ({
    matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    duration: getComputedStyle(document.querySelector(".motion-probe")!).transitionDuration,
  }));
  if (!reducedProbe.matches || reducedProbe.duration !== "0s") {
    throw new Error(`persistent reduced-motion emulation failed: ${JSON.stringify(reducedProbe)}`);
  }
  await emulateVerifierMedia(page, { reducedMotion: false, forcedColors: false });
  await page.addScriptTag({
    content: `
      window.axe = { run: async () => ({ violations: [] }) };
      window.__timelines = {
        smoke: {
          labels: { start: 0, end: 1 },
          duration: () => 1,
          pause() {},
          seek() {},
          time() {},
        },
      };
    `,
  });
  const canonical = await collectCanonicalEvidence(page, "select");
  const selectTarget = canonical.targets.find((target) => target.selector === "select");
  const separatorTarget = canonical.targets.find((target) =>
    target.selector.includes("resize-handle"),
  );
  if ((selectTarget?.effective.height ?? 0) < 44) {
    throw new Error("associated label did not expand the select target to 44px");
  }
  if (canonical.semantics.focus?.unobscured !== true) {
    throw new Error("associated label incorrectly obscured its select control");
  }
  if (separatorTarget?.requiresDefaultControlFace !== false) {
    throw new Error("separator handle was not classified as a compact functional face");
  }
  const badFocus = await collectCanonicalEvidence(page, ".bad-focus");
  if (badFocus.semantics.focus?.sequential !== false) {
    throw new Error("tabindex=-1 was incorrectly treated as sequentially focusable");
  }
  if (badFocus.semantics.focus?.indicatorVisible !== false) {
    throw new Error("outline:none was incorrectly treated as a visible focus indicator");
  }
  await collectReducedMotionEvidence(page);
  await collectTimelineEvidence(page, ["start", "end"]);
  const text = await page.$eval("option", (element) => element.textContent);
  if (text !== "Painted") throw new Error(`unexpected fixture content: ${text ?? "null"}`);

  await loadFixture(
    page,
    `<!doctype html><html><body>
      <div data-hf-ui-root>
        <button
          data-hf-semantic-controller
          aria-controls="bad-region"
          aria-expanded="false"
        >Toggle</button>
        <div id="bad-region" data-hf-semantic-region aria-hidden="true">
          <button>Focusable despite aria-hidden</button>
        </div>
      </div>
    </body></html>`,
  );
  const ariaHiddenOnly = await collectSemanticStateEvidence(
    page,
    {
      id: "bad-fixture",
      mode: "controlled",
      controller: "[data-hf-semantic-controller]",
      relationship: "aria-controls",
    },
    "closed",
    { runAxe: false },
  );
  const falsePassCategories = auditSemanticStateSnapshot(ariaHiddenOnly).map(
    (failure) => failure.category,
  );
  const expectedFalsePassCategories = [
    "state.closed-not-hidden",
    "state.closed-not-inert",
    "state.closed-sequential-focus",
    "state.closed-programmatic-focus",
  ];
  if (JSON.stringify(falsePassCategories) !== JSON.stringify(expectedFalsePassCategories)) {
    throw new Error(`aria-hidden-only fixture escaped gates: ${falsePassCategories.join(",")}`);
  }

  await loadFixture(
    page,
    `<!doctype html><html><body>
      <div data-hf-ui-root>
        <button
          data-hf-semantic-controller
          aria-controls="hidden-menu"
          aria-expanded="false"
        >Actions</button>
        <div
          id="hidden-menu"
          role="menu"
          data-hf-semantic-region
          hidden
          inert
          aria-hidden="true"
        >
          <button role="menuitem">Duplicate</button>
        </div>
      </div>
    </body></html>`,
  );
  const hiddenMenu = await collectSemanticStateEvidence(
    page,
    {
      id: "hidden-menu-fixture",
      mode: "controlled",
      controller: "[data-hf-semantic-controller]",
      relationship: "aria-controls",
    },
    "closed",
    { runAxe: false },
  );
  if (hiddenMenu.region.axPresent) {
    throw new Error("ignored AX placeholder was treated as an exposed hidden menu");
  }
} finally {
  await browser.close();
}
