import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Stepper } from "./Stepper";
import { Button } from "@/components/atoms/Button/Button";

const STEPS = ["Your Role", "Event Details", "Deal Structure"];

const meta = {
  title: "Molecules/Stepper",
  component: Stepper,
  tags: ["autodocs"],
  args: { steps: STEPS, active: 1 },
} satisfies Meta<typeof Stepper>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <div style={{ width: 520 }}><Stepper {...args} /></div> };

export const Interactive: Story = {
  render: () => {
    const [active, setActive] = useState(0);
    return (
      <div style={{ width: 520, display: "grid", gap: 20 }}>
        <Stepper steps={STEPS} active={active} />
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="secondary" onClick={() => setActive((step) => Math.max(0, step - 1))}>Back</Button>
          <Button onClick={() => setActive((step) => Math.min(STEPS.length - 1, step + 1))}>Continue</Button>
        </div>
      </div>
    );
  },
};
