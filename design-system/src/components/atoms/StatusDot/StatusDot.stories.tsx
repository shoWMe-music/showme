import type { Meta, StoryObj } from "@storybook/react";
import { StatusDot } from "./StatusDot";
import { STATUSES, STATUS_LABEL } from "@/lib/status";

const meta = {
  title: "Atoms/StatusDot",
  component: StatusDot,
  tags: ["autodocs"],
  args: { status: "confirmed", size: 10 },
} satisfies Meta<typeof StatusDot>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Legend: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8 }}>
      {STATUSES.map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot status={s} size={10} />
          <span style={{ fontSize: 13 }}>{STATUS_LABEL[s]}</span>
        </div>
      ))}
    </div>
  ),
};
