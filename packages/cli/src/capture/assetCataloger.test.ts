import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import type { Page } from "puppeteer-core";
import { annotateGifAssetMetadata, catalogAssets, type CatalogedAsset } from "./assetCataloger.js";

async function catalog(body: string): Promise<CatalogedAsset[]> {
  const window = new Window({ url: "https://example.com/gallery/" });
  window.document.body.innerHTML = body;
  const evaluate: Page["evaluate"] = async (script, ..._args) => {
    if (typeof script !== "string") throw new Error("Expected a page expression");
    return runInNewContext(script, {
      URL,
      window,
      document: window.document,
      getComputedStyle: window.getComputedStyle.bind(window),
    });
  };
  try {
    return await catalogAssets({ evaluate });
  } finally {
    await window.happyDOM.close();
  }
}

describe("catalogAssets", () => {
  it("catalogs every srcset-only image candidate with its DOM context", async () => {
    const assets = await catalog(`
      <header><h1>Waterfall gallery</h1><figure>
        <img srcset="waterfall.jpg 1x, waterfall-large.jpg 2x" alt="A waterfall">
      </figure></header>
    `);

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.url)).toEqual([
      "https://example.com/gallery/waterfall.jpg",
      "https://example.com/gallery/waterfall-large.jpg",
    ]);
    for (const asset of assets) {
      expect(asset).toMatchObject({
        type: "Image",
        contexts: ["img[srcset]"],
        notes: "A waterfall",
        description: "A waterfall",
        nearestHeading: "Waterfall gallery",
        inBanner: true,
      });
    }
  });

  it("keeps the largest optimized variant of a srcset-only image", async () => {
    const assets = await catalog(`
      <img srcset="/_next/image?url=%2Fhero.jpg&amp;w=640&amp;q=75 640w,
                   /_next/image?url=%2Fhero.jpg&amp;w=1280&amp;q=75 1280w" alt="Hero photograph">
    `);

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      url: "https://example.com/_next/image?url=%2Fhero.jpg&w=1280&q=75",
      contexts: ["img[srcset]"],
      description: "Hero photograph",
    });
  });

  it("merges src and srcset references to the same image", async () => {
    const assets = await catalog('<img src="hero.jpg" srcset="hero.jpg 1x" alt="Hero">');

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      url: "https://example.com/gallery/hero.jpg",
      contexts: ["img[src]", "img[srcset]"],
      description: "Hero",
    });
  });

  it("retains picture sources without cataloging an image that has no source", async () => {
    const assets = await catalog(`
      <picture><source srcset="portrait.webp 1x"><img alt="Portrait"></picture>
      <img alt="Unloaded">
    `);

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      url: "https://example.com/gallery/portrait.webp",
      contexts: ["source[srcset]"],
    });
  });
});

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function ascii(value: string): number[] {
  return Array.from(value).map((char) => char.charCodeAt(0));
}

function frame(delayCentiseconds: number): number[] {
  return [
    0x21,
    0xf9,
    0x04,
    0x00,
    ...u16(delayCentiseconds),
    0x00,
    0x00,
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x02,
    0x02,
    0x4c,
    0x01,
    0x00,
  ];
}

function gif(frames: number[], loopCount?: number): Uint8Array {
  const loop =
    loopCount === undefined
      ? []
      : [0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 0x03, 0x01, ...u16(loopCount), 0x00];
  return Uint8Array.from([
    ...ascii("GIF89a"),
    ...u16(1),
    ...u16(1),
    0x00,
    0x00,
    0x00,
    ...loop,
    ...frames,
    0x3b,
  ]);
}

describe("annotateGifAssetMetadata", () => {
  it("adds frame, duration, and loop notes for animated GIF assets", async () => {
    const assets: CatalogedAsset[] = [
      {
        url: "https://cdn.example.com/reaction.gif?v=1",
        type: "Image",
        contexts: ["img[src]"],
        notes: "reaction",
      },
      {
        url: "https://cdn.example.com/logo.png",
        type: "Image",
        contexts: ["img[src]"],
      },
    ];
    const readUrls: string[] = [];

    const annotated = await annotateGifAssetMetadata(assets, async (url) => {
      readUrls.push(url);
      return gif([...frame(5), ...frame(15)], 0);
    });

    expect(readUrls).toEqual(["https://cdn.example.com/reaction.gif?v=1"]);
    expect(annotated[0]?.notes).toBe("reaction; animated GIF: 2 frames, 0.200s, loops forever");
    expect(annotated[1]?.notes).toBeUndefined();
  });

  it("marks single-frame GIF assets without changing non-GIF assets", async () => {
    const assets: CatalogedAsset[] = [
      {
        url: "https://cdn.example.com/still.gif",
        type: "Image",
        contexts: ["img[src]"],
      },
      {
        url: "https://cdn.example.com/hero.webp",
        type: "Image",
        contexts: ["img[src]"],
        notes: "hero",
      },
    ];

    const annotated = await annotateGifAssetMetadata(assets, async () => gif(frame(10)));

    expect(annotated[0]?.notes).toBe("single-frame GIF");
    expect(annotated[1]?.notes).toBe("hero");
  });
});
