import type { Preview } from "@storybook/react";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import "../src/styles/tokens.css";
import "../src/styles/global.css";
import "../src/styles/touch.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { disable: true }, // theme decorator owns the surface
    options: {
      storySort: {
        order: ["Introduction", "Foundations", "Atoms", "Molecules", "Organisms"],
      },
    },
    a11y: { context: "#storybook-root" },
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { Dark: "dark", Light: "light" },
      defaultTheme: "Dark",
      attributeName: "data-theme",
    }),
    (Story) => (
      <div style={{ padding: 28, background: "var(--bg)", color: "var(--text)", minHeight: "100%", fontFamily: "var(--font-sans)" }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
