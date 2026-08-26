import { TabPanels } from "@/components/molecules/Tabs/TabPanels";
import { Tabs } from "@/components/molecules/Tabs/Tabs";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

const meta = { title: "Foundations/Motion", parameters: { layout: "fullscreen" } } satisfies Meta;
export default meta;
type Story = StoryObj;

const DURATIONS: { token: string; milliseconds: number; intent: string }[] = [
  {
    token: "--duration-instant",
    milliseconds: 90,
    intent: "The press. Feedback under a finger already down.",
  },
  {
    token: "--duration-quick",
    milliseconds: 140,
    intent: "A paint-only change: color, border, a menu under its trigger.",
  },
  {
    token: "--duration-base",
    milliseconds: 200,
    intent: "Something moves. The default — and the interaction ceiling.",
  },
  {
    token: "--duration-slow",
    milliseconds: 280,
    intent: "A surface arriving on its own: modal, toast, whole view.",
  },
];

const page = {
  padding: 32,
  background: "var(--bg)",
  minHeight: "100vh",
  color: "var(--text)",
  display: "grid",
  gap: 16,
} as const;
const card = { border: "1px solid var(--border)", borderRadius: 16, padding: 24 } as const;
const heading = {
  fontFamily: "var(--font-display)",
  fontWeight: 600,
  fontSize: 18,
  marginBottom: 6,
} as const;
const note = { fontSize: 13, color: "var(--muted)", marginBottom: 20, maxWidth: 620 } as const;
const mono = { fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)" } as const;

/** Send every dot across at once — the four speeds are only meaningful next to
 * each other, and one of them being visibly slower than the rest is the point. */
function DurationScale() {
  const [running, setRunning] = useState(false);
  return (
    <div style={card}>
      <div style={heading}>Duration</div>
      <p style={note}>
        Four durations, picked by intent rather than by taste. Run them together, then run them
        back. Under <code>prefers-reduced-motion</code> every one of these tokens becomes{" "}
        <code>0ms</code>, which is why nothing built from them needs its own media query.
      </p>
      <button
        type="button"
        onClick={() => setRunning((value) => !value)}
        style={{
          marginBottom: 18,
          padding: "9px 16px",
          borderRadius: 999,
          border: "1px solid var(--border-strong)",
          background: "var(--button-surface)",
          color: "var(--text)",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {running ? "Send them back" : "Run all four"}
      </button>
      <div style={{ display: "grid", gap: 14 }}>
        {DURATIONS.map(({ token, milliseconds, intent }) => (
          <div
            key={token}
            style={{
              display: "grid",
              gridTemplateColumns: "170px 1fr",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ ...mono, color: "var(--text)" }}>{token}</div>
              <div style={mono}>{milliseconds}ms</div>
            </div>
            <div
              style={{
                position: "relative",
                height: 26,
                borderRadius: 999,
                background: "var(--elevated)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  left: running ? "calc(100% - 22px)" : "4px",
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: "linear-gradient(135deg, #EE5746, #F4A046)",
                  transition: `left var(${token}) var(--ease-out)`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  ...mono,
                }}
              >
                {intent}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The tab panel scoot: click a tab and the content enters from the side the tab
 * moved. Click left-to-right, then right-to-left — the direction has to agree
 * with the bar or the motion reads worse than none. */
function PanelScoot() {
  const tabs = [
    { key: "one", label: "First" },
    { key: "two", label: "Second" },
    { key: "three", label: "Third" },
    { key: "four", label: "Fourth" },
  ];
  const [active, setActive] = useState("one");
  return (
    <div style={card}>
      <div style={heading}>TabPanels — the scoot</div>
      <p style={note}>
        The indicator slides and the panel enters from the same side, both on{" "}
        <code>--duration-base</code>. The incoming panel is hit-testable from its first frame: the
        fade never gates a click.
      </p>
      <Tabs tabs={tabs} value={active} onChange={setActive} />
      <TabPanels activeKey={active} order={tabs.map((tab) => tab.key)} style={{ paddingTop: 20 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 600 }}>
          {tabs.find((tab) => tab.key === active)?.label} panel
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 520 }}>
          Jump from First straight to Fourth and back: forward pulls the panel in from the right,
          backward from the left, however many tabs are skipped.
        </p>
      </TabPanels>
    </div>
  );
}

export const Motion: Story = {
  render: () => (
    <div style={page}>
      <DurationScale />
      <PanelScoot />
    </div>
  ),
};
