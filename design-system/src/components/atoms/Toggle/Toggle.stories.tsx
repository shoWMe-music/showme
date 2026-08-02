import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toggle } from "./Toggle";

const meta = {
  title: "Atoms/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  args: { checked: true, label: "Setting" },
} satisfies Meta<typeof Toggle>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [on, setOn] = useState(args.checked);
    return <Toggle {...args} checked={on} onChange={setOn} />;
  },
};

export const SettingsRows: Story = {
  render: () => {
    const [state, setState] = useState({ email: true, twoFactor: false, dark: true });
    const rows: [keyof typeof state, string][] = [
      ["email", "Email notifications"],
      ["twoFactor", "Two-factor authentication"],
      ["dark", "Dark appearance"],
    ];
    return (
      <div style={{ width: 340, display: "grid", gap: 4 }}>
        {rows.map(([key, label]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12 }}>
            <span style={{ fontSize: 13.5 }}>{label}</span>
            <Toggle label={label} checked={state[key]} onChange={(v) => setState((s) => ({ ...s, [key]: v }))} />
          </div>
        ))}
      </div>
    );
  },
};
