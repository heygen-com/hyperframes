import { describe, expect, it } from "vitest";
import { parseSizes, rankIconCandidates, type IconCandidate } from "./faviconRanker.js";

/**
 * Fixtures transcribe the `<link>` tags these sites declare in their document head.
 * They are the shapes that made DOM-order downloading land the worst icon on disk.
 */

// linear.app: legacy .ico declared first, the SVG and the 180px apple-touch after it.
const LINEAR: IconCandidate[] = [
  { rel: "icon", href: "https://linear.app/favicon.ico", sizes: "any", type: null },
  { rel: "icon", href: "https://linear.app/favicon.svg", sizes: null, type: "image/svg+xml" },
  {
    rel: "apple-touch-icon",
    href: "https://linear.app/apple-touch-icon.png",
    sizes: "180x180",
    type: null,
  },
];

// notion.com: .ico first, then an apple-touch png that declares no `sizes`.
const NOTION: IconCandidate[] = [
  { rel: "icon", href: "https://www.notion.com/front-static/favicon.ico", sizes: null, type: null },
  {
    rel: "apple-touch-icon",
    href: "https://www.notion.com/front-static/logo-ios.png",
    sizes: null,
    type: null,
  },
];

// stripe.com: svg, a 96x96 png, a shortcut .ico, and a 180x180 apple-touch png.
const STRIPE: IconCandidate[] = [
  {
    rel: "icon",
    href: "https://images.stripeassets.com/x/favicon.svg",
    sizes: null,
    type: "image/svg+xml",
  },
  {
    rel: "icon",
    href: "https://images.stripeassets.com/x/favicon.png?w=96&h=96",
    sizes: "96x96",
    type: "image/png",
  },
  {
    rel: "shortcut icon",
    href: "https://assets.stripeassets.com/x/favicon.ico",
    sizes: null,
    type: null,
  },
  {
    rel: "apple-touch-icon",
    href: "https://images.stripeassets.com/x/favicon.png?w=180&h=180",
    sizes: "180x180",
    type: null,
  },
];

const hrefs = (cs: IconCandidate[]): string[] => rankIconCandidates(cs).map((c) => c.href);

describe("rankIconCandidates", () => {
  it("puts the SVG first even though the page declares the .ico first", () => {
    expect(hrefs(LINEAR)).toEqual([
      "https://linear.app/favicon.svg",
      "https://linear.app/apple-touch-icon.png",
      "https://linear.app/favicon.ico",
    ]);
  });

  it("prefers an unsized apple-touch-icon over a .ico", () => {
    expect(hrefs(NOTION)).toEqual([
      "https://www.notion.com/front-static/logo-ios.png",
      "https://www.notion.com/front-static/favicon.ico",
    ]);
  });

  it("orders svg, then largest declared size, then .ico", () => {
    expect(hrefs(STRIPE)).toEqual([
      "https://images.stripeassets.com/x/favicon.svg",
      "https://images.stripeassets.com/x/favicon.png?w=180&h=180",
      "https://images.stripeassets.com/x/favicon.png?w=96&h=96",
      "https://assets.stripeassets.com/x/favicon.ico",
    ]);
  });

  it("does not let a Safari pinned-tab silhouette beat the real favicon", () => {
    // A mask-icon is an SVG, so ranking on format alone would promote the silhouette.
    const masked: IconCandidate[] = [
      { rel: "mask-icon", href: "https://x.test/pinned.svg", sizes: null, type: null },
      { rel: "icon", href: "https://x.test/favicon.png", sizes: "32x32", type: "image/png" },
      { rel: "icon", href: "https://x.test/favicon.svg", sizes: null, type: "image/svg+xml" },
    ];
    expect(hrefs(masked)).toEqual([
      "https://x.test/favicon.svg",
      "https://x.test/favicon.png",
      "https://x.test/pinned.svg",
    ]);
  });

  it("still returns a mask-icon when the page declares nothing else", () => {
    // Ranked last, not dropped: a silhouette on disk beats no icon at all.
    const only: IconCandidate[] = [{ rel: "mask-icon", href: "https://x.test/pinned.svg" }];
    expect(hrefs(only)).toEqual(["https://x.test/pinned.svg"]);
  });

  it("drops candidates with no href", () => {
    expect(hrefs([{ rel: "icon", href: "" }, ...NOTION])).toHaveLength(2);
  });

  it("keeps DOM order between candidates of equal rank", () => {
    const same: IconCandidate[] = [
      { rel: "icon", href: "https://x.test/a.png", sizes: "32x32" },
      { rel: "icon", href: "https://x.test/b.png", sizes: "32x32" },
    ];
    expect(hrefs(same)).toEqual(["https://x.test/a.png", "https://x.test/b.png"]);
  });
});

describe("parseSizes", () => {
  it("reads a single declaration", () => {
    expect(parseSizes("32x32")).toBe(32);
  });

  it("takes the largest of a multi-size declaration", () => {
    expect(parseSizes("180x180 167x167")).toBe(180);
  });

  it("scores `any` as no declared pixel size", () => {
    expect(parseSizes("any")).toBe(0);
  });

  it("scores a missing attribute as no declared pixel size", () => {
    expect(parseSizes(null)).toBe(0);
    expect(parseSizes(undefined)).toBe(0);
  });
});
