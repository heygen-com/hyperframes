import type { ArticleAction } from "../lib/content";

export function ActionPlanPanel({ actions }: { actions: ArticleAction[] }) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      {actions.map((action) => (
        <div
          key={action.id}
          style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px" }}
        >
          <div style={{ fontWeight: 600 }}>{action.label}</div>
          <div style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
            {action.preview}
          </div>
        </div>
      ))}
    </div>
  );
}
