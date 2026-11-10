/**
 * `packages/core/schemas/timeline-import.json` is the published definition of the file `hyperframes
 * init --timeline` reads; `parseTimelineImport` is the code that actually reads it. Two descriptions of
 * one format drift, so this pins them together:
 *
 * - a fixture typed `Required<...>` for every field the parser knows, so a field added to the code
 *   is a compile error here until it is listed, then a validation failure until the schema declares it;
 * - a table of valid and invalid files, each judged by BOTH, which must agree;
 * - the rules a JSON Schema cannot state, pinned as the places where they differ on purpose;
 * - every full example in the docs;
 * - the docs mirror, which `sync-schemas` also checks in CI.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  parseTimelineImport,
  TIMELINE_IMPORT_SCHEMA,
  TIMELINE_IMPORT_SCHEMA_URL,
  type ImportClip,
  type ImportSequence,
  type ImportTimeline,
  type ImportTransition,
} from "@hyperframes/core/timeline-import";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCHEMA_PATH = resolve(REPO_ROOT, "packages/core/schemas/timeline-import.json");
const DOCS_COPY = resolve(REPO_ROOT, "docs/schema/timeline-import.json");
const DOCS_PAGE = resolve(REPO_ROOT, "docs/reference/timeline-import.mdx");

const schema: Record<string, unknown> = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);

const EVERY_SEQUENCE_FIELD: Required<ImportSequence> = {
  rate: 24,
  images: [
    "file:///show/shot/img.0001.exr",
    "file:///show/shot/img.0001.exr",
    "file:///show/shot/img.0003.exr",
  ],
};

const EVERY_CLIP_FIELD: Required<ImportClip> = {
  id: "c1-intro",
  label: "intro",
  kind: "video",
  start: 0,
  duration: 2,
  end: 2,
  trackIndex: 1,
  src: "file:///show/shot/img.0001.exr",
  mediaStart: 1.5,
  mediaOrigin: 0,
  volume: 0.5,
  playbackRate: 2,
  hasAudio: false,
  freeze: false,
  sequence: EVERY_SEQUENCE_FIELD,
};

const EVERY_TRANSITION_FIELD: Required<ImportTransition> = {
  from: "c1-intro",
  to: "c2-demo",
  duration: 1,
  inOffset: 0.5,
  outOffset: 0.5,
  kind: "dissolve",
};

/** What a converter writes: every top-level field the parser knows. */
const EVERY_TIMELINE_FIELD: Required<ImportTimeline> & { $schema: string } = {
  $schema: "https://hyperframes.heygen.com/schema/timeline-import.json",
  schema: TIMELINE_IMPORT_SCHEMA,
  fps: { num: 30000, den: 1001 },
  width: 1920,
  height: 1080,
  duration: 6,
  mediaRoot: "/unpacked",
  clips: [EVERY_CLIP_FIELD, { ...EVERY_CLIP_FIELD, id: "c2-demo", start: 2, sequence: null }],
  transitions: [EVERY_TRANSITION_FIELD],
  warnings: ["clip off is disabled (skipped)"],
};

const minimal = {
  schema: TIMELINE_IMPORT_SCHEMA,
  fps: { num: 30, den: 1 },
  clips: [{ id: "a", kind: "video", start: 0, duration: 2, src: "a.mp4" }],
};
const withClip = (extra: Record<string, unknown>) => ({
  ...minimal,
  clips: [{ ...minimal.clips[0], ...extra }],
});
const withTransition = (t: Record<string, unknown>) => ({
  ...minimal,
  clips: [...minimal.clips, { id: "b", kind: "video", start: 2, duration: 2, src: "b.mp4" }],
  transitions: [t],
});

const bySchema = (value: unknown) => validate(value);
const byParser = (value: unknown) => parseTimelineImport(value).ok;

