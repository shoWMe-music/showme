import type { Meta, StoryObj } from "@storybook/react";
import { SectionHeader } from "./SectionHeader";
import { Button } from "@/components/atoms/Button/Button";
import { Icon } from "@/icons";

const meta = {
  title: "Molecules/SectionHeader",
  component: SectionHeader,
  tags: ["autodocs"],
} satisfies Meta<typeof SectionHeader>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    eyebrow: "Agents & Performers",
    title: "Your roster,",
    accent: "in one place",
    subtitle: "Represented artists, their agreements, and deals in flight.",
    actions: <Button leftIcon={<Icon name="plus" size={15} strokeWidth={2.2} />}>Add artist</Button>,
  },
};

export const TitleOnly: Story = { args: { title: "Settings" } };
