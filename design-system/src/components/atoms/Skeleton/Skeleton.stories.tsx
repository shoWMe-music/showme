import type { Meta, StoryObj } from "@storybook/react";
import { Skeleton } from "./Skeleton";
import { Card } from "@/components/atoms/Card/Card";

const meta = {
  title: "Atoms/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  args: { width: 220, height: 14 },
} satisfies Meta<typeof Skeleton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Line: Story = {};

export const Shapes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Skeleton circle width={44} />
      <Skeleton width={120} height={12} />
      <Skeleton width={64} height={64} radius={14} />
      <Skeleton width={90} height={30} radius={999} />
    </div>
  ),
};

/** Skeleton of a contact card — the shape the real card fills in. */
export const CardSkeleton: Story = {
  render: () => (
    <Card style={{ width: 340 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Skeleton circle width={40} />
        <div style={{ display: "grid", gap: 8 }}>
          <Skeleton width={140} height={13} />
          <Skeleton width={100} height={11} />
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <Skeleton width="100%" height={12} />
        <Skeleton width="80%" height={12} />
        <Skeleton width={90} height={24} radius={999} />
      </div>
    </Card>
  ),
};
