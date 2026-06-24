import { sfxProvider } from "./sfx-provider.mjs";
import { imageProvider, iconProvider } from "./image-provider.mjs";
import { bgmProvider } from "./bgm-provider.mjs";
import { brandProvider } from "./brand-provider.mjs";

const STUB = {
  async search() {
    return null;
  },
};

const registry = {
  bgm: { ...bgmProvider, type: "bgm" },
  sfx: { ...sfxProvider, type: "sfx" },
  voice: { ...STUB, type: "voice" },
  image: { ...imageProvider, type: "image" },
  icon: { ...iconProvider, type: "icon" },
  brand: { ...brandProvider, type: "brand" },
};

export function getProvider(type) {
  const p = registry[type];
  if (!p) throw new Error(`unknown media type: ${type}`);
  return p;
}

export function listTypes() {
  return Object.keys(registry);
}