describe("timeline-import schema", () => {
  it("is published at the one URL the code, the docs and the schema itself all name", () => {
    expect(schema.$id).toBe(TIMELINE_IMPORT_SCHEMA_URL);
    expect(EVERY_TIMELINE_FIELD.$schema).toBe(TIMELINE_IMPORT_SCHEMA_URL);
    const page = readFileSync(DOCS_PAGE, "utf-8");
    expect(page).toContain(TIMELINE_IMPORT_SCHEMA_URL);
    for (const file of [
      "docs/packages/cli.mdx",
      "skills/import-timeline/SKILL.md",
      "skills/import-timeline/scripts/otio_flatten.py",
    ]) {
      const text = readFileSync(resolve(REPO_ROOT, file), "utf-8");
      expect(text, file).toMatch(/timeline-import(\.json|#schema|\.mdx)/);
    }
    expect(
      readFileSync(resolve(REPO_ROOT, "skills/import-timeline/scripts/otio_flatten.py"), "utf-8"),
    ).toContain(TIMELINE_IMPORT_SCHEMA_URL);
  });

  it("is a valid draft 2020-12 schema with the id the docs serve it at", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe("https://hyperframes.heygen.com/schema/timeline-import.json");
    expect(schema.type).toBe("object");
  });

  it("accepts a file using every field the parser knows, in the schema and in the parser", () => {
    expect(validate(EVERY_TIMELINE_FIELD), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parseTimelineImport(EVERY_TIMELINE_FIELD);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.clips[0]).toMatchObject(EVERY_CLIP_FIELD);
      expect(parsed.value.transitions[0]).toMatchObject(EVERY_TRANSITION_FIELD);
    }
  });

  it("declares every field the parser knows, at every level", () => {
    const declared = (node: Record<string, unknown>) =>
      Object.keys((node.properties ?? {}) as object).sort();
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    expect(declared(schema)).toEqual(Object.keys(EVERY_TIMELINE_FIELD).sort());
    expect(declared(defs.clip!)).toEqual(Object.keys(EVERY_CLIP_FIELD).sort());
    expect(declared(defs.sequence!)).toEqual(Object.keys(EVERY_SEQUENCE_FIELD).sort());
    expect(declared(defs.transition!)).toEqual(Object.keys(EVERY_TRANSITION_FIELD).sort());
  });

  it("has the same text published in docs, where Mintlify serves it", () => {
    expect(readFileSync(DOCS_COPY, "utf-8")).toBe(readFileSync(SCHEMA_PATH, "utf-8"));
  });

  // Proves the checks above can fail, rather than passing because ajv was handed something it
  // never rejects.
  it("rejects a file that is plainly wrong", () => {
    expect(validate({})).toBe(false);
    expect(validate({ ...minimal, clips: [] })).toBe(false);
    expect(validate({ ...minimal, schema: "hyperframes-timeline/2" })).toBe(false);
  });
});

