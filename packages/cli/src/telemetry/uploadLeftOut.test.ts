import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeftOutReference } from "../utils/leftOutReference.js";

const trackEvent = vi.fn();
vi.mock("./client.js", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

const { trackUploadLeftOut } = await import("./uploadLeftOut.js");

const at = (levels_up: number | null, reason: LeftOutReference["reason"] = "received") => ({
  file: "index.html",
  reference: "../secret/name.png",
  path: "../secret/name.png",
  reason,
  levels_up,
});

describe("cli_upload_left_out", () => {
  beforeEach(() => trackEvent.mockClear());

  it("counts what was left out and how far above the project, and names nothing", () => {
    const references = [
      at(1),
      at(1, "blocklisted"),
      at(2),
      at(5),
      at(null),
      at(1, "file_type"),
      at(2, "file_type"),
    ];
    trackUploadLeftOut("cloud_render", references, true);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    const [event, properties] = trackEvent.mock.calls[0]!;
    expect(event).toBe("cli_upload_left_out");
    expect(properties).toEqual({
      command: "cloud_render",
      dry_run: true,
      left_out_count: 7,
      received_count: 4,
      blocklisted_count: 1,
      file_type_count: 2,
      max_levels_up: 5,
      levels_up_1: 3,
      levels_up_2: 2,
      levels_up_3_plus: 1,
      other_drive: 1,
    });
    expect(JSON.stringify(properties)).not.toMatch(/secret|name\.png|index\.html/);
  });

  it("sends nothing for an upload that left nothing out", () => {
    trackUploadLeftOut("publish", []);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
