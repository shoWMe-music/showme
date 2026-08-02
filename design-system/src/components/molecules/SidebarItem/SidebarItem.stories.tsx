import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SidebarItem } from "./SidebarItem";
import { Icon, type IconName } from "@/icons";

const meta = {
  title: "Molecules/SidebarItem",
  component: SidebarItem,
  tags: ["autodocs"],
  args: { label: "Dashboard", active: true, icon: <Icon name="grid" /> },
} satisfies Meta<typeof SidebarItem>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const NAV: { icon: IconName; label: string; badge?: number }[] = [
  { icon: "grid", label: "Dashboard" },
  { icon: "users", label: "Agents & Performers" },
  { icon: "calendar", label: "Calendar" },
  { icon: "mail", label: "Contacts", badge: 3 },
  { icon: "file", label: "Settlements" },
  { icon: "settings", label: "Settings" },
];

export const Navigation: Story = {
  render: () => {
    const [active, setActive] = useState("Dashboard");
    // The active marker sits at left:-14px, so the rail needs left padding ≥14px.
    return (
      <div style={{ width: 248, display: "grid", gap: 2, padding: "12px 12px 12px 18px", background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)" }}>
        {NAV.map((n) => (
          <SidebarItem key={n.label} icon={<Icon name={n.icon} />} label={n.label} badge={n.badge} active={active === n.label} onClick={() => setActive(n.label)} />
        ))}
      </div>
    );
  },
};

export const Collapsed: Story = {
  render: () => (
    <div style={{ width: 68, display: "grid", gap: 2, padding: 10, background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)" }}>
      {NAV.map((n, i) => (
        <SidebarItem key={n.label} icon={<Icon name={n.icon} />} label={n.label} collapsed active={i === 0} />
      ))}
    </div>
  ),
};
