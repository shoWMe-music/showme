import type { Meta, StoryObj } from "@storybook/react";
import { ListRow } from "./ListRow";
import { Badge } from "@/components/atoms/Badge/Badge";
import { Avatar } from "@/components/atoms/Avatar/Avatar";
import { Icon } from "@/icons";

const meta = {
  title: "Molecules/ListRow",
  component: ListRow,
  tags: ["autodocs"],
  args: { title: "Row" },
} satisfies Meta<typeof ListRow>;
export default meta;

type Story = StoryObj<typeof meta>;

const iconTile = (
  <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "color-mix(in srgb, #F4A046 16%, transparent)", color: "#F4A046" }}>
    <Icon name="alert" size={18} />
  </span>
);

export const AttentionItem: Story = {
  render: () => (
    <div style={{ width: 460 }}>
      <ListRow
        leading={iconTile}
        title="Send Nils Frahm settlement"
        meta="Auto-created on conclusion — awaiting your send"
        trailing={<Badge status="pending">Send</Badge>}
      />
    </div>
  ),
};

export const ContactList: Story = {
  render: () => (
    <div style={{ width: 460, display: "grid", gap: 8 }}>
      <ListRow interactive leading={<Avatar initials="NF" tone="amber" size={36} />} title="Nils Frahm" meta="Performer · Berlin" trailing={<Badge status="confirmed" dot>Verified</Badge>} />
      <ListRow interactive leading={<Avatar initials="KI" tone="green" size={36} />} title="Kiasmos" meta="Performer · Reykjavík" trailing={<Icon name="chevron-right" size={16} />} />
    </div>
  ),
};
