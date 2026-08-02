import type { Meta, StoryObj } from "@storybook/react";

const meta = { title: "Introduction", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj;

export const Welcome: Story = {
  render: () => (
    <div style={{ padding: "56px 40px", background: "var(--bg)", color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <svg width="36" height="36" viewBox="0 0 100 100">
            <path d="M8 48 A42 42 0 0 1 92 48 L92 92 L8 92 Z" fill="#EE5746" />
            <path d="M50 16 L82 74 L18 74 Z" fill="#FFC266" />
          </svg>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22 }}>shoWMe</span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 14 }}>
          Design library · v0.1
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 46, lineHeight: 1.03, letterSpacing: "-.03em", margin: 0, maxWidth: "15ch" }}>
          A warm, low-light system for{" "}
          <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, color: "var(--accent)" }}>the events industry</span>
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 16, lineHeight: 1.6, margin: "20px 0 0", maxWidth: "60ch" }}>
          The React component library behind shoWMe — a booking &amp; settlement platform for operators, performers,
          professionals and agents. Extracted from the product's design system and the persona prototypes, and shared
          across every account kind. Built on warm near-black neutrals, a stage-lit brand palette, and four expressive
          typefaces.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 36 }}>
          {[
            ["Foundations", "Colors, typography, radius & elevation — the tokens everything reads from."],
            ["Components", "The common building blocks: buttons, badges, chips, avatars, inputs, cards, rows, sidebar, stats…"],
            ["Composites", "Assembled patterns like the ContactCard, built purely from the primitives."],
            ["Themes", "Toggle dark / light in the toolbar — every component remaps via semantic tokens."],
          ].map(([t, d]) => (
            <div key={t} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, background: "var(--card)" }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{t}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>

        <p style={{ color: "var(--dim)", fontFamily: "var(--font-mono)", fontSize: 11.5, marginTop: 40 }}>
          Clash Display · Inter Tight · Instrument Serif · JetBrains Mono
        </p>
      </div>
    </div>
  ),
};
