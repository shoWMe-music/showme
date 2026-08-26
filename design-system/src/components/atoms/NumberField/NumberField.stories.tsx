import { TextField } from "@/components/atoms/TextField/TextField";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { NumberField } from "./NumberField";

const meta: Meta<typeof NumberField> = {
  title: "Atoms/NumberField",
  component: NumberField,
  tags: ["autodocs"],
};
export default meta;

type Story = StoryObj<typeof NumberField>;

function Controlled({
  initial,
  ...props
}: { initial: number | null } & Omit<
  React.ComponentProps<typeof NumberField>,
  "value" | "onChange"
>) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <div style={{ width: 300, display: "grid", gap: 8 }}>
      <NumberField {...props} value={value} onChange={setValue} />
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
        value = {value === null ? "null" : String(value)}
      </code>
    </div>
  );
}

/** Empty means empty: the placeholder shows and the value is `null`. */
export const Empty: Story = {
  render: () => <Controlled initial={null} label="Capacity" placeholder="e.g. 400" decimals={0} />,
};

/** Zero is a value in its own right and renders as `0`. */
export const Zero: Story = {
  render: () => (
    <Controlled initial={0} label="Guarantee" placeholder="0.00" leftIcon="€" align="right" />
  ),
};

/** Side by side with the pattern this replaces. The left field is the old
 * `TextField type="number"` seeded with a `0` stand-in for "not set" — the `0`
 * the user has to select and delete before typing. The right field starts
 * genuinely empty. */
export const EmptyVersusZeroDefaulting: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 18, width: 640 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <TextField
          label="Before — 0 defaulting"
          type="number"
          value={0}
          placeholder="e.g. 400"
          readOnly
        />
        <Controlled initial={null} label="After — empty" placeholder="e.g. 400" decimals={0} />
      </div>
    </div>
  ),
};

/** Money: a currency prefix inside the same frame, two decimals, right-aligned. */
export const Money: Story = {
  render: () => (
    <Controlled initial={null} label="Guarantee" placeholder="0.00" leftIcon="€" align="right" />
  ),
};

/** Integers only, clamped to a range. Arrow keys step; blur clamps. */
export const IntegerRange: Story = {
  render: () => (
    <Controlled initial={null} label="Tickets" placeholder="1" decimals={0} min={1} max={10} />
  ),
};

/** The field is genuinely controlled: a value pushed in from outside — a form
 * reset, a server value arriving — replaces what is in the box, including
 * resetting it to empty. (The ad-hoc numeric inputs this replaces seeded their
 * local text once and then ignored the prop.) */
export const ExternallyReset: Story = {
  render: function ExternallyResetStory() {
    const [value, setValue] = useState<number | null>(null);
    return (
      <div style={{ width: 300, display: "grid", gap: 10 }}>
        <NumberField
          label="Capacity"
          placeholder="e.g. 400"
          decimals={0}
          value={value}
          onChange={setValue}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setValue(400)}>
            Set to 400
          </button>
          <button type="button" onClick={() => setValue(0)}>
            Set to 0
          </button>
          <button type="button" onClick={() => setValue(null)}>
            Clear
          </button>
        </div>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
          value = {value === null ? "null" : String(value)}
        </code>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => <Controlled initial={1200} label="Capacity" disabled decimals={0} />,
};
