import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import { fileURLToPath } from "node:url";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)", "../src/**/*.mdx"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-themes",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: { disableTelemetry: true },
  docs: { autodocs: "tag" },
  viteFinal: async (config) =>
    mergeConfig(config, {
      resolve: {
        alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
      },
    }),
};

export default config;
