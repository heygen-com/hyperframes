/**
 * The `?hfv=` round trip, end to end.
 *
 * A declared variable default leaves the explorer as a query parameter, passes
 * through the preview wrapper, gets a src rewrite from the player, and is read
 * back by the bootstrap the generator appends to the composition. Four hops,
 * and a value has to survive all four byte-identical.
 *
 * It did not: the player re-serialized the whole query with `URLSearchParams`
 * (form encoding, space -> `+`) while the bootstrap read it with
 * `decodeURIComponent` (percent decoding, which leaves `+` alone), so
 * "Ship it today" reached the page as "Ship+it+today" and an SVG `d` attribute
 * full of spaces stopped parsing altogether.
 *
 * These tests run the actual emitted scripts and the actual player helper, so
 * reintroducing either half of that mismatch fails them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { prepareSrcForElement } from "../packages/player/src/shader-options.ts";
import {
  mdxStringAttribute,
  stageProps,
  variableBootstrap,
  variablePreviewWrapper,
} from "./generate-catalog-pages.ts";

const here = join(fileURLToPath(import.meta.url), "..");

/** The player as the catalog uses it: no shader attributes at all, so its only
 *  effect on a src is whatever it does to the query it was handed. */
const plainPlayer = { getAttribute: () => null } as unknown as Element;

const OWN_FILE = "svg-stroke-trace.html";
const WRAPPER_BASE = `../../components/svg-stroke-trace/${OWN_FILE}`;

/**
 * Every character class this bug reaches. Spaces are the reported symptom; the
 * rest are here so a fix that special-cases spaces cannot pass.
 */
const DECLARED: Record<string, string> = {
  spaces: "Ship it today",
  plus: "C++ and 1+1 and +1 555 010 0199",
  ampersand: "a&b=c&d",
  reserved: "50% off #1 ready? yes/no",
  nonAscii: "café — naïve 東京 🎬",
  quotes: 'he said "hi" and it\'s fine',
  svgPath:
    "M 92 328 C 178 142 292 138 366 276 C 430 396 500 414 558 262 C 622 94 724 112 786 274 C 836 406 894 376 930 194",
};

function scriptBody(html: string): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(html);
  assert.ok(match, "expected exactly one inline <script>");
  return match[1] ?? "";
}

function queryOf(url: string): string {
  const index = url.indexOf("?");
  return index >= 0 ? url.slice(index) : "";
}

/**
 * Hop 1: the explorer's first load. Mirrors the one expression in
 * docs/snippets/catalog-detail.jsx that builds it, which the last test in
 * this file pins so the two cannot drift apart silently.
 */
function explorerQuery(values: Record<string, string>): string {
  return `?hfv=${encodeURIComponent(JSON.stringify(values))}`;
}

/** Hop 2: the wrapper page, run for real. Returns the src it hands the player,
 *  either from its own URL or from an explorer message. */
function runWrapper(search: string, message?: Record<string, string>): string {
  let src = "";
  let onMessage: ((event: { origin: string; data: unknown }) => void) | null = null;
  const player = {
    ready: false,
    currentTime: 0,
    setAttribute: (name: string, value: string) => {
      if (name === "src") src = value;
    },
    addEventListener: () => {},
    seek: () => {},
    play: () => {},
  };
  runInNewContext(scriptBody(variablePreviewWrapper(WRAPPER_BASE).join("\n")), {
    URLSearchParams,
    document: { getElementById: () => player },
    location: { origin: "https://docs.test", search },
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: (
      type: string,
      handler: (event: { origin: string; data: unknown }) => void,
    ) => {
      if (type === "message") onMessage = handler;
    },
  });
  if (message) {
    assert.ok(onMessage, "wrapper never registered a message listener");
    (onMessage as (event: unknown) => void)({
      origin: "https://docs.test",
      data: { hfVariables: message },
    });
  }
  return src;
}

/** Hop 4: the bootstrap the generator appends to the composition, run for real.
 *  Returns what a composition would actually read. */
function runBootstrap(search: string): {
  fromWindow: unknown;
  fromAttribute: unknown;
} {
  const host = {
    attributes: new Map<string, string>([["data-composition-src", `./${OWN_FILE}`]]),
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
  };
  const win: Record<string, unknown> = {};
  runInNewContext(scriptBody(variableBootstrap(OWN_FILE)), {
    URLSearchParams,
    document: { querySelectorAll: () => [host] },
    location: { search },
    window: win,
  });
  const raw = host.getAttribute("data-variable-values");
  // Re-parsed in this realm: the object the script built carries the vm realm's
  // Object.prototype, which deepEqual counts as a difference all by itself.
  const parsed = win.__hfVariables;
  return {
    fromWindow: parsed === undefined ? undefined : JSON.parse(JSON.stringify(parsed)),
    fromAttribute: raw === null ? null : JSON.parse(raw),
  };
}

/** A player build that form-encodes the whole query, which is what every
 *  already-published @hyperframes/player on the CDN does. The reader has to
 *  survive it, because the docs load the player from a CDN and cannot wait for
 *  a release. */
function formEncodingPlayer(src: string): string {
  const index = src.indexOf("?");
  if (index < 0) return src;
  return `${src.slice(0, index)}?${new URLSearchParams(src.slice(index + 1)).toString()}`;
}

