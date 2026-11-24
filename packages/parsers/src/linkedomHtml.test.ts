import { describe, expect, it } from "vitest";
import { DOMParser, parseHTML } from "./linkedomHtml.js";

const READ_UNLIKE_BROWSER = /can't be read the way a browser reads them/;

const HIDDEN = "<svg><title><!-- </title><img src=x onerror=f()> --></title></svg>";
const page = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;

// fails without the fix: linkedom ended the title inside its comment, so a browser's inert comment became a live img.
describe("parseHTML", () => {
  it.each([
    HIDDEN,
    "<svg><style><!-- </style><img src=x onerror=f()> --></style></svg>",
    "<math><title><!-- </title><img src=x onerror=f()> --></title></math>",
    "<svg><style><![CDATA[ a{} ]]><!-- </style><img src=x onerror=f()> --></style></svg>",
    `<template><div>${HIDDEN}</div></template>`,
  ])("refuses %s, which a browser reads differently", (body) => {
    expect(() => parseHTML(page(body))).toThrow(READ_UNLIKE_BROWSER);
    expect(() => new DOMParser().parseFromString(page(body), "text/html")).toThrow(
      READ_UNLIKE_BROWSER,
    );
  });

  it.each([
    '<svg viewBox="0 0 4 4"><title>Icon 1 &lt; 2 &amp; 3</title><circle r="2"></circle></svg>',
    "<title>Page</title><style>a > b { color: red }</style>",
    "<p><!-- </title><img> --></p>",
    '<head><meta name="description" content="x"></head>',
    "<template></template>",
    "<svg><foreignObject><title>a <b> c</title></foreignObject></svg>",
    '<svg><style><![CDATA[ a::after { content: "<b>" } ]]></style></svg>',
  ])("reads %s as linkedom does", (body) => {
    const { document } = parseHTML(page(body));
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });

  it("reads a page that is only a comment", () => {
    expect(() => parseHTML("<!-- <template><div></div></template> -->")).not.toThrow();
  });

  it("leaves svg read as XML to linkedom", () => {
    const doc = new DOMParser().parseFromString(HIDDEN, "image/svg+xml");
    expect(doc.querySelectorAll("img")).toHaveLength(0);
  });
});
