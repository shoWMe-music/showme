import type { Meta, StoryObj } from "@storybook/react";
import { STATUSES, STATUS_LABEL, STATUS_COLOR } from "@/lib/status";

const meta = { title: "Foundations/Colors", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj;

function Swatch({ name, varName, value }: { name: string; varName: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
      <div style={{ height: 72, background: value }} />
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{value}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--dim)" }}>{varName}</div>
      </div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 };
const section: React.CSSProperties = { padding: "0 0 40px" };
const h: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, letterSpacing: "-.02em", margin: "0 0 14px" };

export const Palette: Story = {
  render: () => (
    <div style={{ padding: 32, background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <section style={section}>
        <h2 style={h}>Brand</h2>
        <div style={grid}>
          <Swatch name="Brand Red" varName="--brand-red" value="#EE5746" />
          <Swatch name="Red Deep" varName="--brand-red-deep" value="#D63D2C" />
          <Swatch name="Red Glow" varName="--brand-red-glow" value="#FF7A68" />
          <Swatch name="Gold" varName="--brand-gold" value="#FFC266" />
          <Swatch name="Amber" varName="--brand-amber" value="#F4A046" />
          <Swatch name="Cream" varName="--brand-cream" value="#FFE9B8" />
        </div>
      </section>

      <section style={section}>
        <h2 style={h}>Warm neutral ramp</h2>
        <div style={grid}>
          <Swatch name="ink 1000" varName="--ink-1000" value="#0A0604" />
          <Swatch name="ink 900" varName="--ink-900" value="#18100C" />
          <Swatch name="ink 800" varName="--ink-800" value="#221812" />
          <Swatch name="ink 700" varName="--ink-700" value="#2E2118" />
          <Swatch name="ink 500" varName="--ink-500" value="#5A483C" />
          <Swatch name="ink 400" varName="--ink-400" value="#8C7A6C" />
          <Swatch name="ink 300" varName="--ink-300" value="#B8A99B" />
          <Swatch name="ink 200" varName="--ink-200" value="#E6D9CB" />
          <Swatch name="ink 100" varName="--ink-100" value="#F5EDE2" />
          <Swatch name="paper" varName="--paper" value="#FAF3E7" />
        </div>
      </section>

      <section style={section}>
        <h2 style={h}>Semantic (theme-aware)</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px", maxWidth: "56ch" }}>
          These remap with the theme toolbar — switch dark/light to see them invert.
        </p>
        <div style={grid}>
          <Swatch name="bg" varName="--bg" value="var(--bg)" />
          <Swatch name="surface" varName="--surface" value="var(--surface)" />
          <Swatch name="elevated" varName="--elevated" value="var(--elevated)" />
          <Swatch name="text" varName="--text" value="var(--text)" />
          <Swatch name="muted" varName="--muted" value="var(--muted)" />
          <Swatch name="accent" varName="--accent" value="var(--accent)" />
        </div>
      </section>

      <section style={section}>
        <h2 style={h}>Status palette</h2>
        <div style={grid}>
          {STATUSES.map((s) => (
            <Swatch key={s} name={STATUS_LABEL[s]} varName={`status-${s}`} value={STATUS_COLOR[s].fg} />
          ))}
        </div>
      </section>
    </div>
  ),
};
