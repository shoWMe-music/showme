import type { Meta, StoryObj } from "@storybook/react";

const meta = { title: "Foundations/Radius & Elevation", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj;

export const Scales: Story = {
  render: () => (
    <div style={{ padding: 32, background: "var(--bg)", minHeight: "100vh", color: "var(--text)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, marginBottom: 18 }}>Radius</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          {[["sm", 8], ["md", 14], ["lg", 24], ["xl", 40]].map(([name, r]) => (
            <div key={name} style={{ textAlign: "center" }}>
              <div style={{ width: 64, height: 64, background: "var(--elevated)", border: "1px solid var(--border-strong)", borderRadius: r as number }} />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 8 }}>{name} · {r}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 100, height: 64, background: "var(--elevated)", borderRadius: 14, boxShadow: "var(--shadow)" }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 10 }}>--shadow</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 100, height: 64, background: "var(--elevated)", borderRadius: 14, boxShadow: "var(--shadow-lg)" }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)", marginTop: 10 }}>--shadow-lg</div>
        </div>
      </div>
    </div>
  ),
};
