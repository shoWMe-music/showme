import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SelectCard } from "./SelectCard";
import { Icon } from "@/icons";

const meta = {
  title: "Molecules/SelectCard",
  component: SelectCard,
  tags: ["autodocs"],
  args: { title: "Venue", description: "You own the room — you host and settle.", selected: true, icon: <Icon name="building" size={20} /> },
} satisfies Meta<typeof SelectCard>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div style={{ width: 380 }}><SelectCard {...args} /></div> };

const ROLES = [
  { key: "venue", icon: "building", title: "Venue", description: "You own the room — you host and settle." },
  { key: "promoter", icon: "star", title: "Promoter", description: "You book the talent and carry the risk." },
  { key: "organizer", icon: "calendar", title: "Organizer", description: "You run the event end to end." },
] as const;

/** Single-choice group — the wizard's role picker. */
export const RolePicker: Story = {
  render: () => {
    const [selected, setSelected] = useState("venue");
    return (
      <div style={{ width: 380, display: "grid", gap: 10 }}>
        {ROLES.map((role) => (
          <SelectCard
            key={role.key}
            icon={<Icon name={role.icon} size={20} />}
            title={role.title}
            description={role.description}
            selected={selected === role.key}
            onSelect={() => setSelected(role.key)}
          />
        ))}
      </div>
    );
  },
};
