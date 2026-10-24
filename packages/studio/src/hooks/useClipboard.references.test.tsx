// @vitest-environment jsdom
import React, { act } from "react";
import postcss from "postcss";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { encodeElementClipboard, type ElementClipboard } from "@hyperframes/core/element-clipboard";
import { useClipboard } from "./useClipboard";
import { usePlayerStore } from "../player";
import { resolveDomEditSelection, type DomEditSelection } from "../components/editor/domEditing";

import { ownedElementCss, unownedElementCss } from "../utils/elementClipboardStyleBlocks";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const SOURCE =
  '<html><body><div data-composition-id="main" data-duration="10"></div></body></html>';
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mount(payload: ElementClipboard) {
  const files: Record<string, string> = { "index.html": SOURCE, "compositions/b.html": SOURCE };
  const toasts: string[] = [];
  const records: Array<{ files: Record<string, { before: string; after: string }> }> = [];
  let path = "index.html";
  const systemText = encodeElementClipboard(payload);
  vi.stubGlobal("navigator", { clipboard: { readText: async () => systemText } });
  vi.stubGlobal("fetch", async (url: string) => {
    const file = decodeURIComponent(String(url).split("/files/")[1] ?? "");
    if (!(file in files)) throw new Error(`Unexpected project file: ${file}`);
    return new Response(JSON.stringify({ content: files[file] }));
  });
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const reload = () => {
    iframe.contentDocument!.open();
    iframe.contentDocument!.write(files[path]!);
    iframe.contentDocument!.close();
  };
  let clipboard: ReturnType<typeof useClipboard> | undefined;
  const domEditSelectionRef: React.MutableRefObject<DomEditSelection | null> = { current: null };
  function Harness() {
    clipboard = useClipboard({
      projectId: "p",
      activeCompPath: path,
      domEditSelectionRef,
      showToast: (message) => {
        toasts.push(message);
      },
      writeProjectFile: async (file, content) => {
        files[file] = content;
      },
      recordEdit: async (record) => {
        records.push(record);
      },
      reloadPreview: reload,
      handleTimelineElementsDelete: async (ids) => {
        const before = files[path]!;
        const doc = parse(before);
        for (const element of ids) doc.getElementById(element.id)?.remove();
        files[path] = doc.documentElement.outerHTML;
        records.push({ files: { [path]: { before, after: files[path]! } } });
        reload();
      },
      handleDomEditElementDelete: async () => {
        throw new Error("Expected timeline deletion");
      },
      previewIframeRef: { current: iframe },
      waitForPendingDomEditSaves: async () => {},
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(<Harness />));
  reload();
  usePlayerStore.setState({
    currentTime: 0,
    elements: [],
    selectedElementId: null,
    selectedElementIds: new Set(),
  });
  const select = (id: string) => {
    const clip = parse(files[path]!).getElementById(id)!;
    const element = {
      id,
      domId: id,
      hfId: clip.getAttribute("data-hf-id")!,
      tag: "div",
      start: 0,
      duration: 5,
      track: 0,
      sourceFile: path,
    };
    usePlayerStore.setState({
      elements: [element],
      selectedElementId: id,
      selectedElementIds: new Set([id]),
    });
  };
  return {
    api: () => clipboard!,
    files,
    records,
    toasts,
    select,
    selectDom: async (id: string) => {
      usePlayerStore.setState({ selectedElementId: null, selectedElementIds: new Set() });
      domEditSelectionRef.current = await resolveDomEditSelection(
        iframe.contentDocument!.getElementById(id),
        {
          activeCompositionPath: path,
          isMasterView: true,
          exactTarget: true,
          skipSourceProbe: true,
        },
      );
      expect(domEditSelectionRef.current).not.toBeNull();
    },
    doc: () => parse(files[path]!),
    preview: () => iframe.contentDocument!,
    navigate: (next: string) => {
      path = next;
      act(() => root?.render(<Harness />));
      reload();
    },
  };
}

function mountSvg(html: string, css: string) {
  return mount({ html, css, width: 100, height: 100, warnings: [] });
}

it("retains incoming owned CSS after equal-specificity destination head rules", async () => {
  const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
  await view.api().handlePaste();
  const id = view.doc().querySelector(".clip")!.id;
  view.select(id);
  await view.api().handleCopy();
  view.files["compositions/b.html"] = SOURCE.replace(
    "<body>",
    `<head title="</head>"><!-- </head> --><script>const close="</head>"</script><style>#${id} :is(.card){color:blue}</style></head><body>`,
  );
  view.navigate("compositions/b.html");
  usePlayerStore.setState({ selectedElementId: null, selectedElementIds: new Set(), elements: [] });
  await view.api().handlePaste();
  for (const doc of [view.doc(), view.preview()]) {
    const card = doc.querySelector(".card")!;
    expect(matchingDeclarations(doc, card, "color").at(-1)).toBe("red");
    expect(doc.head.querySelector("script")?.textContent).toBe('const close="</head>"');
    expect(doc.head.getAttribute("title")).toBe("</head>");
  }
  expect(view.files["compositions/b.html"]).toContain(
    '<!-- </head> --><script>const close="</head>"</script>',
  );
});

it.each(["before", "after"])(
  "preserves authored body stylesheet order %s the composition",
  async (position) => {
    const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
    const authored = "<style>:is(#unused,.clip) .card{color:blue}</style>";
    view.files["index.html"] = SOURCE.replace(
      position === "before" ? "<body>" : "</body>",
      position === "before" ? `<body>${authored}` : `${authored}</body>`,
    );
    view.navigate("index.html");
    await view.api().handlePaste();
    const original = view.doc().querySelector(".clip")!.id;
    view.select(original);
    await view.api().handleDuplicate();
    for (const doc of [view.doc(), view.preview()]) {
      for (const card of doc.querySelectorAll(".card")) {
        expect(matchingDeclarations(doc, card, "color").at(-1)).toBe(
          position === "before" ? "red" : "blue",
        );
      }
    }
    expect(view.records.at(-1)!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it("preserves host clip sibling selectors while placing owned CSS", async () => {
  const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
  const host =
    "<style>.clip:only-child{opacity:.25}.clip + .clip{visibility:hidden}.clip:nth-child(even){background:blue}</style>";
  view.files["index.html"] = SOURCE.replace("<body>", `<body>${host}`);
  view.navigate("index.html");
  await view.api().handlePaste();
  const id = view.doc().querySelector(".clip")!.id;
  expect(view.doc().getElementById(id)!.matches(".clip:only-child")).toBe(true);
  view.select(id);
  await view.api().handleDuplicate();
  for (const doc of [view.doc(), view.preview()]) {
    const clips = Array.from(doc.querySelectorAll(".clip"));
    expect(clips.map((clip) => clip.matches(".clip:only-child"))).toEqual([false, false]);
    expect(clips.map((clip) => clip.matches(".clip + .clip"))).toEqual([false, true]);
    expect(clips.map((clip) => clip.matches(".clip:nth-child(even)"))).toEqual([false, true]);
    expect(clips[0]!.parentElement!.children).toHaveLength(2);
  }
});

it.each([
  { name: "template", suffix: "<template><style>.card{color:green}</style></template>" },
  { name: "inert type", suffix: '<style type="text/plain">.card{color:green}</style>' },
])("keeps owned CSS outside an earlier $name sheet", async ({ suffix }) => {
  const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
  view.files["index.html"] = SOURCE.replace(
    "<body>",
    `<body><style data-hf-style-probe="legacy" data-hf-style-probe-x="legacy">.unrelated{color:blue}</style>${suffix}`,
  );
  view.navigate("index.html");
  await view.api().handlePaste();
  const doc = view.doc();
  const blocks = Array.from(doc.querySelectorAll('style:not([type="text/plain"])')).flatMap(
    (style) => ownedElementCss(style.textContent ?? ""),
  );
  expect(blocks).toHaveLength(1);
  expect(blocks[0]!.css).toContain("color:red");
  expect(view.files["index.html"]).toContain(suffix);
});

it("keeps media-gated authored CSS conditional and owned CSS unconditional", async () => {
  const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
  const authored = ":is(#unused,.clip) .card{color:blue}";
  view.files["index.html"] = SOURCE.replace(
    "<body>",
    `<body><style media="not all">${authored}</style>`,
  );
  view.navigate("index.html");
  await view.api().handlePaste();
  const style = view.doc().body.querySelector("style")!;
  expect(style.hasAttribute("media")).toBe(false);
  const nodes = postcss.parse(style.textContent!).nodes;
  expect(nodes[0]).toMatchObject({ type: "atrule", name: "media", params: "not all" });
  expect(nodes[0]!.toString()).toContain(authored);
  expect(nodes[1]).toMatchObject({ type: "atrule", name: "media", params: "all" });
  expect(ownedElementCss(style.textContent!)).toHaveLength(1);
});

it.each([
  { rule: '@import "theme.css";', media: "screen" },
  { rule: '@namespace svg url("http://www.w3.org/2000/svg");', media: "screen" },
  { rule: '@namespace url("http://www.w3.org/2000/svg");', media: "" },
])(
  "rejects unsupported stylesheet contexts before saving: $rule $media",
  async ({ rule, media }) => {
    const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
    const before = SOURCE.replace(
      "<body>",
      `<body><style media="${media}">${rule}.existing{color:blue}</style>`,
    );
    view.files["index.html"] = before;
    view.navigate("index.html");
    await view.api().handlePaste();
    expect(view.files["index.html"]).toBe(before);
    expect(view.records).toHaveLength(0);
    expect(view.toasts.some((message) => message.includes("stylesheet"))).toBe(true);
  },
);

it.each(["head", "body"])(
  "handles a last preceding %s stylesheet link explicitly",
  async (location) => {
    const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
    const link = '<link rel="stylesheet" href="theme.css">';
    const before = SOURCE.replace(
      "<body>",
      location === "head" ? `<head>${link}</head><body>` : `<body>${link}`,
    );
    view.files["index.html"] = before;
    view.navigate("index.html");
    await view.api().handlePaste();
    if (location === "body") {
      expect(view.files["index.html"]).toBe(before);
      expect(view.records).toHaveLength(0);
      expect(view.toasts.some((message) => message.includes("body stylesheet link"))).toBe(true);
    } else {
      expect(view.doc().querySelector(".clip")).not.toBeNull();
      expect(view.doc().head.querySelector("link + style")?.textContent).toContain("color:red");
      expect(view.files["index.html"]).toContain(link);
    }
  },
);

it.each(['title="night"', 'TITLE="n&#105;ght"', 'title=""'])(
  "handles a selected titled stylesheet explicitly: %s",
  async (attribute) => {
    const view = mountSvg('<div class="card">Text</div>', ".card{color:red}");
    const before = SOURCE.replace(
      "<body>",
      `<head><style title="day">.unrelated{color:blue}</style><style ${attribute}>.unrelated{color:green}</style></head><body>`,
    );
    view.files["index.html"] = before;
    view.navigate("index.html");
    await view.api().handlePaste();
    if (attribute === 'title=""') {
      expect(view.doc().querySelector(".clip")).not.toBeNull();
      expect(view.records).toHaveLength(1);
    } else {
      expect(view.files["index.html"]).toBe(before);
      expect(view.records).toHaveLength(0);
      expect(view.toasts.some((message) => message.includes("titled stylesheet"))).toBe(true);
    }
  },
);

it("does not add matching ancestor context while preserving sibling styles", async () => {
  const view = mountSvg(
    '<div class="card"><span>Text</span></div>',
    "div div div div.card{display:none}.card:only-child{color:red}",
  );
  await view.api().handlePaste();
  const id = view.doc().querySelector(".clip")!.id;
  view.select(id);
  await view.api().handleDuplicate();
  await view.api().handleCopy();
  await pasteTwiceInOtherFile(view);
  for (const file of Object.values(view.files)) {
    const doc = parse(file);
    for (const card of doc.querySelectorAll(".card")) {
      expect(matchingDeclarations(doc, card, "display")).toEqual([]);
      expect(matchingDeclarations(doc, card, "color")).toContain("red");
    }
  }
  expect(
    matchingDeclarations(view.preview(), view.preview().querySelector(".card")!, "display"),
  ).toEqual([]);
});

it.each(["timeline", "dom"])(
  "keeps edited owned styles with %s copies without importing unrelated head styles",
  async (selection) => {
    const view = mountSvg(
      '<div class="card"><button type="BUTTON">Text</button></div>',
      '.card{color:red}.card:not([style]){background:red}button[type^="but"]{opacity:.25}',
    );
    await view.api().handlePaste();
    const id = view.doc().querySelector(".clip")!.id;
    expect(view.doc().head.querySelector("style")?.textContent).toContain("color:red");
    expect(view.doc().querySelector(".clip style")).toBeNull();
    view.files["index.html"] = view.files["index.html"]!.replace("color:red", "color:blue").replace(
      "</head>",
      "<style>.unrelated{opacity:.3}</style></head>",
    );
    view.navigate("index.html");
    if (selection === "dom") await view.selectDom(id);
    else view.select(id);
    await view.api().handleCopy();
    await pasteTwiceInOtherFile(view);
    for (const doc of [view.doc(), view.preview()]) {
      const clips = Array.from(doc.querySelectorAll(".clip"));
      expect(clips).toHaveLength(2);
      expect(
        Array.from(doc.querySelectorAll("style")).flatMap((style) =>
          ownedElementCss(style.textContent!),
        ),
      ).toHaveLength(2);
      expect(doc.querySelector(".clip style")).toBeNull();
      expect(doc.head.textContent).not.toContain(".unrelated");
      for (const clip of clips) {
        expect(matchingDeclarations(doc, clip.querySelector(".card")!, "color")).toContain("blue");
        expect(matchingDeclarations(doc, clip.querySelector(".card")!, "background")).toContain(
          "red",
        );
        expect(matchingDeclarations(doc, clip.querySelector("button")!, "opacity")).toContain(
          ".25",
        );
      }
    }
    expect(view.records.at(-1)!.files["compositions/b.html"]!.after).toBe(
      view.files["compositions/b.html"],
    );
  },
);

function clipCss(clip: Element): string {
  return Array.from(clip.ownerDocument.querySelectorAll("style"))
    .flatMap((style) =>
      clip.contains(style)
        ? [style.textContent ?? ""]
        : ownedElementCss(style.textContent ?? "")
            .filter((block) => block.owner === clip.id)
            .map((block) => block.css),
    )
    .join("\n");
}

function embeddedSelectors(clip: Element): string[] {
  const selectors: string[] = [];
  postcss.parse(clipCss(clip)).walkRules((rule) => {
    selectors.push(rule.selector);
  });
  return selectors;
}

async function pasteTwiceInOtherFile(view: ReturnType<typeof mount>) {
  view.navigate("compositions/b.html");
  usePlayerStore.setState({ elements: [], selectedElementId: null, selectedElementIds: new Set() });
  await view.api().handlePaste();
  await view.api().handlePaste();
}

it.each([".title{color:red}", "@media all{@supports (display:block){.title{color:red}}}"])(
  "rebinds only embedded styles when repeatedly pasting an imported clip into another file: %s",
  async (css) => {
    const view = mount({
      html: '<div class="title">Title</div>',
      css,
      width: 100,
      height: 50,
      warnings: [],
    });
    await view.api().handlePaste();
    const original = view.doc().querySelector(".clip")!;
    view.select(original.id);
    await view.api().handleCopy();
    view.files["compositions/b.html"] = SOURCE.replace(
      "<body>",
      `<head><style>#${original.id}{background:blue}</style></head><body>`,
    );
    await pasteTwiceInOtherFile(view);
    const doc = view.doc();
    const clips = Array.from(doc.querySelectorAll(".clip"));
    expect(clips).toHaveLength(2);
    expect(clips.map((clip) => clip.id)).toContain(`${original.id}-2`);
    for (const clip of clips) {
      const selectors = embeddedSelectors(clip);
      expect(selectors.some((selector) => clip.querySelector(".title")!.matches(selector))).toBe(
        true,
      );
      expect(
        selectors.some((selector) =>
          clips
            .find((other) => other !== clip)!
            .querySelector(".title")!
            .matches(selector),
        ),
      ).toBe(false);
    }
    expect(
      Array.from(doc.head.querySelectorAll("style"), (style) =>
        unownedElementCss(style.textContent ?? ""),
      ),
    ).toEqual([`#${original.id}{background:blue}`]);
    expect(view.records).toHaveLength(3);
    expect(view.records[2]!.files["compositions/b.html"]!.after).toBe(
      view.files["compositions/b.html"],
    );
    expect(view.preview().querySelectorAll(".clip")).toHaveLength(2);
  },
);

it("keeps duplicated SVG definitions and all accepted local fragment consumers after cutting the original", async () => {
  const view = mount({
    html: '<svg viewBox="0 0 100 100"><defs><symbol id="shape"><rect width="100" height="100" fill="red"/></symbol><linearGradient id="paint"><stop stop-color="red"/></linearGradient><clipPath id="cut"><rect width="100" height="100"/></clipPath><mask id="mask"><rect width="100" height="100" fill="white"/></mask><filter id="fx"><feGaussianBlur stdDeviation="0"/></filter><marker id="mark"><path d="M0 0L1 1"/></marker></defs><use href="#shape"/><use xlink:href="#shape"/><rect class="painted" fill="url(#paint)" stroke="url(#paint)" clip-path="url(#cut)" mask="url(#mask)" filter="url(#fx)" marker-start="url(#mark)" marker-mid="url(#mark)" marker-end="url(#mark)" style="fill:url(#paint);filter:url(#fx)"/></svg>',
    css: ".painted{fill:url(#paint);clip-path:url(#cut)}",
    width: 100,
    height: 100,
    warnings: [],
  });
  await view.api().handlePaste();
  const original = view.doc().querySelector(".clip")!;
  view.select(original.id);
  expect(await view.api().handleDuplicate()).toBe(true);
  const duplicateId = `${original.id}-2`;
  const duplicatedFile = view.files["index.html"]!;
  view.select(original.id);
  await view.api().handleCut();
  const doc = view.doc();
  const duplicate = doc.getElementById(duplicateId)!;
  expect(doc.querySelectorAll(".clip")).toHaveLength(1);
  expect(doc.getElementById(original.id)).toBeNull();
  const refs: string[] = [];
  for (const el of duplicate.querySelectorAll("*"))
    for (const attr of el.attributes) {
      if (attr.name.endsWith("href") && attr.value.startsWith("#")) refs.push(attr.value.slice(1));
      for (const match of attr.value.matchAll(/url\(["']?#([^"')]+)["']?\)/g)) refs.push(match[1]!);
    }
  postcss.parse(clipCss(duplicate)).walkDecls((decl) => {
    for (const match of decl.value.matchAll(/url\(["']?#([^"')]+)["']?\)/g)) refs.push(match[1]!);
  });
  expect(refs.length).toBeGreaterThanOrEqual(14);
  for (const ref of refs) {
    expect(duplicate.querySelector(`[id="${ref}"]`), ref).not.toBeNull();
    expect(view.preview().getElementById(ref), ref).not.toBeNull();
  }
  expect(view.records[1]!.files["index.html"]!.after).toBe(duplicatedFile);
  expect(view.records[2]!.files["index.html"]!.before).toBe(duplicatedFile);
});

it("rebinds fragment predicates on cross-file clones while preserving unrelated title predicates", async () => {
  const view = mount({ html: "<div>unused</div>", css: "", width: 100, height: 50, warnings: [] });
  view.files["index.html"] = SOURCE.replace(
    "</div></body>",
    '<div id="authored" class="clip" data-start="0" data-duration="5" data-track-index="0"><style>use[href="#shape"]{opacity:.25}[title="#shape"]{color:red}</style><svg><symbol id="shape"><rect width="100" height="100"/></symbol><use href="#shape"/></svg><span title="#shape">Literal</span></div></div></body>',
  );
  view.navigate("index.html");
  view.select("authored");
  await view.api().handleCopy();
  await pasteTwiceInOtherFile(view);
  for (const clip of view.doc().querySelectorAll(".clip")) {
    const selectors = embeddedSelectors(clip);
    expect(selectors.some((selector) => clip.querySelector("use")!.matches(selector))).toBe(true);
    expect(selectors).toContain('[title="#shape"]');
    expect(clip.querySelector("span")!.getAttribute("title")).toBe("#shape");
  }
  expect(view.records[1]!.files["compositions/b.html"]!.after).toBe(
    view.files["compositions/b.html"],
  );
});

it("preserves the clone's own SVG gradient while the original still exists after same-file Copy/Paste", async () => {
  const view = mountSvg(
    '<svg><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><rect class="painted" width="100" height="100"/></svg>',
    ".painted{fill:url(#paint)}",
  );
  await view.api().handlePaste();
  const originalId = view.doc().querySelector(".clip")!.id;
  view.select(originalId);
  await view.api().handleCopy();
  await view.api().handlePaste();
  const doc = view.doc();
  const clone = doc.getElementById(`${originalId}-2`)!;
  expect(doc.querySelector(".clip")).toBe(clone);
  const fills: string[] = [];
  for (const style of doc.querySelectorAll("style"))
    postcss.parse(style.textContent!).walkRules((rule) => {
      if (clone.querySelector(".painted")!.matches(rule.selector))
        rule.walkDecls("fill", (decl) => {
          fills.push(decl.value);
        });
    });
  const gradient = clone.querySelector("linearGradient")!;
  expect(fills.at(-1)?.replace(/["']/g, "")).toBe(`url(#${gradient.id})`);
  gradient.querySelector("stop")!.setAttribute("stop-color", "blue");
  view.files["index.html"] = doc.documentElement.outerHTML;
  view.navigate("index.html");
  expect(
    view.preview().getElementById(gradient.id)!.querySelector("stop")!.getAttribute("stop-color"),
  ).toBe("blue");
  expect(
    view.preview().getElementById(originalId)!.querySelector("stop")!.getAttribute("stop-color"),
  ).toBe("red");
  expect(view.records[1]!.files["index.html"]!.after).toContain(`#${gradient.id}`);
});

it.each(["#title", '[id="title"]'])("preserves initial imported selector %s", async (selector) => {
  const view = mount({
    html: '<div><span id="title">Heading</span></div>',
    css: `${selector}{color:red}`,
    width: 100,
    height: 50,
    warnings: [],
  });
  await view.api().handlePaste();
  const clip = view.doc().querySelector(".clip")!;
  const selectors = embeddedSelectors(clip);
  expect(selectors.some((rule) => clip.querySelector("span")!.matches(rule))).toBe(true);
  expect(view.preview().querySelector(".clip span")!.id).toBe(clip.querySelector("span")!.id);
  expect(view.records[0]!.files["index.html"]!.after).toBe(view.files["index.html"]);
});

it("preserves fragment-attribute predicates on the initial accepted SVG import", async () => {
  const view = mount({
    html: '<svg><symbol id="shape"><rect width="100" height="100"/></symbol><use href="#shape"/></svg>',
    css: 'use[href="#shape"]{opacity:.25}',
    width: 100,
    height: 100,
    warnings: [],
  });
  await view.api().handlePaste();
  const clip = view.doc().querySelector(".clip")!;
  const selectors = embeddedSelectors(clip);
  expect(selectors.some((selector) => clip.querySelector("use")!.matches(selector))).toBe(true);
});

it.each([
  {
    name: "ordinary href control",
    html: '<svg><defs><path id="shape" d="M0 0h100v100H0z"/></defs><use href="#shape"/></svg>',
    css: 'use[*|href="#shape"]{opacity:.25}',
    target: "use",
  },
  {
    name: "normalized xlink href",
    html: '<svg><defs><path id="shape" d="M0 0h100v100H0z"/></defs><use xlink:href="#shape"/></svg>',
    css: 'use[*|href="#shape"]{opacity:.25}',
    target: "use",
  },
  {
    name: "literal fill URL control",
    html: '<svg><defs><linearGradient id="paint"/></defs><rect fill="url(#paint)"/></svg>',
    css: 'rect[fill$="paint)"]{opacity:.25}',
    target: "rect",
  },
  {
    name: "escaped fill URL",
    html: String.raw`<svg><defs><linearGradient id="paint"/></defs><rect fill="url(\23 paint)"/></svg>`,
    css: 'rect[fill$="paint)"]{opacity:.25}',
    target: "rect",
  },
])("preserves actual accepted resource transformation: $name", async ({ html, css, target }) => {
  const view = mount({ html, css, width: 100, height: 100, warnings: [] });
  await view.api().handlePaste();
  const clip = view.doc().querySelector(".clip")!;
  expect(
    embeddedSelectors(clip).some((selector) => clip.querySelector(target)!.matches(selector)),
  ).toBe(true);
  expect(view.records[0]!.files["index.html"]!.after).toBe(view.files["index.html"]);
});

function matchingDeclarations(doc: Document, target: Element, property: string): string[] {
  const values: string[] = [];
  for (const style of doc.querySelectorAll("style"))
    postcss.parse(style.textContent!).walkRules((rule) => {
      if (target.matches(rule.selector))
        rule.walkDecls(property, (decl) => {
          values.push(decl.value);
        });
    });
  return values;
}

async function cloneSelected(view: ReturnType<typeof mount>, action: "duplicate" | "paste") {
  if (action === "duplicate") expect(await view.api().handleDuplicate()).toBe(true);
  else {
    await view.api().handleCopy();
    await view.api().handlePaste();
  }
}

it.each(["duplicate", "paste"] as const)(
  "keeps false imported ID predicates false through same-file %s",
  async (action) => {
    const view = mount({
      html: '<div id="source">Text</div>',
      css: '[id$="-2"]{background-color:red}',
      width: 100,
      height: 50,
      warnings: [],
    });
    await view.api().handlePaste();
    const originalId = view.doc().querySelector(".clip")!.id;
    view.select(originalId);
    await cloneSelected(view, action);
    const doc = view.doc();
    const original = doc.getElementById(originalId)!.querySelector("div")!;
    const clone = doc.getElementById(`${originalId}-2`)!.querySelector("div")!;
    expect(matchingDeclarations(doc, original, "background-color")).toEqual([]);
    expect(matchingDeclarations(doc, clone, "background-color")).toEqual([]);
    expect(view.preview().getElementById(clone.id)).not.toBeNull();
    expect(view.records[1]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it.each([
  {
    selector: ".card:first-child",
    html: '<div class="card"><span>Text</span></div>',
    matches: [true],
  },
  {
    selector: ".card:last-child",
    html: '<div class="card"><span>Text</span></div>',
    matches: [true],
  },
  {
    selector: ".card:only-child",
    html: '<div class="card"><span>Text</span></div>',
    matches: [true],
  },
  {
    selector: ".card:nth-child(1)",
    html: '<div class="card"><span>Text</span></div>',
    matches: [true],
  },
  {
    selector: ".card:nth-last-child(1)",
    html: '<div class="card"><span>Text</span></div>',
    matches: [true],
  },
  {
    selector: ".card:not(:first-child)",
    html: '<div class="card"><span>Text</span></div>',
    matches: [false],
  },
  {
    selector: ".card:not(:last-child)",
    html: '<div class="card"><span>Text</span></div>',
    matches: [false],
  },
  {
    selector: ".card:not(:only-child)",
    html: '<div class="card"><span>Text</span></div>',
    matches: [false],
  },
  {
    selector: ".card:first-child",
    html: '<div class="card"><span>First</span></div><p class="card"><span>Last</span></p>',
    matches: [true, false],
  },
  {
    selector: ".card:last-child",
    html: '<div class="card"><span>First</span></div><p class="card"><span>Last</span></p>',
    matches: [false, true],
  },
  {
    selector: ".card:only-child",
    html: '<div class="card"><span>First</span></div><p class="card"><span>Last</span></p>',
    matches: [false, false],
  },
  {
    selector: ".card:nth-child(2)",
    html: '<div class="card"><span>First</span></div><p class="card"><span>Last</span></p>',
    matches: [false, true],
  },
])(
  "preserves captured sibling structure for $selector in $html",
  async ({ selector, html, matches }) => {
    const view = mountSvg(
      html,
      `${selector}{color:red}span:first-child{opacity:.25}*{box-sizing:border-box}div{border-width:3px}`,
    );
    const check = () => {
      for (const doc of [view.doc(), view.preview()]) {
        for (const clip of doc.querySelectorAll(".clip")) {
          const cards = Array.from(clip.querySelectorAll(".card"));
          expect(
            cards.map((card) => matchingDeclarations(doc, card, "color").includes("red")),
          ).toEqual(matches);
          for (const card of cards) {
            expect(matchingDeclarations(doc, card, "box-sizing")).toContain("border-box");
            if (card.localName === "div")
              expect(matchingDeclarations(doc, card, "border-width")).toContain("3px");
            expect(matchingDeclarations(doc, card.querySelector("span")!, "opacity")).toContain(
              ".25",
            );
            for (
              let parent = card.parentElement;
              parent && parent !== clip;
              parent = parent.parentElement
            ) {
              expect(matchingDeclarations(doc, parent, "box-sizing")).toEqual([]);
              expect(matchingDeclarations(doc, parent, "border-width")).toEqual([]);
            }
          }
        }
      }
      const record = view.records.at(-1)!;
      const path = Object.keys(record.files)[0]!;
      expect(record.files[path]!.after).toBe(view.files[path]);
    };
    await view.api().handlePaste();
    check();
    const id = view.doc().querySelector(".clip")!.id;
    view.select(id);
    await view.api().handleDuplicate();
    check();
    view.select(id);
    await view.api().handleCopy();
    await pasteTwiceInOtherFile(view);
    check();
  },
);

it.each(["duplicate", "paste"] as const)(
  "keeps false authored fragment predicates false through same-file %s",
  async (action) => {
    const view = mount({
      html: "<div>unused</div>",
      css: "",
      width: 100,
      height: 50,
      warnings: [],
    });
    view.files["index.html"] = SOURCE.replace(
      "</div></body>",
      '<div id="authored" class="clip" data-start="0" data-duration="5" data-track-index="0"><style>#authored use[href$="-2"]{opacity:0}</style><svg><symbol id="shape"><rect width="100" height="100"/></symbol><use href="#shape"/></svg></div></div></body>',
    );
    view.navigate("index.html");
    view.select("authored");
    await cloneSelected(view, action);
    const doc = view.doc();
    const use = doc.getElementById("authored-2")!.querySelector("use")!;
    expect(use.getAttribute("href")).toBe("#shape-2");
    expect(matchingDeclarations(doc, use, "opacity")).toEqual([]);
    expect(view.records[0]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it("keeps normalized mixed fragment predicates selective through reload and duplicate", async () => {
  const view = mount({
    html: '<svg><defs><path id="shape" d="M0 0L1 1"/></defs><use xlink:href="#shape"/><use href="#shape"/></svg>',
    css: 'use[*|href="#shape"]{opacity:.25}use[|href]{visibility:hidden}use[href="#shape"]{fill:red}',
    width: 100,
    height: 100,
    warnings: [],
  });
  await view.api().handlePaste();
  const id = view.doc().querySelector(".clip")!.id;
  view.select(id);
  await view.api().handleDuplicate();
  for (const doc of [view.doc(), view.preview()]) {
    for (const clip of doc.querySelectorAll(".clip")) {
      const [xlink, ordinary] = Array.from(clip.querySelectorAll("use"));
      expect(matchingDeclarations(doc, xlink!, "opacity")).toContain(".25");
      expect(matchingDeclarations(doc, ordinary!, "opacity")).toContain(".25");
      expect(matchingDeclarations(doc, xlink!, "visibility")).not.toContain("hidden");
      expect(matchingDeclarations(doc, ordinary!, "visibility")).toContain("hidden");
      expect(matchingDeclarations(doc, xlink!, "fill")).not.toContain("red");
      expect(matchingDeclarations(doc, ordinary!, "fill")).toContain("red");
    }
  }
  const css = view.doc().querySelector("style")!.textContent!;
  expect(css).toContain('[href="#shape"]');
  expect(css).toContain(":where(#");
});

it.each(["shape", "element-1-fixed-node-2"])(
  "preserves aggregate dual-attribute predicates, including unchanged accepted href: %s",
  async (shape) => {
    vi.stubGlobal("crypto", { randomUUID: () => "fixed" });
    const view = mountSvg(
      `<svg><defs><path id="${shape}" d="M0 0L1 1"/></defs><use role="img" href="#${shape}" xlink:href="#${shape}"/></svg>`,
      `use[|href]{opacity:.25}use[|href="#${shape}"]{color:red}use[*|href="#${shape}"]{stroke:green}use[role="img"]{fill:blue}`,
    );
    await view.api().handlePaste();
    const originalId = view.doc().querySelector(".clip")!.id;
    view.select(originalId);
    await view.api().handleDuplicate();
    for (const doc of [view.doc(), view.preview()]) {
      for (const clip of doc.querySelectorAll(".clip")) {
        const use = clip.querySelector("use")!;
        expect(matchingDeclarations(doc, use, "opacity")).toContain(".25");
        expect(matchingDeclarations(doc, use, "color")).toContain("red");
        expect(matchingDeclarations(doc, use, "stroke")).toContain("green");
        expect(matchingDeclarations(doc, use, "fill")).toContain("blue");
      }
    }
    expect(view.records[1]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it.each(["duplicate", "paste"] as const)(
  "preserves authored dual-attribute aggregate truth through same-file %s",
  async (action) => {
    const view = mount({
      html: "<div>unused</div>",
      css: "",
      width: 100,
      height: 100,
      warnings: [],
    });
    view.files["index.html"] = SOURCE.replace(
      "</div></body>",
      '<div id="authored" class="clip" data-start="0" data-duration="5" data-track-index="0"><style>#authored use[*|href$="-2"]{opacity:.25}</style><svg><defs><path id="other-2" d="M0 0L1 1"/><path id="shape" d="M0 0L1 1"/></defs><use role="img" href="#other-2" xlink:href="#shape"/></svg></div></div></body>',
    );
    view.navigate("index.html");
    view.select("authored");
    await cloneSelected(view, action);
    for (const doc of [view.doc(), view.preview()]) {
      const use = doc.getElementById("authored-2")!.querySelector("use")!;
      expect(use.getAttribute("href")).toBe("#other-2-2");
      expect(use.getAttribute("xlink:href")).toBe("#shape-2");
      expect(matchingDeclarations(doc, use, "opacity")).toContain(".25");
      expect(
        matchingDeclarations(doc, doc.getElementById("authored")!.querySelector("use")!, "opacity"),
      ).toContain(".25");
    }
    expect(view.records[0]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it.each([
  { label: "absent", attribute: "", present: false, empty: false },
  { label: "empty", attribute: ' style=""', present: true, empty: true },
  { label: "authored", attribute: ' style="color:black"', present: true, empty: false },
])(
  "preserves $label root style predicates through geometry, clone and reload",
  async ({ attribute, present, empty }) => {
    const view = mount({
      html: `<div class="captured-root"${attribute}><span>Text</span><i style="color:blue">Styled</i></div>`,
      css: '[style]{display:none}div:not([style]){background:red;color:white}[style=""]{opacity:.25}div:not([style=""]){border-width:2px}span:not([style]){color:green}i[style]{color:blue}',
      width: 100,
      height: 50,
      warnings: [],
    });
    await view.api().handlePaste();
    const id = view.doc().querySelector(".clip")!.id;
    view.select(id);
    await view.api().handleDuplicate();
    for (const doc of [view.doc(), view.preview()]) {
      for (const clip of doc.querySelectorAll(".clip")) {
        const captured = clip.querySelector(".captured-root")!;
        expect(captured.hasAttribute("style")).toBe(true);
        expect(matchingDeclarations(doc, captured, "display").includes("none")).toBe(present);
        expect(matchingDeclarations(doc, captured, "background").includes("red")).toBe(!present);
        expect(matchingDeclarations(doc, captured, "opacity").includes(".25")).toBe(empty);
        expect(matchingDeclarations(doc, captured, "border-width").includes("2px")).toBe(!empty);
        expect(matchingDeclarations(doc, clip.querySelector("span")!, "display")).toEqual([]);
        expect(matchingDeclarations(doc, clip.querySelector("span")!, "color")).toContain("green");
        expect(matchingDeclarations(doc, clip.querySelector("i")!, "display")).toContain("none");
        expect(matchingDeclarations(doc, clip.querySelector("i")!, "color")).toContain("blue");
      }
    }
    expect(view.records[1]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it.each(["", ' type="button"'])(
  "preserves synthesized button type absence: %s",
  async (attribute) => {
    const view = mountSvg(
      `<button${attribute}>Text</button>`,
      "[type]{opacity:.25}button:not([type]){color:red}",
    );
    await view.api().handlePaste();
    for (const doc of [view.doc(), view.preview()]) {
      const button = doc.querySelector("button")!;
      expect(button.getAttribute("type")).toBe("button");
      expect(matchingDeclarations(doc, button, "opacity").includes(".25")).toBe(!!attribute);
      expect(matchingDeclarations(doc, button, "color").includes("red")).toBe(!attribute);
    }
    expect(view.records[0]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);

it.each([
  ...Object.entries({
    "=": "button",
    "^=": "but",
    "$=": "ton",
    "*=": "utt",
    "~=": "button",
    "|=": "button",
  }).map(([operator, value]) => ({ operator, value, type: "BUTTON", flag: "" })),
  { operator: "^=", value: "but", type: "button", flag: "" },
  { operator: "^=", value: "but", type: "BUTTON", flag: " i" },
])(
  "preserves HTML type default matching: $type $operator $value$flag",
  async ({ operator, value, type, flag }) => {
    const view = mount({
      html: `<div><button type="${type}">Text</button></div>`,
      css: `button[type${operator}"${value}"${flag}]{color:red}`,
      width: 100,
      height: 50,
      warnings: [],
    });
    await view.api().handlePaste();
    const id = view.doc().querySelector(".clip")!.id;
    view.select(id);
    await view.api().handleDuplicate();
    for (const doc of [view.doc(), view.preview()]) {
      for (const clip of doc.querySelectorAll(".clip")) {
        const button = clip.querySelector("button")!;
        expect(button.getAttribute("type")).toBe("button");
        expect(matchingDeclarations(doc, button, "color")).toContain("red");
      }
    }
    expect(view.records[1]!.files["index.html"]!.after).toBe(view.files["index.html"]);
  },
);
