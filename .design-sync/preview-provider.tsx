import React from "react";

/**
 * Preview frame for design-sync — mirrors the storybook `preview.tsx` decorator
 * (dark theme + padded surface) WITHOUT importing @storybook/addon-themes, which
 * can't be bundled into the preview runtime. The design-system tokens default to
 * the dark theme at :root, so `data-theme="dark"` is belt-and-suspenders; the
 * padding + background match how storybook frames each story so previews compare
 * 1:1 against the reference.
 */
export function PreviewFrame({ children }: { children?: React.ReactNode }) {
  return React.createElement(
    "div",
    {
      "data-theme": "dark",
      style: {
        padding: 28,
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "100%",
        fontFamily: "var(--font-sans)",
      },
    },
    children,
  );
}
