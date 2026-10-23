// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

let projectDir: string;
const requested: string[] = [];
const fetchImpl = Object.assign(
  async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response("", { status: 404 });
  },
  {
    preconnect: fetch.preconnect,
  },
);

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hf-linked-stylesheet-"));
  requested.length = 0;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

it("embeds families requested only by a local linked stylesheet, honouring its @import and @font-face", async () => {
  mkdirSync(join(projectDir, "compositions/assets"), { recursive: true });
  writeFileSync(
    join(projectDir, "compositions/assets/title.css"),
    `@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500");
    .title { font-family: "Montserrat", sans-serif; } .kicker { font-family: "Fraunces", serif; }`,
  );
  writeFileSync(
    join(projectDir, "own.css"),
    `@font-face { font-family: "Inter"; src: url(inter.woff2); } p { font-family: Inter; }`,
  );
  const html = `<html><head>
    <link rel="stylesheet" href="compositions/assets/title.css">
    <link rel="stylesheet" href="own.css?v=2">
    <link rel="stylesheet" href="missing.css">
  </head><body><h1 class="title">Title</h1><p>Body</p></body></html>`;

  const result = await injectDeterministicFontFaces(html, {
    fetchImpl,
    allowSystemFontCapture: false,
    stylesheetBaseDir: projectDir,
  });

  expect(result).toContain(`font-family: "Montserrat";`);
  expect(requested.some((url) => url.includes("family=Fraunces:opsz,wght@9..144,500"))).toBe(true);
  expect(result).not.toContain(`font-family: "Inter";`);
  expect(result).toContain(`<link rel="stylesheet" href="compositions/assets/title.css">`);
});

it.each([
  { linkFirst: true, selected: "Inter", rejected: "Montserrat" },
  { linkFirst: false, selected: "Montserrat", rejected: "Inter" },
])(
  "keeps linked and inline custom-property order when linkFirst=$linkFirst",
  async ({ linkFirst, selected, rejected }) => {
    writeFileSync(join(projectDir, "theme.css"), ":root { --font: Montserrat; }");
    const linked = '<link rel="stylesheet" href="theme.css">';
    const inline =
      "<style>:root { --font: Inter; } p { font-family: var(--font), sans-serif; }</style>";
    const html = `<html><head>${linkFirst ? linked + inline : inline + linked}</head><body><p>Text</p></body></html>`;

    const result = await injectDeterministicFontFaces(html, {
      fetchImpl,
      allowSystemFontCapture: false,
      stylesheetBaseDir: projectDir,
    });

    expect(result.includes(`font-family: "${selected}";`), `embeds ${selected}`).toBe(true);
    expect(result.includes(`font-family: "${rejected}";`), `does not embed ${rejected}`).toBe(
      false,
    );
    expect(result).toContain(linked);
  },
);

it.each([
  { media: "screen and (1000px <= width < 1200px)", width: 1080, active: true },
  { media: "screen and (1000px <= width < 1200px)", width: 800, active: false },
  { media: "(resolution: 2dppx)", width: 1080, dpr: 2, active: true },
  { media: "(resolution: 2dppx)", width: 1080, dpr: 1, active: false },
  { media: "(prefers-color-scheme: light)", width: 1080, active: true },
  { media: "(prefers-color-scheme: dark)", width: 1080, active: false },
])(
  "discovers linked families only when $media matches width=$width dpr=$dpr",
  async ({ media, width, dpr = 1, active }) => {
    writeFileSync(join(projectDir, "theme.css"), "p { font-family: Montserrat; }");
    const result = await injectDeterministicFontFaces(
      `<html><head><link rel="stylesheet" media="${media}" href="theme.css"></head><body><p>Text</p></body></html>`,
      {
        fetchImpl,
        allowSystemFontCapture: false,
        stylesheetBaseDir: projectDir,
        mediaContext: { viewport: { width, height: 1920 }, deviceScaleFactor: dpr },
      },
    );
    expect(result.includes('data-hyperframes-deterministic-fonts="true"')).toBe(active);
  },
);

it.each([
  { source: "linked", media: "print", active: false },
  { source: "linked", media: "screen and (min-width: 1000px)", active: true },
  { source: "inline", media: "print", active: false },
  { source: "inline", media: "screen and (min-width: 1000px)", active: true },
  { source: "nested", media: "print", active: false },
  { source: "nested", media: "screen and (min-width: 1000px)", active: true },
] as const)(
  "only active $source face in $media suppresses deterministic injection",
  async ({ source, media, active }) => {
    const face = '@font-face { font-family: "Inter"; src: url(own.woff2); }';
    let authored: string;
    switch (source) {
      case "linked":
        writeFileSync(join(projectDir, "own.css"), face);
        authored = `<link rel="stylesheet" media="${media}" href="own.css">`;
        break;
      case "inline":
        authored = `<style media="${media}">${face}</style>`;
        break;
      case "nested":
        writeFileSync(join(projectDir, "own.css"), `@media screen { @media ${media} { ${face} } }`);
        authored = '<link rel="stylesheet" href="own.css">';
        break;
      default: {
        const exhaustive: never = source;
        throw new Error(`Unexpected stylesheet source: ${exhaustive}`);
      }
    }
    const html = `<html><head>${authored}<style>p { font-family: Inter; }</style></head><body><p>Text</p></body></html>`;
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl,
      allowSystemFontCapture: false,
      stylesheetBaseDir: projectDir,
      mediaContext: { viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 },
    });
    expect(result.includes('data-hyperframes-deterministic-fonts="true"')).toBe(!active);
    expect(result).toContain(authored);
  },
);

