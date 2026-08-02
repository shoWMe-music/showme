import type { Meta, StoryObj } from "@storybook/react";
import { StatCard } from "./StatCard";
import { Icon } from "@/icons";

const meta = {
  title: "Molecules/StatCard",
  component: StatCard,
  tags: ["autodocs"],
  args: { label: "Total settlement", value: "€48,200", hint: "Across 6 events this month" },
} satisfies Meta<typeof StatCard>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Grid: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 200px)", gap: 14 }}>
      <StatCard label="Commission owed" value="€6,420" hint="4 performers" icon={<Icon name="star" size={18} />} />
      <StatCard label="Deals in flight" value="12" hint="3 awaiting confirm" icon={<Icon name="file" size={18} />} />
      <StatCard label="Represented artists" value="8" icon={<Icon name="users" size={18} />} />
    </div>
  ),
};
