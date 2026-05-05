export interface HyperframesLoaderProps {
  /** Status text shown below the mark. */
  title: string;
  /** Optional secondary detail line. */
  detail?: string;
  /** Optional monospace third line for IDs, counts, or percentages. */
  mono?: string;
  /** Pixel size of the mark itself; status text scales independently. */
  size?: number;
  /** Optional normalized progress value from 0 to 1. */
  progress?: number;
}

export function HyperframesLoader({
  title,
  detail,
  mono,
  size = 64,
  progress,
}: HyperframesLoaderProps) {
  const boundedProgress =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.min(1, Math.max(0, progress))
      : undefined;
  const markFrameSize = Math.round(size * 1.16);

  return (
    <div className="hf-loader" draggable={false}>
      <div
        className="hf-loader-mark-frame"
        style={{ width: markFrameSize, height: markFrameSize }}
        draggable={false}
      >
        <svg
          className="hf-loader-mark"
          width={size}
          height={size}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <g className="hf-loader-mark__mark" transform="translate(50 50)">
            <g className="hf-loader-mark__core" transform="scale(1)" opacity=".92">
              <g transform="translate(-50 -50)">
                <path
                  d="M10.1851 57.8021L33.1145 73.8313C36.2202 75.9978 41.5173 73.5433 42.4816 69.4984L51.7611 30.4271C52.7253 26.3822 48.5802 23.9277 44.4602 26.0942L13.917 42.1235C6.96677 45.7676 4.97564 54.1579 10.1851 57.8021Z"
                  fill="url(#hf-loader-grad-left)"
                />
                <path
                  d="M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z"
                  fill="url(#hf-loader-grad-right)"
                />
              </g>
            </g>
          </g>
          <defs>
            <linearGradient
              id="hf-loader-grad-left"
              x1="48.5676"
              y1="25"
              x2="44.7804"
              y2="71.9384"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#06E3FA" />
              <stop offset="1" stopColor="#4FDB5E" />
            </linearGradient>
            <linearGradient
              id="hf-loader-grad-right"
              x1="54.8282"
              y1="73.8392"
              x2="72.0989"
              y2="32.8932"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#06E3FA" />
              <stop offset="1" stopColor="#4FDB5E" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="hf-loader-title">{title}</div>
      {detail && <div className="hf-loader-detail">{detail}</div>}
      {boundedProgress !== undefined && (
        <div className="hf-loader-progress" aria-hidden="true">
          <div
            className="hf-loader-progress__fill"
            style={{ transform: `scaleX(${boundedProgress})` }}
          />
        </div>
      )}
      {mono && <div className="hf-loader-mono">{mono}</div>}
    </div>
  );
}

export function StatusFrame(props: HyperframesLoaderProps) {
  return (
    <div className="hf-frame">
      <HyperframesLoader {...props} />
    </div>
  );
}
