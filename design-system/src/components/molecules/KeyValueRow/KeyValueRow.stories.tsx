import type { Meta, StoryObj } from "@storybook/react";
import { KeyValueRow } from "./KeyValueRow";
import { Card } from "@/components/atoms/Card/Card";
import { Tag } from "@/components/atoms/Tag/Tag";

const meta = {
  title: "Molecules/KeyValueRow",
  component: KeyValueRow,
  tags: ["autodocs"],
  args: { label: "Total ticket revenue", value: "€10,000", mono: true },
} satisfies Meta<typeof KeyValueRow>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div style={{ width: 360 }}><KeyValueRow {...args} /></div> };

export const SettlementBreakdown: Story = {
  render: () => (
    <Card style={{ width: 360 }}>
      <Tag tone="dim">Settlement · Nils Frahm</Tag>
      <div style={{ marginTop: 10 }}>
        <KeyValueRow label="Guarantee" value="€3,000" mono />
        <KeyValueRow label="Collected at door" value="€0" mono />
        <KeyValueRow label="Deductibles (hotel)" value="−€240" mono valueColor="#EE5746" />
        <KeyValueRow label="Net owed" value="€2,760" mono total valueColor="#6FC97A" />
      </div>
    </Card>
  ),
};
