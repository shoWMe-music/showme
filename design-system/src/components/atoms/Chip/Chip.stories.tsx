import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Chip } from "./Chip";

const meta = {
  title: "Atoms/Chip",
  component: Chip,
  tags: ["autodocs"],
  args: { children: "Performers", active: false },
} satisfies Meta<typeof Chip>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Active: Story = { args: { active: true, children: "All" } };

export const FilterRow: Story = {
  render: () => {
    const items = ["All", "Performers", "Agents", "Venues"];
    const [sel, setSel] = useState("All");
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {items.map((i) => (
          <Chip key={i} active={sel === i} onClick={() => setSel(i)}>
            {i}
          </Chip>
        ))}
      </div>
    );
  },
};
