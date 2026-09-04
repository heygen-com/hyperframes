/**
 * Storybook for Studio's UI primitives (R7, KTD10).
 *
 * It reuses Studio's own `vite.config.ts`, so the Tailwind v4 plugin, the
 * workspace aliases and the React plugin are the ones the app builds with, and
 * a story cannot be styled by a config the app does not have. The one plugin
 * that is dropped is `studio-dev-api`: it starts a watcher over the developer's
 * real project folder and mounts Studio's API middleware, neither of which a
 * story gallery has any use for.
 */

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/components/ui/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  // Storybook reports anonymous usage by default. Running the gallery is not
  // something this repository asks its contributors to report to anyone.
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: (viteConfig.plugins ?? []).filter(
      (plugin) =>
        !(
          plugin &&
          typeof plugin === "object" &&
          "name" in plugin &&
          plugin.name === "studio-dev-api"
        ),
    ),
  }),
};

export default config;
