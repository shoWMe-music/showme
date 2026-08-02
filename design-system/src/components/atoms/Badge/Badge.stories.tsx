import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge";
import { STATUSES, STATUS_LABEL } from "@/lib/status";

const meta = {
  title: "Atoms/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: { children: "Confirmed", status: "confirmed", dot: true },
} satisfies Meta<typeof Badge>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
      {STATUSES.map((s) => (
        <Badge key={s} status={s} dot>
          {STATUS_LABEL[s]}
        </Badge>
      ))}
      <Badge>Neutral</Badge>
    </div>
  ),
};

export const RealWorld: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
      <Badge status="confirmed" dot>IBAN verified</Badge>
      <Badge status="pending" dot>Unverified</Badge>
      <Badge status="suggested">Pending</Badge>
      <Badge status="cancelled" dot>Overdue</Badge>
    </div>
  ),
};
