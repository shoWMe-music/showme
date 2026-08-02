import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";
import { Button } from "@/components/atoms/Button/Button";
import { Icon } from "@/icons";

const meta = {
  title: "Molecules/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
  args: { title: "No represented artists yet" },
} satisfies Meta<typeof EmptyState>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <EmptyState
        icon={<Icon name="users" size={24} />}
        title="No represented artists yet"
        description="Invite a performer to build your roster, or accept an incoming representation request."
        action={<Button leftIcon={<Icon name="plus" size={15} strokeWidth={2.2} />}>Add artist</Button>}
      />
    </div>
  ),
};