describe("the schema and the parser agree", () => {
  const valid: Array<[string, unknown]> = [
    ["the smallest file", minimal],
    ["a canvas size", { ...minimal, width: 1280, height: 720 }],
    ["a null canvas size", { ...minimal, width: null, height: null }],
    [
      "a $schema pointer",
      { ...minimal, $schema: "https://hyperframes.heygen.com/schema/timeline-import.json" },
    ],
    ["a key neither declares", { ...minimal, producedBy: "my-converter" }],
    ["null volume and speed", withClip({ volume: null, playbackRate: null })],
    ["a null label", withClip({ label: null })],
    ["an image clip", withClip({ kind: "image" })],
    ["a null sequence", withClip({ sequence: null })],
    ["a sequence on a video clip", withClip({ sequence: EVERY_SEQUENCE_FIELD })],
    [
      "a dissolve with offsets",
      withTransition({ from: "a", to: "b", inOffset: 0.5, outOffset: 0.5 }),
    ],
    ["a dissolve with only a duration", withTransition({ from: "a", to: "b", duration: 1 })],
    ["a fade from nothing", withTransition({ from: null, to: "b", inOffset: 0, outOffset: 1 })],
    ["a fade to nothing", withTransition({ from: "a", to: null, inOffset: 1, outOffset: 0 })],
    ["a transition with one side left out", withTransition({ to: "b", outOffset: 1 })],
    ["a wipe", withTransition({ from: "a", to: "b", duration: 1, kind: "wipe" })],
    ["a null transitions-free file", { ...minimal, transitions: [] }],
  ];

  const invalid: Array<[string, unknown]> = [
    ["no schema key", { fps: minimal.fps, clips: minimal.clips }],
    ["another schema version", { ...minimal, schema: "hyperframes-timeline/2" }],
    ["no fps", { schema: minimal.schema, clips: minimal.clips }],
    ["a zero frame rate numerator", { ...minimal, fps: { num: 0, den: 1 } }],
    ["a zero frame rate denominator", { ...minimal, fps: { num: 30, den: 0 } }],
    ["an fps that is not an object", { ...minimal, fps: 30 }],
    ["no clips", { ...minimal, clips: [] }],
    ["clips that are not an array", { ...minimal, clips: "a.mp4" }],
    ["a zero canvas width", { ...minimal, width: 0 }],
    ["a negative canvas height", { ...minimal, height: -5 }],
    ["a string canvas width", { ...minimal, width: "1920" }],
    ["a zero duration", { ...minimal, duration: 0 }],
    ["a null duration", { ...minimal, duration: null }],
    ["a numeric media root", { ...minimal, mediaRoot: 5 }],
    ["warnings that are not strings", { ...minimal, warnings: [1] }],
    ["null warnings", { ...minimal, warnings: null }],
    ["null transitions", { ...minimal, transitions: null }],
    ["a clip with no id", withClip({ id: undefined })],
    ["a clip with an empty id", withClip({ id: "" })],
    ["a clip with no src", withClip({ src: undefined })],
    ["a clip with an empty src", withClip({ src: "" })],
    ["an unknown kind", withClip({ kind: "text" })],
    ["a negative start", withClip({ start: -1 })],
    ["a zero duration clip", withClip({ duration: 0 })],
    ["a fractional lane", withClip({ trackIndex: 1.5 })],
    ["a negative lane", withClip({ trackIndex: -1 })],
    ["a negative in-point", withClip({ mediaStart: -1 })],
    ["a negative volume", withClip({ volume: -1 })],
    ["a zero speed", withClip({ playbackRate: 0 })],
    ["a string label", withClip({ label: 7 })],
    ["hasAudio as a string", withClip({ hasAudio: "true" })],
    ["freeze as a number", withClip({ freeze: 1 })],
    ["a sequence on an audio clip", withClip({ kind: "audio", sequence: EVERY_SEQUENCE_FIELD })],
    ["a sequence on an image clip", withClip({ kind: "image", sequence: EVERY_SEQUENCE_FIELD })],
    ["a sequence that is not an object", withClip({ sequence: "img.0001.png" })],
    ["a sequence with no images", withClip({ sequence: { ...EVERY_SEQUENCE_FIELD, images: [] } })],
    [
      "a sequence image that is not a string",
      withClip({ sequence: { ...EVERY_SEQUENCE_FIELD, images: ["a.png", 3] } }),
    ],
    [
      "a sequence image that is empty",
      withClip({ sequence: { ...EVERY_SEQUENCE_FIELD, images: ["a.png", ""] } }),
    ],
    [
      "a sequence image list that is not a list",
      withClip({ sequence: { ...EVERY_SEQUENCE_FIELD, images: "a.png" } }),
    ],
    ["a zero sequence rate", withClip({ sequence: { ...EVERY_SEQUENCE_FIELD, rate: 0 } })],
    ["a sequence with no rate", withClip({ sequence: { images: ["a.png"] } })],
    [
      "a transition with a clip on neither side",
      withTransition({ from: null, to: null, duration: 1 }),
    ],
    ["a transition with no sides", withTransition({ duration: 1 })],
    ["a transition with no length", withTransition({ from: "a", to: "b" })],
    ["a negative offset", withTransition({ from: "a", to: "b", inOffset: -1, outOffset: 1 })],
    ["a negative duration", withTransition({ from: "a", to: "b", duration: -1 })],
    [
      "a negative duration beside offsets",
      withTransition({ from: "a", to: "b", duration: -1, outOffset: 1 }),
    ],
    [
      "a transition kind that is not a string",
      withTransition({ from: "a", to: "b", duration: 1, kind: 3 }),
    ],
    ["a transition that is not an object", { ...minimal, transitions: ["a-b"] }],
  ];

  it.each(valid)("both accept %s", (_name, value) => {
    expect(bySchema(value), JSON.stringify(validate.errors)).toBe(true);
    expect(byParser(value)).toBe(true);
  });

  it.each(invalid)("both reject %s", (_name, value) => {
    expect(bySchema(value)).toBe(false);
    expect(byParser(value)).toBe(false);
  });

  // The rules a JSON Schema cannot state. They are where the two differ on purpose, so a change to
  // either is a decision, not an accident. The schema's own description lists them.
  describe("rules only the parser enforces", () => {
    it("repeated clip ids", () => {
      const twice = { ...minimal, clips: [minimal.clips[0], minimal.clips[0]] };
      expect(bySchema(twice)).toBe(true);
      expect(byParser(twice)).toBe(false);
    });

    it("a frame rate outside 1 to 240", () => {
      for (const fps of [
        { num: 1000, den: 1 },
        { num: 1, den: 100 },
      ]) {
        expect(bySchema({ ...minimal, fps })).toBe(true);
        expect(byParser({ ...minimal, fps })).toBe(false);
      }
    });

    it("says so in the schema's description", () => {
      const text = String(schema.description);
      expect(text).toContain("unique");
      expect(text).toContain("1 to 240");
    });
  });
});

