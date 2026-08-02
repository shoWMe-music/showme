import type { Meta, StoryObj } from "@storybook/react";
import { Tag } from "./Tag";

const meta = {
  title: "Atoms/Tag",
  component: Tag,
  tags: ["autodocs"],
  args: { children: "01 — Foundations", tone: "muted" },
  argTypes: { tone: { control: "inline-radio", options: ["muted", "accent", "dim"] } },
} satisfies Meta<typeof Tag>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 20 }}>
      <Tag tone="muted">Deal structure</Tag>
      <Tag tone="accent">Clash Display</Tag>
      <Tag tone="dim">--brand-red</Tag>
    </div>
  ),
};
