import { CANVAS_DIMENSIONS, type CanvasResolution } from "../core.types";

export function generateBaseHtml(resolution: CanvasResolution = "portrait"): string {
  return `<!DOCTYPE html>
<html data-resolution="${resolution}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <div id="stage">
    <div id="stage-zoom-container"></div>
  </div>
</body>
</html>`;
}

export function getStageStyles(resolution: CanvasResolution = "portrait"): string {
  const { width, height } = CANVAS_DIMENSIONS[resolution];
  return `position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #000;`;
}
