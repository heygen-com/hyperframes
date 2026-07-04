export type WordPressPost = {
  id: number;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  link?: string;
  date?: string;
};

export type DashboardSummary = {
  todayPosts: number;
  todayVideos: number;
  aiStatus: string;
  gpuStatus: string;
};

export type ArticleAction = {
  id: string;
  label: string;
  preview: string;
};

// Proxied by vite.config.ts's dev server -> video.kuaibaoguang.cn/api/video-dashboard.php
// (token injected server-side, see .env.example).
export const VIDEO_API = "/video-api";

// Shape of video.kuaibaoguang.cn's api/video-dashboard.php?action=system
// response (only the fields this dashboard reads).
export type VideoSystemStatus = {
  currently_rendering: { task_id: number; post_id: number } | null;
  last_hour?: { total: number; success_rate_pct: number | null };
};

// There is no GPU in this pipeline — rendering is ffmpeg/edge-tts on CPU,
// text via the Claude API. "currently_rendering" is the closest real signal
// for "is the render engine busy right now".
export function deriveRenderStatus(status: VideoSystemStatus | null): string {
  if (!status) return "未知";
  return status.currently_rendering ? "渲染中" : "空闲";
}

// Below 50% success in the last hour mirrors health-check.php's own
// checkSuccessRate() threshold, so this reads the same as the ops alerting.
export function deriveAiStatus(status: VideoSystemStatus | null): string {
  if (!status) return "离线";
  const rate = status.last_hour?.success_rate_pct;
  if (rate !== null && rate !== undefined && rate < 50) return "降级";
  return "在线";
}

export function getTodayPostCount(posts: WordPressPost[]): number {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return posts.filter((post) => {
    if (!post.date) return false;
    const postDate = new Date(post.date);
    return postDate >= startOfToday;
  }).length;
}

export function summarizePosts(posts: WordPressPost[]) {
  return posts.map((post) => ({
    id: post.id,
    title: post.title?.rendered ?? "Untitled",
    excerpt:
      post.excerpt?.rendered
        ?.replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim() ?? "",
    link: post.link ?? "",
    date: post.date ?? "",
  }));
}

export function buildDashboardSummary(
  posts: WordPressPost[],
  todayVideos: number,
  aiStatus: string,
  gpuStatus: string,
): DashboardSummary {
  return {
    todayPosts: getTodayPostCount(posts),
    todayVideos,
    aiStatus,
    gpuStatus,
  };
}

export type GenerateVideoResult = { ok: boolean; message: string };

// action=generate runs synchronously on the server (AI content + ffmpeg
// render, ~4 minutes) and returns the final result in one response — there
// is no separate job-status endpoint to poll, so the caller just awaits this.
// Params travel as query string (matching the API's own doc comment,
// `POST ?action=generate&post_id=123`), not a JSON body — video-dashboard.php
// reads $_REQUEST, which a JSON body would never populate.
export async function generateVideo(
  postId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GenerateVideoResult> {
  try {
    const res = await fetchImpl(`${VIDEO_API}?action=generate&post_id=${postId}`, {
      method: "POST",
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      return { ok: false, message: (data && data.error) || `请求失败 (HTTP ${res.status})` };
    }
    if (data.skipped) {
      return { ok: true, message: `该文章已有生成任务（${data.reason ?? "跳过"}）` };
    }
    return { ok: true, message: "视频生成完成，已进入待审核队列" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "网络请求失败" };
  }
}

export function buildActionPlan(title: string): ArticleAction[] {
  const safeTitle = title || "未命名文章";
  return [
    {
      id: "script",
      label: "AI生成脚本",
      preview: `为“${safeTitle}”生成一段适合短视频的脚本。`,
    },
    {
      id: "voice",
      label: "AI生成旁白",
      preview: `为“${safeTitle}”生成自然流畅的旁白文案。`,
    },
    {
      id: "title",
      label: "AI生成标题",
      preview: `为“${safeTitle}”生成更适合社媒传播的标题。`,
    },
    {
      id: "cover",
      label: "AI生成封面",
      preview: `为“${safeTitle}”生成一张适合视频封面的视觉提案。`,
    },
  ];
}
