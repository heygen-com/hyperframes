const assert = require("node:assert/strict");
const test = require("node:test");
const { stripGsapSri } = require("./preview-frames.cjs");

test("removes SRI attributes only from GSAP script tags", () => {
  const html = `
    <script src="https://cdn.example/gsap@3.14.2/gsap.min.js" integrity="sha384-old" crossorigin="anonymous"></script>
    <script src="https://cdn.example/app.js" integrity="sha384-app" crossorigin="anonymous"></script>
  `;
  const result = stripGsapSri(html);

  assert.match(result, /gsap\.min\.js"><\/script>/);
  assert.match(result, /app\.js" integrity="sha384-app" crossorigin="anonymous"/);
  assert.doesNotMatch(result.match(/<script[^>]*gsap[^>]*>/i)[0], /integrity|crossorigin/i);
});
