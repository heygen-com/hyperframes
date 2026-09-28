import { expect, it } from "bun:test";
import { authoredGoogleFontStylesheets, withPageText } from "./authoredGoogleFonts.js";

const url = "https://fonts.googleapis.com/css2?family=Fraunces:wght@400";

it("decodes every family parameter and retains active screen imports in document order", () => {
  const second = "https://fonts.googleapis.com/css2?family=Fraunces:wght@700";
  const html = `<link rel="stylesheet" media="screen" href="${url}&amp;family=Test+Family:wght@700">
    <style media="all">@import '${second}' screen;</style>`;
  const resources = authoredGoogleFontStylesheets(html);
  expect(resources.get("fraunces")).toEqual([`${url}&family=Test+Family:wght@700`, second]);
  expect(resources.get("test family")).toEqual([`${url}&family=Test+Family:wght@700`]);
});

it.each([
  `<link rel="preload" href="${url}">`,
  `<link rel="stylesheet">`,
  `<link rel="stylesheet" type="text/plain" href="${url}">`,
  `<link rel="stylesheet" href="not-a-url">`,
  `<link rel="stylesheet" href="https://example.com/css2?family=Fraunces">`,
  `<link rel="stylesheet" href="http://fonts.googleapis.com/css2?family=Fraunces">`,
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=">`,
  `<style>@media print { @import '${url}'; }</style>`,
  `<style>/* @import '${url}'; */</style>`,
  `<style>@import '${url}'; p {</style>`,
  `<style type="text/plain">@import '${url}';</style>`,
])("does not collect an inactive or invalid resource: %s", (html) => {
  expect(authoredGoogleFontStylesheets(html).size).toBe(0);
});

it("recognizes both families in a legacy Google Fonts URL", () => {
  const legacy = "https://fonts.googleapis.com/css?family=Fraunces:400|Other:700";
  expect([
    ...authoredGoogleFontStylesheets(`<link rel=stylesheet href="${legacy}">`).keys(),
  ]).toEqual(["fraunces", "other"]);
});

it("adds a text subset before the URL fragment without replacing authored text", () => {
  expect(withPageText(`${url}#anchor`, "Hi")).toBe(`${url}&text=Hi#anchor`);
  expect(withPageText(`${url}&text=Original#anchor`, "Hi")).toBe(`${url}&text=Original#anchor`);
  expect(withPageText("https://fonts.googleapis.com/css2", "Hi")).toBe(
    "https://fonts.googleapis.com/css2?text=Hi",
  );
  expect(withPageText(url, undefined)).toBe(url);
});
