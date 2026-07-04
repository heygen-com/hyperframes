import { describe, expect, it } from "vitest";
import {
  buildDashboardSummary,
  buildActionPlan,
  deriveAiStatus,
  deriveRenderStatus,
  generateVideo,
} from "../src/lib/content";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("dashboard helpers", () => {
  it("builds a dashboard summary from posts and generation counts", () => {
    const summary = buildDashboardSummary(
      [{ id: 1, date: new Date().toISOString() }] as any,
      3,
      "Online",
      "Ready",
    );

    expect(summary.todayPosts).toBe(1);
    expect(summary.todayVideos).toBe(3);
    expect(summary.aiStatus).toBe("Online");
    expect(summary.gpuStatus).toBe("Ready");
  });

  it("creates action cards for a selected article", () => {
    const plan = buildActionPlan("东南亚快曝光 2026 主题");

    expect(plan).toHaveLength(4);
    expect(plan[0].label).toBe("AI生成脚本");
    expect(plan[0].preview).toContain("东南亚快曝光 2026 主题");
  });
});

describe("video system status derivation", () => {
  it("reports unknown/offline when the status endpoint could not be reached", () => {
    expect(deriveRenderStatus(null)).toBe("未知");
    expect(deriveAiStatus(null)).toBe("离线");
  });

  it("reports rendering vs idle based on currently_rendering", () => {
    expect(deriveRenderStatus({ currently_rendering: { task_id: 1, post_id: 2 } })).toBe("渲染中");
    expect(deriveRenderStatus({ currently_rendering: null })).toBe("空闲");
  });

  it("reports degraded when the last-hour success rate drops below 50%", () => {
    expect(
      deriveAiStatus({ currently_rendering: null, last_hour: { total: 4, success_rate_pct: 25 } }),
    ).toBe("降级");
    expect(
      deriveAiStatus({ currently_rendering: null, last_hour: { total: 4, success_rate_pct: 75 } }),
    ).toBe("在线");
    expect(
      deriveAiStatus({
        currently_rendering: null,
        last_hour: { total: 0, success_rate_pct: null },
      }),
    ).toBe("在线");
  });
});

describe("generateVideo", () => {
  it("reports success when the render completes", async () => {
    const result = await generateVideo(123, fakeFetch({ ok: true, task_id: 1, video_id: "v1" }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("待审核");
  });

  it("reports the existing-task reason when the server skips generation", async () => {
    const result = await generateVideo(
      123,
      fakeFetch({ ok: true, skipped: true, reason: "already has a processing task" }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("already has a processing task");
  });

  it("surfaces the server error message on failure", async () => {
    const result = await generateVideo(
      123,
      fakeFetch({ ok: false, error: "content generation failed" }, 500),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe("content generation failed");
  });

  it("reports failure when the request itself throws", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await generateVideo(123, throwingFetch);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("network down");
  });
});
