import type { Meta, StoryObj } from "@storybook/react";
import { ContactCard } from "./ContactCard";

const meta = {
  title: "Organisms/ContactCard",
  component: ContactCard,
  tags: ["autodocs"],
  args: {
    name: "Nils Frahm",
    role: "Performer · Felix Wiesel (mgmt)",
    initials: "NF",
    tone: "amber",
    email: "mgmt@nilsfrahm.com",
    verified: true,
    linkedProfile: { handle: "@nilsfrahm", rating: 4.9, kind: "Performer" },
  },
} satisfies Meta<typeof ContactCard>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Verified: Story = {};
export const Unverified: Story = {
  args: { verified: false, initials: "PA", tone: "purple", name: "Paradigm Agency", role: "Agent", linkedProfile: undefined },
};
