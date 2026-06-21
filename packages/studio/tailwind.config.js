import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import studioPreset from "./src/styles/tailwind-preset.shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [resolve(__dirname, "./src/**/*.{ts,tsx}"), resolve(__dirname, "./index.html")],
  ...studioPreset,
};
