import { describe, expect, it } from "vitest";
import { extractStandaloneEntryFromIndex } from "./standaloneEntry";

describe("extractStandaloneEntryFromIndex", () => {
  it("reuses the index wrapper and keeps only the requested composition host", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { background: #111; }</style>
</head>
<body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="5"></div>
    <div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="12"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toContain('data-composition-id="root"');
    expect(extracted).toContain('id="outro"');
    expect(extracted).toContain('data-composition-src="compositions/outro.html"');
    expect(extracted).toContain('data-start="0"');
    expect(extracted).not.toContain('id="intro"');
    expect(extracted).toContain("<style>body { background: #111; }</style>");
  });

  it("matches normalized data-composition-src paths", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="./compositions/intro.html" data-start="3"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/intro.html");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain('data-start="0"');
    expect(extracted).toContain('data-composition-src="./compositions/intro.html"');
  });

  it("returns null when index.html does not mount the requested entry file", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toBeNull();
  });

  it("re-points the wrapper duration at the scene's own, not the master's", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-duration="12">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0" data-duration="2"></div>
  </div>
</body>
</html>`;
    const sceneHtml = `<template id="scene1-template"><div data-composition-id="scene1" data-width="640" data-height="360" data-duration="3"></div></template>`;

    const extracted = extractStandaloneEntryFromIndex(
      indexHtml,
      "compositions/scene1.html",
      sceneHtml,
    );

    // The extracted standalone advertises the scene file's 3s, not the mount's 2s or master's 12s.
    expect(extracted).toContain('data-duration="3"');
    expect(extracted).not.toContain('data-duration="12"');
  });

  it("falls back to the mount's data-duration when the scene file isn't supplied", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="master" data-width="640" data-height="360" data-duration="12">
    <div id="scene1" data-composition-id="scene1" data-composition-src="compositions/scene1.html" data-start="0" data-duration="2"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/scene1.html");

    expect(extracted).toContain('data-duration="2"');
    expect(extracted).not.toContain('data-duration="12"');
  });
});
