import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [resolve(__dirname, "./src/**/*.{ts,tsx}"), resolve(__dirname, "./index.html")],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: "#0a0a0a",
          surface: "#141414",
          border: "#262626",
          text: "#e5e5e5",
          muted: "#737373",
          accent: "#3CE6AC",
        },
        panel: {
          bg: "#0C0C0E",
          input: "#161618",
          surface: "#18181B",
          hover: "#27272A",
          border: "#1E1E1E",
          "border-input": "#27272A",
          "text-1": "#E4E4E7",
          "text-2": "#A1A1AA",
          "text-3": "#71717A",
          "text-4": "#52525B",
          "text-5": "#3F3F46",
          accent: "#3CE6AC",
          danger: "#EF4444",
        },
      },
    },
  },
  plugins: [],
};