describe("hfv round trip", () => {
  const assertDeclaredSurvives = (demoSrc: string): void => {
    const read = runBootstrap(queryOf(demoSrc));
    assert.deepEqual(read.fromWindow, DECLARED);
    assert.deepEqual(read.fromAttribute, DECLARED);
  };

  it("carries every declared value through all four hops unchanged", () => {
    assertDeclaredSurvives(prepareSrcForElement(plainPlayer, runWrapper(explorerQuery(DECLARED))));
  });

  it("survives a player build that form-encodes the query", () => {
    assertDeclaredSurvives(formEncodingPlayer(runWrapper(explorerQuery(DECLARED))));
  });

  it("carries an edited value in from the explorer's message", () => {
    const edited = { ...DECLARED, spaces: "Make it happen" };
    const demoSrc = prepareSrcForElement(plainPlayer, runWrapper("", edited));
    assert.deepEqual(runBootstrap(queryOf(demoSrc)).fromWindow, edited);
  });

  for (const [name, value] of Object.entries(DECLARED)) {
    it(`keeps ${name} byte-identical`, () => {
      const one = { [name]: value };
      const demoSrc = prepareSrcForElement(plainPlayer, runWrapper(explorerQuery(one)));
      const read = runBootstrap(queryOf(demoSrc));
      assert.deepEqual(read.fromWindow, one);
    });
  }

  it("leaves the composition alone when no values are passed", () => {
    assert.equal(runWrapper(""), WRAPPER_BASE);
    assert.deepEqual(runBootstrap(""), { fromWindow: undefined, fromAttribute: null });
  });
});

describe("player src rewriting", () => {
  it("hands the composition its query back byte-identical", () => {
    const src = "demo.html?hfv=%7B%22a%22%3A%22one%20two%22%7D&keep=a%20b%2Bc#frag";
    assert.equal(prepareSrcForElement(plainPlayer, src), src);
  });
});

describe("explorer producer", () => {
  it("still posts the values in the message the wrapper listens for", () => {
    const source = readFileSync(
      join(here, "..", "docs", "snippets", "catalog-detail.jsx"),
      "utf-8",
    );
    assert.match(source, /postMessage\(\{ hfVariables: values \}/);
  });
});

describe("mdxStringAttribute", () => {
  it("emits a plain double-quoted string, not an expression", () => {
    assert.equal(
      mdxStringAttribute("title", "beat-freeze-cut.html"),
      'title="beat-freeze-cut.html"',
    );
  });

  it("escapes the characters that would end the string or open an expression", () => {
    assert.equal(
      mdxStringAttribute("title", 'say "hi" & <b>{x}</b>'),
      'title="say &quot;hi&quot; &amp; &lt;b>&#123;x&#125;&lt;/b>"',
    );
  });

  it("leaves backticks alone inside the quoted value", () => {
    assert.equal(mdxStringAttribute("title", "`code`"), 'title="`code`"');
  });

  it("passes backslashes through unchanged, since JSX strings do not treat them as escapes", () => {
    assert.equal(mdxStringAttribute("title", "a\\b"), 'title="a\\b"');
  });
});

describe("WebGPU stage fallback props", () => {
  const page = (name: string) =>
    readFileSync(join(here, "..", "docs", "catalog", "blocks", `${name}.mdx`), "utf-8");

  it("gives a live WebGPU item its recorded clip, poster and the webgpu flag", () => {
    const mdx = page("frost-sequence-camera-orbit");
    assert.match(mdx, /^ {2}previewSrc=/m);
    assert.match(mdx, /^ {2}video=".*frost-sequence-camera-orbit\.mp4"/m);
    assert.match(mdx, /^ {2}poster=/m);
    assert.match(mdx, /^ {2}webgpu$/m);
  });

  it("leaves a live item that does not need WebGPU without a recorded fallback", () => {
    const mdx = page("ai-chat-reveal");
    assert.match(mdx, /^ {2}previewSrc=/m);
    assert.doesNotMatch(mdx, /^ {2}(video=|webgpu$)/m);
  });
});

describe("WebGPU adapter probe", () => {
  const source = readFileSync(join(here, "..", "docs", "snippets", "catalog-detail.jsx"), "utf-8");
  const fn = source.slice(
    source.indexOf("const hasWebgpuAdapter"),
    source.indexOf("// END hasWebgpuAdapter"),
  );
  const probe = runInNewContext(`${fn} hasWebgpuAdapter`, { setTimeout, Promise }) as (
    gpu: unknown,
    ms: number,
  ) => Promise<boolean>;

  it("says yes only for a real adapter", async () => {
    assert.equal(await probe({ requestAdapter: async () => ({}) }, 50), true);
  });

  it("falls back for no gpu, a null adapter, a rejection, a sync throw and a hang", async () => {
    const throws = () => {
      throw new Error("blocked");
    };
    const cases = [
      undefined,
      { requestAdapter: async () => null },
      { requestAdapter: () => Promise.reject(new Error("no")) },
      { requestAdapter: throws },
      { requestAdapter: () => new Promise(() => {}) },
    ];
    for (const gpu of cases) assert.equal(await probe(gpu, 30), false);
  });
});

describe("snippet scope", () => {
  it("has no top-level helper outside its exports, because Mintlify only evaluates exports", () => {
    const source = readFileSync(
      join(here, "..", "docs", "snippets", "catalog-detail.jsx"),
      "utf-8",
    );
    assert.deepEqual(source.match(/^(?:function|const|let|var|class) .*/gm), null);
  });
});

describe("stageProps recorded-clip guard", () => {
  const frost = JSON.parse(
    readFileSync(
      join(here, "..", "registry", "blocks", "frost-sequence-camera-orbit", "registry-item.json"),
      "utf-8",
    ),
  );

  it("offers the recorded fallback only when the manifest has a clip", () => {
    assert.ok(stageProps("block", frost).includes("  webgpu"));
    assert.deepEqual(stageProps("block", { ...frost, preview: undefined }), []);
  });
});
