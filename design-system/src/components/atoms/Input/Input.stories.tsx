import type { Meta, StoryObj } from "@storybook/react";
import { Input, SearchInput } from "./Input";
import { Icon } from "@/icons";

const meta = {
  title: "Atoms/Input",
  component: Input,
  tags: ["autodocs"],
  args: { placeholder: "Venue name" },
} satisfies Meta<typeof Input>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div style={{ width: 320 }}><Input {...args} /></div> };

export const Search: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <SearchInput trailing="⌘K" />
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <Input leftIcon={<Icon name="mail" size={16} strokeWidth={2} />} placeholder="you@email.com" />
    </div>
  ),
};
