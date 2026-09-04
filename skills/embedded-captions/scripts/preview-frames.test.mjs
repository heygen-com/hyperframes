import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { sriSha384, withPreviewGsapSri } = require("./preview-frames.cjs");

test("preview GSAP integrity matches the intercepted asset bytes", () => {
  const servedAsset = Buffer.from("the exact local GSAP response body");
  const html = `
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" integrity="sha384-stale" crossorigin="anonymous"></script>
    <script src="https://cdn.example.test/app.js" integrity="sha384-app" crossorigin="anonymous"></script>
  `;

  const emitted = withPreviewGsapSri(html, servedAsset);
  const expected = `sha384-${crypto.createHash("sha384").update(servedAsset).digest("base64")}`;
  const gsapTag = emitted.match(/<script[^>]*gsap[^>]*>/i)[0];

  assert.equal(sriSha384(servedAsset), expected);
  assert.match(gsapTag, new RegExp(`integrity="${expected}"`));
  assert.match(gsapTag, /crossorigin="anonymous"/);
  assert.match(emitted, /app\.js" integrity="sha384-app" crossorigin="anonymous"/);
});
