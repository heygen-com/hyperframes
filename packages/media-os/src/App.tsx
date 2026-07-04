import { PostList } from "./components/PostList";
import { StatCard } from "./components/StatCard";
import { useMediaOsData } from "./lib/hooks";

function App() {
  const { summary, dashboard, loading, error, refreshTodayVideos } = useMediaOsData();

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "24px",
        background: "#f4f7fb",
        minHeight: "100vh",
      }}
    >
      <h1>Media OS Dashboard</h1>
      <p>Independent dashboard layer for HyperFrames-based video operations.</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginTop: "24px",
        }}
      >
        <StatCard label="今日文章数量" value={dashboard.todayPosts} />
        <StatCard label="今日生成视频数量" value={dashboard.todayVideos} />
        <StatCard label="AI状态" value={dashboard.aiStatus} />
        <StatCard label="渲染状态" value={dashboard.gpuStatus} />
      </div>

      <h2 style={{ marginTop: "32px" }}>文章中心</h2>
      <PostList posts={summary} loading={loading} error={error} onGenerated={refreshTodayVideos} />
    </div>
  );
}

export default App;
