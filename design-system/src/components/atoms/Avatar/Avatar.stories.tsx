import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./Avatar";

const meta = {
  title: "Atoms/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  args: { initials: "NF", tone: "amber", shape: "square", size: 44 },
  argTypes: {
    tone: { control: "inline-radio", options: ["amber", "green", "purple", "blue", "brand"] },
    shape: { control: "inline-radio", options: ["square", "circle"] },
  },
} satisfies Meta<typeof Avatar>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar initials="NF" tone="amber" />
      <Avatar initials="KI" tone="green" />
      <Avatar initials="PA" tone="purple" />
      <Avatar initials="LV" tone="blue" />
      <Avatar initials="RK" tone="brand" />
    </div>
  ),
};

export const Shapes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar initials="SV" shape="square" tone="purple" />
      <Avatar initials="SV" shape="circle" tone="purple" />
      <Avatar initials="SV" shape="circle" tone="brand" size={34} />
    </div>
  ),
};
