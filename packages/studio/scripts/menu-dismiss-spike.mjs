#!/usr/bin/env node
/**
 * KTD6 dismiss spike, browser half.
 *
 * Boots Studio through the same helper design-shots.mjs uses, selects the
 * fixture element, mounts a Base UI ContextMenu and Menu INSIDE the real
 * canvas overlay, and drives real Chrome input at them.
 *
 * The question it answers: DomEditOverlay calls stopPropagation() on its own
 * bubble-phase pointer handlers, which is why Studio's useContextMenuDismiss
 * listens in the capture phase. Does Base UI's own outside-press dismiss
 * survive that, or does a shared Menu need Studio's capture-phase hook driving
 * its open state?
 *
 * happy-dom cannot answer it: no layout, no real hit testing, no portal
 * placement. src/components/ui/menuDismiss.spike.test.tsx is the regression
 * guard; this run is the verdict.
 *
 *   bun run --cwd packages/studio node scripts/menu-dismiss-spike.mjs
 *
 * Exit code 0 means every check passed. Every check prints its own line either
 * way, so a partial pass is readable rather than a single "failed".
 */
import { bootStudio, gotoState, selectFixtureElement } from "./design-shots.mjs";

const CONTEXT_POPUP = '[data-testid="spike-context-popup"]';
const CONTEXT_TRIGGER = '[data-testid="spike-context-trigger"]';
const MENU_POPUP = '[data-testid="spike-menu-popup"]';
const MENU_TRIGGER = '[data-testid="spike-menu-trigger"]';

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * The fixture is a source module, not inline script text, so Vite compiles its
 * JSX and resolves Base UI exactly as it does for the app. The URL is passed in
 * rather than written inline because the app never imports this module and a
 * literal import specifier here would read to static analysis as a broken one.
 */
const MOUNT_MODULE_URL = ["", "src", "components", "ui", "menuDismissSpikeMount.tsx"].join("/");

async function mountSpike(page) {
  const mounted = await page.evaluate(async (url) => {
    const mod = await import(/* @vite-ignore */ url);
    return mod.mountMenuDismissSpike();
  }, MOUNT_MODULE_URL);
  if (!mounted) throw new Error("canvas overlay not present; nothing to mount into");
}

const isOpen = (page, selector) => page.$(selector).then((el) => Boolean(el));

async function rectOf(page, selector) {
  const handle = await page.$(selector);
  if (!handle) throw new Error(`${selector} not found`);
  return handle.boundingBox();
}

/**
 * A point on the overlay that is outside both the trigger and the open popup.
 * Bottom-right of the overlay: the fixture's content sits top-left, so a press
 * there hits the overlay's empty-canvas branch, the one that calls
 * stopPropagation to start a marquee.
 */
function outsidePoint(overlay) {
  return { x: overlay.x + overlay.width - 24, y: overlay.y + overlay.height - 24 };
}

/**
 * Installs a bubble-phase document listener before the press and reports
 * whether it ever fired. It must not: that is the overlay swallowing the event,
 * which is the whole reason this spike exists. If it fires, the press missed
 * the overlay and any dismissal proves nothing.
 */
async function pressWithBubbleWitness(page, point) {
  await page.evaluate(() => {
    window.__spikeSawBubblePress = false;
    window.__spikeWitness = () => {
      window.__spikeSawBubblePress = true;
    };
    document.addEventListener("pointerdown", window.__spikeWitness);
  });
  await page.mouse.click(point.x, point.y);
  return page.evaluate(() => {
    document.removeEventListener("pointerdown", window.__spikeWitness);
    return window.__spikeSawBubblePress;
  });
}

async function openContextMenu(page) {
  const trigger = await rectOf(page, CONTEXT_TRIGGER);
  const at = { x: trigger.x + trigger.width / 2, y: trigger.y + trigger.height / 2 };
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.waitForSelector(CONTEXT_POPUP, { timeout: 5_000 });
  return at;
}

async function checkOpensNearPointer(page) {
  const at = await openContextMenu(page);
  const popup = await rectOf(page, CONTEXT_POPUP);
  const dx = Math.round(popup.x - at.x);
  const dy = Math.round(popup.y - at.y);
  // Base UI anchors a context menu to the pointer; allow a menu-sized slack for
  // flipping away from a viewport edge.
  const near = Math.abs(dx) <= 240 && Math.abs(dy) <= 240;
  record("context menu opens near the pointer", near, `offset ${dx}px, ${dy}px`);
}

async function checkOutsidePressDismisses(page) {
  if (!(await isOpen(page, CONTEXT_POPUP))) await openContextMenu(page);
  const overlay = await rectOf(page, '[aria-label="Composition canvas"]');
  const sawBubble = await pressWithBubbleWitness(page, outsidePoint(overlay));
  await waitClosed(page, CONTEXT_POPUP);
  const open = await isOpen(page, CONTEXT_POPUP);
  record(
    "outside press on the real overlay closes the context menu",
    !open && !sawBubble,
    sawBubble
      ? "the press reached a bubble-phase document listener, so the overlay did not swallow it and this check is vacuous"
      : "overlay swallowed the bubble-phase press",
  );
}

async function checkEscapeDismisses(page) {
  await openContextMenu(page);
  await page.keyboard.press("Escape");
  await waitClosed(page, CONTEXT_POPUP);
  record("Escape closes the context menu", !(await isOpen(page, CONTEXT_POPUP)));
}

async function openPanelMenu(page) {
  await page.click(MENU_TRIGGER);
  await page.waitForSelector(MENU_POPUP, { timeout: 5_000 });
}

async function waitClosed(page, selector) {
  await page
    .waitForFunction((sel) => !document.querySelector(sel), { timeout: 5_000 }, selector)
    .catch(() => {});
}

async function checkPanelMenuDismissesOverOverlay(page) {
  await openPanelMenu(page);
  const overlay = await rectOf(page, '[aria-label="Composition canvas"]');
  const sawBubble = await pressWithBubbleWitness(page, outsidePoint(overlay));
  await waitClosed(page, MENU_POPUP);
  const open = await isOpen(page, MENU_POPUP);
  record(
    "press on the real overlay closes a panel menu",
    !open && !sawBubble,
    sawBubble ? "press reached a bubble-phase document listener; check is vacuous" : undefined,
  );
}

async function checkFocusRestoreOnEscape(page) {
  await openPanelMenu(page);
  await page.keyboard.press("Escape");
  await waitClosed(page, MENU_POPUP);
  const focused = await page.evaluate(
    (sel) => document.activeElement === document.querySelector(sel),
    MENU_TRIGGER,
  );
  record("Escape returns focus to the menu trigger", focused && !(await isOpen(page, MENU_POPUP)));
}

async function main() {
  const { page, baseUrl, projectId, shutdown } = await bootStudio();
  try {
    page.on("pageerror", (e) => console.error("[page error]", e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error("[console]", m.text());
    });
    await gotoState(page, baseUrl, projectId, { tv: "1" });
    await selectFixtureElement(page);
    await page.waitForSelector('[aria-label="Composition canvas"]', { timeout: 30_000 });
    await mountSpike(page);

    await checkOpensNearPointer(page);
    await checkOutsidePressDismisses(page);
    await checkEscapeDismisses(page);
    await checkPanelMenuDismissesOverOverlay(page);
    await checkFocusRestoreOnEscape(page);
  } finally {
    await shutdown();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed on the plain Base UI path (no capture-phase wrapper).`,
  );
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
