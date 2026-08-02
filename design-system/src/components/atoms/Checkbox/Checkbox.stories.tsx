import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "Atoms/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  args: { checked: true, label: "Send info email" },
} satisfies Meta<typeof Checkbox>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [checked, setChecked] = useState(args.checked);
    return <Checkbox {...args} checked={checked} onChange={setChecked} />;
  },
};

export const States: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      <Checkbox checked onChange={() => {}} label="Checked" />
      <Checkbox checked={false} onChange={() => {}} label="Unchecked" />
      <Checkbox checked disabled label="Disabled checked" />
      <Checkbox checked={false} disabled label="Disabled" />
    </div>
  ),
};
