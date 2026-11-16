import {
  AbsoluteFill,
  Composition,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

export type VideoProps = { text: string; bgVideo?: string };

const FinanceFrame = ({ text, bgVideo }: VideoProps) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{ backgroundColor: "#08131e", color: "#e8f4f2", fontFamily: "Arial, sans-serif" }}
    >
      {bgVideo ? (
        <div
          style={{
            position: "absolute",
            inset: 64,
            border: "2px solid #32d6aa",
            borderRadius: 24,
            overflow: "hidden",
          }}
        >
          <OffthreadVideo
            src={staticFile(bgVideo)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          right: 108,
          top: 108,
          padding: 24,
          borderRadius: 16,
          background: "#08131ecc",
          opacity,
        }}
      >
        <div style={{ fontSize: 18, color: "#9fb8b4", marginBottom: 16 }}>ILLUSTRATIVE TREND</div>
        <svg
          width="300"
          height="160"
          viewBox="0 0 300 160"
          aria-label="Animated illustrative financial chart"
        >
          {[48, 72, 62, 104, 122, 144].map((height, index) => {
            const growth = interpolate(frame, [index * 4, index * 4 + 24], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <rect
                key={index}
                x={index * 50 + 5}
                y={160 - height * growth}
                width={32}
                height={height * growth}
                rx={5}
                fill="#32d6aa"
              />
            );
          })}
        </svg>
      </div>
      <AbsoluteFill
        style={{
          padding: 100,
          justifyContent: "flex-end",
          background: "linear-gradient(transparent 40%, #08131eee)",
          opacity,
        }}
      >
        <div style={{ color: "#32d6aa", fontSize: 24, letterSpacing: 5 }}>MARKET BRIEF</div>
        <div style={{ fontSize: 64, fontWeight: 700, maxWidth: 1400, marginTop: 20 }}>{text}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Root = () => (
  <Composition
    id="FinanceFrame"
    component={FinanceFrame}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={240}
    defaultProps={{ text: "Your financial story", bgVideo: undefined }}
  />
);
