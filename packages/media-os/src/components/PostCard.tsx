import type { ArticleAction, summarizePosts } from "../lib/content";
import { ActionPlanPanel } from "./ActionPlanPanel";
import { GenerateVideoButton } from "./GenerateVideoButton";
import { cardStyle } from "./styles";

type Post = ReturnType<typeof summarizePosts>[number];

export function PostCard({
  post,
  isActive,
  actions,
  onToggleActions,
  onGenerated,
}: {
  post: Post;
  isActive: boolean;
  actions: ArticleAction[];
  onToggleActions: () => void;
  onGenerated: () => void;
}) {
  return (
    <div style={{ ...cardStyle, boxShadow: "0 8px 20px rgba(0,0,0,0.05)" }}>
      <div style={{ fontWeight: 700, marginBottom: "8px" }}>{post.title}</div>
      <div style={{ color: "#475569", marginBottom: "8px" }}>{post.excerpt || "暂无摘要"}</div>
      <div style={{ color: "#64748b", fontSize: "12px", marginBottom: "8px" }}>
        {post.date || "未知日期"}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        <button type="button" onClick={onToggleActions}>
          查看生成动作
        </button>
        <GenerateVideoButton postId={post.id} onGenerated={onGenerated} />
      </div>
      {isActive && <ActionPlanPanel actions={actions} />}
    </div>
  );
}
