import { useState } from "react";
import { buildActionPlan, type summarizePosts } from "../lib/content";
import { PostCard } from "./PostCard";

type Post = ReturnType<typeof summarizePosts>[number];

export function PostList({
  posts,
  loading,
  error,
  onGenerated,
}: {
  posts: Post[];
  loading: boolean;
  error: string | null;
  onGenerated: () => void;
}) {
  const [activePostId, setActivePostId] = useState<number | null>(null);
  const activePost = posts.find((post) => post.id === activePostId);
  const activeActions = activePost ? buildActionPlan(activePost.title) : [];

  if (loading) return <p>正在读取最新文章…</p>;
  if (error) return <p style={{ color: "crimson" }}>读取失败: {error}</p>;

  return (
    <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          isActive={activePostId === post.id}
          actions={activePostId === post.id ? activeActions : []}
          onToggleActions={() => setActivePostId(post.id)}
          onGenerated={onGenerated}
        />
      ))}
    </div>
  );
}
