import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "./Spinner";
import { Button } from "@/components/atoms/Button/Button";

const meta = {
  title: "Atoms/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  args: { size: 20 },
} satisfies Meta<typeof Spinner>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
      <Spinner size={16} />
      <Spinner size={24} />
      <Spinner size={40} />
    </div>
  ),
};

export const InButton: Story = {
  render: () => (
    <Button disabled leftIcon={<Spinner size={15} />}>Saving…</Button>
  ),
};
