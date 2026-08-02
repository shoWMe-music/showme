import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar";

const meta = {
  title: "Atoms/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  args: { value: 68, label: "Ticket sales", showValue: true },
} satisfies Meta<typeof ProgressBar>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div style={{ width: 320 }}><ProgressBar {...args} /></div> };

export const Stack: Story = {
  render: () => (
    <div style={{ width: 320, display: "grid", gap: 18 }}>
      <ProgressBar value={92} label="Capacity sold" showValue status="confirmed" />
      <ProgressBar value={54} label="Settlement complete" showValue status="pending" />
      <ProgressBar value={20} label="Riders received" showValue status="hold" />
    </div>
  ),
};
