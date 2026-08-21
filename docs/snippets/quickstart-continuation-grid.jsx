/**
 * Three equally valid ways to continue from the first playable version.
 *
 * The choices are intentionally not links: discovery happens only at the end
 * of the page.
 */
export const QuickstartContinuationGrid = () => {
  const paths = [
    {
      title: "Ask the agent",
      detail: "Revise the project or render it in the same chat.",
      instruction: "Make the title larger, then render another version.",
    },
    {
      title: "Open Studio",
      detail: "Point at the same project and make a visible edit.",
      instruction: "npx hyperframes preview",
    },
    {
      title: "Use the CLI",
      detail: "Preview or render directly from the project folder.",
      instruction: "npx hyperframes render --output video.mp4",
    },
  ];

  return (
    <div style={{ margin: "1.5rem 0" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
          gap: "0.75rem",
        }}
      >
        {paths.map((path) => (
          <article
            key={path.title}
            style={{
              padding: "0.8rem 0.85rem 0.9rem",
              border: "1px solid var(--border-color, rgba(128, 128, 128, 0.22))",
              borderRadius: "10px",
            }}
          >
            <strong style={{ display: "block", fontSize: "0.95rem", lineHeight: 1.35 }}>
              {path.title}
            </strong>
            <span
              style={{
                display: "block",
                marginTop: "0.3rem",
                minHeight: "2.7em",
                fontSize: "0.825rem",
                lineHeight: 1.45,
                opacity: 0.72,
              }}
            >
              {path.detail}
            </span>
            <code
              style={{
                display: "block",
                marginTop: "0.65rem",
                padding: "0.55rem 0.65rem",
                overflowWrap: "anywhere",
                whiteSpace: "normal",
                fontSize: "0.72rem",
                lineHeight: 1.45,
                borderRadius: "8px",
                background: "var(--code-block-background, rgba(128, 128, 128, 0.1))",
              }}
            >
              {path.instruction}
            </code>
          </article>
        ))}
      </div>
    </div>
  );
};
