export const ERROR_DIFFUSION_ALGORITHMS = {
  "floyd-steinberg": {
    kernel: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
    divisor: 16,
  },
  atkinson: {
    kernel: [
      [1, 0, 1],
      [2, 0, 1],
      [-1, 1, 1],
      [0, 1, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
    divisor: 8,
  },
  "jarvis-judice-ninke": {
    kernel: [
      [1, 0, 7],
      [2, 0, 5],
      [-2, 1, 3],
      [-1, 1, 5],
      [0, 1, 7],
      [1, 1, 5],
      [2, 1, 3],
      [-2, 2, 1],
      [-1, 2, 3],
      [0, 2, 5],
      [1, 2, 3],
      [2, 2, 1],
    ],
    divisor: 48,
  },
  stucki: {
    kernel: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
      [-2, 2, 1],
      [-1, 2, 2],
      [0, 2, 4],
      [1, 2, 2],
      [2, 2, 1],
    ],
    divisor: 42,
  },
  burkes: {
    kernel: [
      [1, 0, 8],
      [2, 0, 4],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 8],
      [1, 1, 4],
      [2, 1, 2],
    ],
    divisor: 32,
  },
  sierra: {
    kernel: [
      [1, 0, 5],
      [2, 0, 3],
      [-2, 1, 2],
      [-1, 1, 4],
      [0, 1, 5],
      [1, 1, 4],
      [2, 1, 2],
      [-1, 2, 2],
      [0, 2, 3],
      [1, 2, 2],
    ],
    divisor: 32,
  },
  "sierra-lite": {
    kernel: [
      [1, 0, 2],
      [-1, 1, 1],
      [0, 1, 1],
    ],
    divisor: 4,
  },
  "two-row-sierra": {
    kernel: [
      [1, 0, 4],
      [2, 0, 3],
      [-2, 1, 1],
      [-1, 1, 2],
      [0, 1, 3],
      [1, 1, 2],
      [2, 1, 1],
    ],
    divisor: 16,
  },
};

const DEFAULTS = {
  algorithm: "floyd-steinberg",
  brightness: 1,
  contrast: 1.2,
  detail: 1,
  palette: ["#000000", "#ffffff"],
  pointSize: 3,
};

export function errorDiffusionBufferLength(width, height, pointSize) {
  return Math.ceil(width / pointSize) * Math.ceil(height / pointSize) * 3;
}

export function applyErrorDiffusionRgba(data, width, height, options = {}, errorBuffer) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("width and height must be positive integers");
  }
  if (!data || data.length !== width * height * 4) {
    throw new Error(`RGBA data must contain ${width * height * 4} bytes`);
  }

  const algorithm = options.algorithm ?? DEFAULTS.algorithm;
  const diffusion = ERROR_DIFFUSION_ALGORITHMS[algorithm];
  if (!diffusion) throw new Error(`unknown error-diffusion algorithm: ${algorithm}`);

  const pointSize = integerInRange(options.pointSize ?? DEFAULTS.pointSize, 1, 20, "pointSize");
  const brightness = numberInRange(options.brightness ?? DEFAULTS.brightness, 0.5, 2, "brightness");
  const contrast = numberInRange(options.contrast ?? DEFAULTS.contrast, 0.5, 2, "contrast");
  const detail = numberInRange(options.detail ?? DEFAULTS.detail, 0.1, 1, "detail");
  const palette = parsePalette(options.palette ?? DEFAULTS.palette);
  const blockColumns = Math.ceil(width / pointSize);
  const blockRows = Math.ceil(height / pointSize);
  const errorLength = errorDiffusionBufferLength(width, height, pointSize);
  const errors = errorBuffer ?? new Float32Array(errorLength);
  if (!(errors instanceof Float32Array) || errors.length !== errorLength) {
    throw new Error(`errorBuffer must be a Float32Array of length ${errorLength}`);
  }
  errors.fill(0);

  const centerOffset = Math.floor(pointSize / 2);
  for (let blockRow = 0; blockRow < blockRows; blockRow++) {
    const blockY = blockRow * pointSize;
    for (let blockColumn = 0; blockColumn < blockColumns; blockColumn++) {
      const blockX = blockColumn * pointSize;
      const centerX = Math.min(blockX + centerOffset, width - 1);
      const centerY = Math.min(blockY + centerOffset, height - 1);
      const rgbaIndex = (centerY * width + centerX) * 4;
      const errorIndex = (blockRow * blockColumns + blockColumn) * 3;
      const red = correctedChannel(data[rgbaIndex], errors[errorIndex], brightness, contrast);
      const green = correctedChannel(
        data[rgbaIndex + 1],
        errors[errorIndex + 1],
        brightness,
        contrast,
      );
      const blue = correctedChannel(
        data[rgbaIndex + 2],
        errors[errorIndex + 2],
        brightness,
        contrast,
      );
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      const output = palette[Math.min(palette.length - 1, Math.floor(luminance * palette.length))];

      for (let y = blockY; y < Math.min(blockY + pointSize, height); y++) {
        for (let x = blockX; x < Math.min(blockX + pointSize, width); x++) {
          const outputIndex = (y * width + x) * 4;
          data[outputIndex] = Math.round(output[0] * 255);
          data[outputIndex + 1] = Math.round(output[1] * 255);
          data[outputIndex + 2] = Math.round(output[2] * 255);
        }
      }

      for (const [dx, dy, weight] of diffusion.kernel) {
        const targetColumn = blockColumn + dx;
        const targetRow = blockRow + dy;
        if (
          targetColumn < 0 ||
          targetColumn >= blockColumns ||
          targetRow < 0 ||
          targetRow >= blockRows
        ) {
          continue;
        }
        const target = (targetRow * blockColumns + targetColumn) * 3;
        const scale = (weight / diffusion.divisor) * detail;
        errors[target] += (red - output[0]) * scale;
        errors[target + 1] += (green - output[1]) * scale;
        errors[target + 2] += (blue - output[2]) * scale;
      }
    }
  }
  return data;
}

function correctedChannel(byte, error, brightness, contrast) {
  return Math.min(1, Math.max(0, ((byte / 255 - 0.5) * contrast + 0.5) * brightness + error));
}

function parsePalette(colors) {
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 6) {
    throw new Error("palette must contain 2 to 6 colors");
  }
  return colors.map((color) => {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) throw new Error(`palette color must use #rrggbb: ${color}`);
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  });
}

function numberInRange(value, min, max, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return number;
}

function integerInRange(value, min, max, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}
