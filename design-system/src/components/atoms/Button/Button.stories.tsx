import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { Icon } from "@/icons";

const meta = {
  title: "Atoms/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "New event" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost", "cta"] },
  },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: "primary", leftIcon: <Icon name="plus" size={15} strokeWidth={2.2} /> },
};
export const Secondary: Story = { args: { variant: "secondary", children: "Secondary" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Ghost" } };
export const CTA: Story = {
  args: { variant: "cta", children: "Propose representation", leftIcon: <Icon name="plus" size={15} strokeWidth={2.4} /> },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="primary" leftIcon={<Icon name="plus" size={15} strokeWidth={2.2} />}>
        New event
      </Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="cta" leftIcon={<Icon name="plus" size={15} strokeWidth={2.4} />}>
        Propose representation
      </Button>
      <Button variant="primary" disabled>Disabled</Button>
    </div>
  ),
};