it("uses composition dimensions when media context is omitted", async () => {
  writeFileSync(
    join(projectDir, "theme.css"),
    "@media (min-width: 1200px) { p { font-family: Montserrat; } }",
  );
  const result = await injectDeterministicFontFaces(
    '<html><head><link rel="stylesheet" href="theme.css"></head><body><div data-composition-id="main" data-width="1080" data-height="1920"><p>Text</p></div></body></html>',
    { fetchImpl, allowSystemFontCapture: false, stylesheetBaseDir: projectDir },
  );
  expect(result.includes('data-hyperframes-deterministic-fonts="true"')).toBe(false);
});

it.each(["device-width: 1080px", "device-height: 1920px", "device-aspect-ratio: 9/16"])(
  "offers fonts behind unknown (%s) without allowing its face to suppress injection",
  async (condition) => {
    writeFileSync(
      join(projectDir, "unknown.css"),
      `@font-face { font-family: Inter; src: url(own.woff2); } p { font-family: Inter; }`,
    );
    const html = `<html><head><link rel="stylesheet" media="(${condition})" href="unknown.css"></head><body><p>Text</p></body></html>`;
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl,
      allowSystemFontCapture: false,
      stylesheetBaseDir: projectDir,
    });
    expect(result).toContain('data-hyperframes-deterministic-fonts="true"');
    expect(result).toContain('font-family: "Inter";');
    expect(result).toContain(`<link rel="stylesheet" media="(${condition})" href="unknown.css">`);
  },
);

it.each([
  ["(device-width: 1080px)", false],
  ["screen", true],
] as const)(
  "only reuses an active authored face when repairing a family spelling: %s",
  async (media, active) => {
    const html = `<html><head><style>@media ${media} { @font-face { font-family: "Brand Sans"; src: url(own.woff2); } } p { font-family: BrandSans; }</style></head><body><p>Text</p></body></html>`;
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl,
      allowSystemFontCapture: false,
    });
    expect(result.includes('font-family: "BrandSans"')).toBe(active);
  },
);

it.each(["supports (display: imaginary)", "container (width > 1000px)", "scope (.unknown)"])(
  "does not let an unevaluated @%s face suppress deterministic injection",
  async (group) => {
    const html = `<html><head><style>@${group} { @font-face { font-family: Inter; src: url(own.woff2); } } p { font-family: Inter; }</style></head><body><p>Text</p></body></html>`;
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl,
      allowSystemFontCapture: false,
    });
    expect(result).toContain('data-hyperframes-deterministic-fonts="true"');
  },
);

it.each([
  '<html><body><p style="font-family: Inter">Text</p></body></html>',
  '<p style="font-family: Inter">Text</p>',
])("injects into the document head when input omits it: %s", async (html) => {
  const result = await injectDeterministicFontFaces(html, {
    fetchImpl,
    allowSystemFontCapture: false,
  });
  expect(result).toContain('<head><style data-hyperframes-deterministic-fonts="true">');
  expect(result).toContain('font-family: "Inter";');
});

it("reuses active own faces inside an unconditional layer when repairing a family spelling", async () => {
  const html =
    '<html><head><style>@layer brand { @font-face { font-family: "Brand Sans"; src: url(own.woff2); } } p { font-family: BrandSans; }</style></head><body><p>Text</p></body></html>';
  const result = await injectDeterministicFontFaces(html, {
    fetchImpl,
    allowSystemFontCapture: false,
  });
  expect(result).toContain('font-family: "BrandSans"');
  expect(result).toContain("src: url(own.woff2)");
});

it.each([
  ["theme colors.css", "theme%20colors.css"],
  ["theme#colors.css", "theme%23colors.css"],
  ["theme%colors.css", "theme%25colors.css"],
  ["theme:colors.css", "theme%3Acolors.css"],
])("finds a stylesheet using the browser's encoded path: %s", async (filename, href) => {
  writeFileSync(join(projectDir, filename), "p { font-family: Inter; }");
  const html = `<html><head><link rel="stylesheet" href="${href}?version=1#css"></head><body><p>Text</p></body></html>`;
  const result = await injectDeterministicFontFaces(html, {
    fetchImpl,
    allowSystemFontCapture: false,
    stylesheetBaseDir: projectDir,
  });
  expect(result).toContain('data-hyperframes-deterministic-fonts="true"');
  expect(result).toContain('font-family: "Inter";');
  expect(result).toContain(`href="${href}?version=1#css"`);
});
