import type { Meta, StoryObj } from "@storybook/react";

const meta = { title: "Foundations/Typography", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj;

function Row({ family, meta, sample, style }: { family: string; meta: string; sample: string; style: React.CSSProperties }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: "22px 24px", background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginBottom: 12 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--accent)" }}>{family}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--dim)" }}>{meta}</span>
      </div>
      <div style={style}>{sample}</div>
    </div>
  );
}

export const Voices: Story = {
  render: () => (
    <div style={{ padding: 32, background: "var(--bg)", minHeight: "100vh", color: "var(--text)", display: "grid", gap: 14, maxWidth: 820 }}>
      <Row family="Clash Display" meta="Display · 500 / 600 · headings" sample="Good evening, Sarah"
        style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 42, letterSpacing: "-.03em", lineHeight: 1.05 }} />
      <Row family="Instrument Serif" meta="Serif · italic · expressive accent" sample="the events industry"
        style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400, fontSize: 42, lineHeight: 1.05, color: "var(--accent)" }} />
      <Row family="Inter Tight" meta="Sans · 400 / 500 / 600 · body & UI" sample="Manage booking requests from artists, agents, and venues — with verified payout details and one-tap settlements."
        style={{ fontSize: 19, lineHeight: 1.5 }} />
      <Row family="JetBrains Mono" meta="Mono · labels, IBANs, figures" sample="DE89 3704 0044 0532 0130 00"
        style={{ fontFamily: "var(--font-mono)", fontSize: 18 }} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 28, padding: "22px 24px", border: "1px solid var(--border)", borderRadius: 16 }}>
        {[52, 34, 24, 17, 13].map((n) => (
          <div key={n} style={{ fontFamily: n > 24 ? "var(--font-display)" : "var(--font-sans)", fontWeight: 600, fontSize: n, letterSpacing: n > 24 ? "-.03em" : 0, lineHeight: 1 }}>
            Aa<span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted)", fontWeight: 400, letterSpacing: 0 }}> {n}</span>
          </div>
        ))}
      </div>
    </div>
  ),
};
