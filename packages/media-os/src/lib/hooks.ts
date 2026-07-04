import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDashboardSummary,
  deriveAiStatus,
  deriveRenderStatus,
  generateVideo,
  summarizePosts,
  VIDEO_API,
  type GenerateVideoResult,
  type VideoSystemStatus,
  type WordPressPost,
} from "./content";

const WORDPRESS_API = "https://kuaibaoguang.cn/wp-json/wp/v2/posts?per_page=10";

function todayDateString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function useWordPressPosts() {
  const [posts, setPosts] = useState<WordPressPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(WORDPRESS_API)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setPosts(data as WordPressPost[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, []);

  return { posts, loading, error };
}

function useVideoPipelineStatus() {
  const [todayVideos, setTodayVideos] = useState(0);
  const [systemStatus, setSystemStatus] = useState<VideoSystemStatus | null>(null);

  const refreshTodayVideos = useCallback(() => {
    fetch(`${VIDEO_API}?action=list&date=${todayDateString()}&limit=1`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setTodayVideos(typeof data.total === "number" ? data.total : 0))
      .catch(() => setTodayVideos(0));
  }, []);

  useEffect(() => {
    refreshTodayVideos();
    fetch(`${VIDEO_API}?action=system`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setSystemStatus(data as VideoSystemStatus))
      .catch(() => setSystemStatus(null));
  }, [refreshTodayVideos]);

  return { todayVideos, systemStatus, refreshTodayVideos };
}

// Combines the WordPress article feed with video.kuaibaoguang.cn's live
// pipeline status into the dashboard's stat tiles + article summaries.
export function useMediaOsData() {
  const { posts, loading, error } = useWordPressPosts();
  const { todayVideos, systemStatus, refreshTodayVideos } = useVideoPipelineStatus();

  const summary = useMemo(() => summarizePosts(posts), [posts]);
  const dashboard = useMemo(
    () =>
      buildDashboardSummary(
        posts,
        todayVideos,
        deriveAiStatus(systemStatus),
        deriveRenderStatus(systemStatus),
      ),
    [posts, todayVideos, systemStatus],
  );

  return { summary, dashboard, loading, error, refreshTodayVideos };
}

export function useGenerateVideo(postId: number, onGenerated: () => void) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GenerateVideoResult | null>(null);

  const handleGenerateVideo = useCallback(async () => {
    setIsGenerating(true);
    setResult(null);
    const outcome = await generateVideo(postId);
    setResult(outcome);
    setIsGenerating(false);
    if (outcome.ok) onGenerated();
  }, [postId, onGenerated]);

  return { isGenerating, result, handleGenerateVideo };
}
