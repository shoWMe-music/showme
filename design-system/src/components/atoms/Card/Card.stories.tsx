import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card";
import { Tag } from "@/components/atoms/Tag/Tag";

const meta = {
  title: "Atoms/Card",
  component: Card,
  tags: ["autodocs"],
  args: { padding: "md", interactive: false, elevated: false },
  argTypes: { padding: { control: "inline-radio", options: ["none", "sm", "md", "lg"] } },
} satisfies Meta<typeof Card>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div style={{ width: 340 }}>
      <Card {...args}>
        <Tag tone="dim">Contact card</Tag>
        <div style={{ marginTop: 8, fontWeight: 600, fontSize: 16 }}>Nils Frahm</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Performer · Berlin</div>
      </Card>
    </div>
  ),
};

export const Interactive: Story = {
  args: { interactive: true },
  render: (args) => (
    <div style={{ width: 340 }}>
      <Card {...args}>
        <div style={{ fontWeight: 600 }}>Hover me</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Lifts + accent border on hover.</div>
      </Card>
    </div>
  ),
};
