// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { parseHostVariableValues, readDeclaredDefaults } from "../runtime/getVariables";
import { scopeCssToComposition } from "./compositionScoping";
import {
  assignBundledRuntimeCompositionIds,
  bundleToSingleHtml,
  prepareFlattenedInnerRoot,
} from "./htmlBundler";
import { parseHTMLContent } from "./htmlDocument";
import { inlineSubCompositions } from "./inlineSubCompositions";

const stamped = vi.hoisted(() => [] as string[]);

vi.mock("@hyperframes/parsers/hf-ids", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/hf-ids")>();
  return {
    ...actual,
    ensureHfIds: (html: string) => {
      stamped.push(html);
      return actual.ensureHfIds(html);
    },
  };
});

const CARD_CSS = `.card { color: var(--accent); }
#card-root .title { background: url(texture.png); }
[data-composition-id="card"][data-start="0"] .intro { opacity: 0; }`;
const CARD = `<!doctype html>
<html data-composition-variables='[{"id":"accent","type":"color","default":"red"},{"id":"title","type":"string","default":"Card"}]'>
<head><style>${CARD_CSS}</style></head>
<body>
<div id="card-root" data-composition-id="card" data-width="320" data-height="180">
  <h1 class="title intro">Title</h1>
  <img src="logo.png" alt="">
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines.card = gsap.timeline({ paused: true });</script>
</body></html>`;

const mount = (n: number) =>
  `<div data-composition-id="card" data-composition-src="compositions/card.html" data-start="${n * 2}"` +
  ` data-duration="2" data-variable-values='{"accent":"#00000${n}"}'></div>`;

it("parses a scene once however often it is mounted, and gives each mount its own scope and variables", () => {
  const document = parseHTMLContent(
    `<!doctype html><html><head></head><body><div data-composition-id="main">${[1, 2, 3].map(mount).join("")}</div></body></html>`,
  );
  const hosts = [...document.querySelectorAll("[data-composition-src]")];
  const parseHtml = vi.fn(parseHTMLContent);

  const result = inlineSubCompositions(document, hosts, {
    resolveHtml: () => CARD,
    parseHtml,
    hostIdentityMap: assignBundledRuntimeCompositionIds(hosts),
    rewriteInlineStyles: true,
    flattenInnerRoot: prepareFlattenedInnerRoot,
    readVariableDefaults: readDeclaredDefaults,
    parseHostVariables: parseHostVariableValues,
    assetExists: () => true,
  });

  // The file, then its body: once each, not once per mount.
  expect(parseHtml).toHaveBeenCalledTimes(2);
  const scopes = [1, 2, 3].map((n) => `[data-composition-id="card__hf${n}"]`);
  const sheet = CARD_CSS.replace("url(texture.png)", "url(compositions/texture.png)");
  expect(result.styles.map((style) => style.css)).toEqual(
    scopes.map((scope) =>
      scopeCssToComposition(sheet, "card", scope, "card-root", { scopeRootSelectors: true }),
    ),
  );
  expect(result.variablesByComp).toEqual({
    card__hf1: { accent: "#000001", title: "Card" },
    card__hf2: { accent: "#000002", title: "Card" },
    card__hf3: { accent: "#000003", title: "Card" },
  });
  hosts.forEach((host, i) => {
    expect(host.getAttribute("data-composition-id")).toBe(`card__hf${i + 1}`);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("compositions/logo.png");
    expect(host.querySelectorAll("h1.title")).toHaveLength(1);
  });
});

const dir = mkdtempSync(join(tmpdir(), "hf-scene-reuse-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("reads and stamps a scene file once per build however often it is mounted", async () => {
  mkdirSync(join(dir, "compositions"), { recursive: true });
  writeFileSync(join(dir, "compositions", "card.html"), CARD);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="8">
${[1, 2, 3, 4].map(mount).join("\n")}
</div>
<script>window.__timelines = {};</script>
</body></html>`,
  );

  const bundled = await bundleToSingleHtml(dir, { stampHfIds: true, inlineAssets: false });

  expect(stamped.filter((html) => html === CARD)).toHaveLength(1);
  for (const n of [1, 2, 3, 4])
    expect(bundled).toContain(`[data-composition-id="card__hf${n}"] .card`);
});
