import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Tabs, type TabItem } from "./Tabs";

const EVENT_TABS: TabItem[] = [
  { key: "overview", label: "Overview" },
  { key: "deal", label: "Deal" },
  { key: "budget", label: "Budget" },
  { key: "settlement", label: "Settlement" },
  { key: "schedule", label: "Schedule" },
  { key: "riders", label: "Riders" },
  { key: "messages", label: "Messages" },
];

const meta = {
  title: "Molecules/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  args: { tabs: EVENT_TABS },
} satisfies Meta<typeof Tabs>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The event-details tabs — controlled, with content below. */
export const EventDetails: Story = {
  render: () => {
    const [active, setActive] = useState("overview");
    return (
      <div style={{ width: 660 }}>
        <Tabs tabs={EVENT_TABS} value={active} onChange={setActive} />
        <div style={{ padding: "22px 0", color: "var(--muted)", fontSize: 14 }}>
          Content for the <strong style={{ color: "var(--text)" }}>{EVENT_TABS.find((tab) => tab.key === active)?.label}</strong> tab.
        </div>
      </div>
    );
  },
};

/** Uncontrolled — manages its own active tab. */
export const Uncontrolled: Story = {
  render: () => (
    <div style={{ width: 480 }}>
      <Tabs tabs={EVENT_TABS.slice(0, 4)} defaultValue="deal" />
    </div>
  ),
};
