import type { Meta, StoryObj } from "@storybook/react";
import { TextField } from "./TextField";

const meta = {
  title: "Atoms/TextField",
  component: TextField,
  tags: ["autodocs"],
  args: { label: "Event name", placeholder: "Kiasmos — live" },
} satisfies Meta<typeof TextField>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div style={{ width: 320 }}><TextField {...args} /></div> };

export const Row: Story = {
  render: () => (
    <div style={{ width: 360, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <TextField label="Date" placeholder="2026-09-12" />
      <TextField label="Capacity" placeholder="1,200" />
    </div>
  ),
};

export const NoLabel: Story = { args: { label: undefined }, render: (args) => <div style={{ width: 320 }}><TextField {...args} /></div> };
