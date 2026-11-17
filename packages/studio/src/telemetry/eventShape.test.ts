// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./policy", () => ({ browserTelemetryAllowed: () => true }));
vi.mock("./canary", () => ({ canaryEventProperties: () => ({}) }));

const CONTENT = [
  "/Users/ana/客户/秘密 video.mp4",
  "compositions/intro.html",
  "C:\\Users\\ana\\proj\\index.html",
  "#hero-title",
  '[data-composition-id="intro"]',
  ".cta",
  "forbidden path: compositions/x.html",
];

const PROPERTIES = {
  file_path: CONTENT[0],
  target_source_file: CONTENT[1],
  source_file: CONTENT[2],
  target_selector: CONTENT[3],
  selector: CONTENT[4],
  target_id: "hero-title",
  detail: CONTENT[5],
  error_message: CONTENT[6],
  status_code: 403,
};

type Sent = Array<{ event: string; properties: Record<string, unknown> }>;

describe("Studio analytics leave the machine without paths or selectors", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function sent(): Promise<{ body: string; batch: Sent }> {
    await vi.runOnlyPendingTimersAsync();
    const bodies = fetchMock.mock.calls.map((call) =>
      String((call[1] as { body?: string })?.body ?? ""),
    );
    const batch = bodies.flatMap((body) => (JSON.parse(body) as { batch: Sent }).batch);
    return { body: bodies.join("\n"), batch };
  }

  async function send(transport: "studio:*" | "studio_*", event: string, properties: object) {
    if (transport === "studio:*")
      (await import("../utils/studioTelemetry")).trackStudioEvent(event, properties as never);
    else (await import("./client")).trackEvent(event, properties as never);
  }

  it.each(["studio:*", "studio_*"] as const)(
    "the %s transport sends none of the content, only facts that still group it",
    async (transport) => {
      await send(transport, "save_failure", PROPERTIES);
      await send(transport, "save_failure", PROPERTIES);
      const { body, batch } = await sent();

      expect(batch).toHaveLength(2);
      for (const text of [...CONTENT, "hero-title", "intro.html", "秘密"]) {
        expect(body).not.toContain(JSON.stringify(text).slice(1, -1));
      }
      const [first, second] = batch.map((e) => e.properties);
      expect(first).toMatchObject({
        file_path_ext: "mp4",
        file_path_kind: "asset",
        target_source_file_kind: "composition",
        target_source_file_depth: 1,
        source_file_ext: "html",
        target_selector_kind: "id",
        selector_kind: "attribute",
        target_id_kind: "id",
        status_code: 403,
        dropped_fields: "detail",
      });
      expect(first?.error_message_shape).toMatch(/^[0-9a-f]{8}$/);
      expect(first?.file_path_hash).toMatch(/^[0-9a-f]{8}$/);
      // The same path from the same install groups; the salt that keys it never leaves.
      expect(second?.file_path_hash).toBe(first?.file_path_hash);
      expect(body).not.toContain(
        localStorage.getItem("hyperframes-studio:telemetrySalt") ?? "missing-salt",
      );
    },
  );

  it("keeps the session's own fields when a caller sends the same names", async () => {
    await send("studio:*", "navigation", { url_hash: "custom", tab_id: "custom" });
    const { batch } = await sent();
    expect(batch[0]?.properties.url_hash).not.toBe("custom");
    expect(batch[0]?.properties.tab_id).not.toBe("custom");
  });

  const PROJECT_FRAME =
    "http://localhost:3002/api/projects/acme-launch/preview/compositions/intro.html:12:3";
  const STACK = [
    "Error: Failed to save compositions/intro.html (403): forbidden path: /Users/ana/客户/x.html",
    `    at mountClip (${PROJECT_FRAME})`,
    `    at commitEdit (${location.origin}/assets/index-B4x2.js:40:7)`,
    `    at ${location.origin}/assets/vendor-C9.js:1:99`,
  ].join("\n");
  const LEAKS = ["acme-launch", "intro.html", "客户", "/Users/ana", "forbidden path", "mountClip"];

  it.each(["studio:*", "studio_*"] as const)(
    "the %s transport sends an error's class, a shape and its own frames, never its words",
    async (transport) => {
      await send(transport, "crash", {
        error_message:
          "Failed to save compositions/intro.html (403): forbidden path: /Users/ana/客户/x.html",
        error_name: "StudioSaveHttpError",
        stack_trace: STACK,
        component_stack: `\n    at ClipRow (${PROJECT_FRAME})\n    at Timeline (${location.origin}/assets/index-B4x2.js:9:1)`,
      });
      await send(transport, "unhandled_promise_rejection", {
        error_message: "acme-launch secret",
        error_name: null,
        stack_trace: null,
      });
      await send(transport, "unhandled_error", {
        error: "x",
        filename: PROJECT_FRAME.replace(/:\d+:\d+$/, ""),
      });
      const { body, batch } = await sent();

      for (const text of LEAKS) expect(body).not.toContain(text);
      const [crash, rejection, uncaught] = batch.map((e) => e.properties);
      expect(crash).toMatchObject({
        error_name: "StudioSaveHttpError",
        error_message_status: 403,
        stack_trace: "?\ncommitEdit@index-B4x2.js:40:7\n<anonymous>@vendor-C9.js:1:99",
        component_stack: "ClipRow\nTimeline",
      });
      expect(crash?.error_message_shape).toMatch(/^[0-9a-f]{8}$/);
      expect(rejection?.error_message_shape).toMatch(/^[0-9a-f]{8}$/);
      expect(uncaught?.dropped_fields).toBe("filename");
    },
  );

  it("leaves feedback text the person typed to send", async () => {
    await send("studio_*", "studio_feedback", {
      comment: "export of compositions/intro.html froze",
    });
    const { batch } = await sent();
    expect(batch[0]?.properties.comment).toBe("export of compositions/intro.html froze");
  });
});

describe("errors leave no project name, even shaped", () => {
  const shape = async (properties: Record<string, string>) =>
    (await import("./eventShape")).shapeEventProperties("studio:crash", properties);

  it("keeps only frames with an absolute address on Studio's own origin", async () => {
    const shaped = await shape({
      stack_trace: [
        "Error: acme-launch@acme-launch.js:1:2",
        "    at secretHandler (/home/ana/acme-launch/server.js:10:5)",
        "    at secretHandler (acme-launch-intro.js:10:5)",
      ].join("\n"),
      filename: "acme-launch.js",
    });
    expect(JSON.stringify(shaped)).not.toMatch(/acme|secretHandler/);
    expect(shaped.dropped_fields).toBe("filename");
  });

  it("gives two projects' same failure the same shape", async () => {
    const pairs = [
      ["acme-launch", "other-proj"].map(
        (name) =>
          `Failed to fetch dynamically imported module: http://localhost/api/projects/${name}/preview/x.js`,
      ),
      ["#acme-title", "#other-title"].map((id) => `GSAP target ${id} not found.`),
    ];
    for (const [a, b] of pairs) {
      expect((await shape({ error_message: a! })).error_message_shape).toBe(
        (await shape({ error_message: b! })).error_message_shape,
      );
    }
  });
});