describe("the examples in the docs", () => {
  const page = readFileSync(DOCS_PAGE, "utf-8");
  const blocks = [...page.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  const files = blocks.filter((block) => block.includes(TIMELINE_IMPORT_SCHEMA));

  it("includes at least one complete example", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("points the main example at the schema, as the flattener's output does", () => {
    expect(JSON.parse(files[0] ?? "{}").$schema).toBe(TIMELINE_IMPORT_SCHEMA_URL);
  });

  it.each(files.map((block, i) => [i, block] as const))(
    "complete example %i is valid",
    (_i, block) => {
      const value: unknown = JSON.parse(block);
      expect(bySchema(value), JSON.stringify(validate.errors)).toBe(true);
      expect(byParser(value)).toBe(true);
    },
  );

  it("shows an image sequence clip the sequence rules accept", () => {
    const clip = blocks
      .map((block) => block.trim())
      .find((block) => block.startsWith("{") && block.includes('"sequence"'));
    expect(clip).toBeDefined();
    const file = { ...minimal, clips: [JSON.parse(clip ?? "{}")] };
    expect(bySchema(file), JSON.stringify(validate.errors)).toBe(true);
    expect(byParser(file)).toBe(true);
    const sequence = file.clips[0]?.sequence as { images: string[] } | undefined;
    expect(sequence?.images.length).toBeGreaterThan(1);
  });

  it("shows a transitions fragment the transition rules accept", () => {
    const fragment = blocks.find((block) => block.trim().startsWith('"transitions"'));
    expect(fragment).toBeDefined();
    const { transitions } = JSON.parse(`{${fragment}}`) as { transitions: unknown[] };
    const file = {
      ...minimal,
      clips: [
        { id: "c1-intro", kind: "video", start: 0, duration: 2, src: "a.mp4" },
        { id: "c2-demo", kind: "video", start: 2, duration: 2, src: "b.mp4" },
      ],
      transitions,
    };
    expect(bySchema(file), JSON.stringify(validate.errors)).toBe(true);
    expect(byParser(file)).toBe(true);
  });
});

/**
 * The file is the boundary: everything that reads OpenTimelineIO sits on the converter's side of it
 * (`skills/import-timeline`), and nothing on this side may describe the file in OTIO's terms. If it
 * did, a converter for any other tool would have to learn OTIO to write the file.
 */
describe("the format knows nothing of OpenTimelineIO", () => {
  const NAMES = /otio|opentimelineio/i;
  const mentions = (file: string) =>
    readFileSync(resolve(REPO_ROOT, file), "utf-8")
      .split("\n")
      .map((text, i) => ({ line: i + 1, text }))
      .filter(({ text }) => NAMES.test(text));

  it.each([
    "packages/core/schemas/timeline-import.json",
    "docs/schema/timeline-import.json",
    "packages/core/src/timelineImport/schema.ts",
    "packages/core/src/timelineImport/emit.ts",
    "packages/core/src/timelineImport/transitions.ts",
    "packages/core/src/timelineImport/index.ts",
    "packages/cli/src/commands/initTimeline.ts",
    "packages/cli/src/commands/initTimelineSequence.ts",
    "packages/cli/src/commands/initTimeline.test.ts",
    "packages/cli/src/commands/initTimelineSequence.test.ts",
    "packages/cli/src/commands/initTimelineSequence.encode.test.ts",
    "packages/cli/src/commands/initTimelineOrigin.ts",
    "packages/cli/src/commands/initTimelineOrigin.test.ts",
    "packages/core/src/timelineImport/mediaOffset.ts",
    "packages/core/src/timelineImport/mediaOffset.test.ts",
    "packages/core/src/timelineImport/timelineImport.test.ts",
    "packages/core/src/timelineImport/transitions.test.ts",
  ])("%s does not mention it", (file) => {
    expect(mentions(file)).toEqual([]);
  });

  it("is named on the reference page only where it points to the converter's guide", () => {
    const found = mentions("docs/reference/timeline-import.mdx");
    expect(found.length).toBeGreaterThan(0); // the pointer exists
    expect(found.every(({ line }) => line <= 16)).toBe(true); // and sits in the introduction
    expect(readFileSync(DOCS_PAGE, "utf-8").split("\n").slice(0, 16).join("\n")).toContain(
      "/guides/import-from-otio",
    );
  });

  it("keeps the OTIO file-naming rules out of the format, and in the converter", () => {
    const converter = readFileSync(
      resolve(REPO_ROOT, "skills/import-timeline/scripts/otio_flatten.py"),
      "utf-8",
    );
    expect(converter).toContain("target_url_for_image_number"); // the library names the files
    const sequence = (schema.$defs as Record<string, { properties: object }>).sequence;
    expect(Object.keys(sequence?.properties ?? {}).sort()).toEqual(["images", "rate"]);
  });
});
