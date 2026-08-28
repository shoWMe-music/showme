import { Avatar, type AvatarTone, Card, Icon } from "@showme/design-system";

/** A team group card (§10): a coloured dot + group name, edit/remove actions,
 * a stack of member avatars, and a footer count + profile scope. Presentational. */
export interface GroupCardMember {
  id: string;
  initials: string;
  tone?: AvatarTone;
}

export interface GroupCardProps {
  name: string;
  /** Dot colour — a raw CSS colour (the group's own brand colour). */
  color: string;
  members: GroupCardMember[];
  memberCount: number;
  /** e.g. "BLACKBIRD PRESENTS" or "3 PROFILES". */
  scopeLabel: string;
  onEdit?: () => void;
  onRemove?: () => void;
}

export function GroupCard({
  name,
  color,
  members,
  memberCount,
  scopeLabel,
  onEdit,
  onRemove,
}: GroupCardProps) {
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <span style={{ flex: 1, color: "var(--text)", fontWeight: 600 }}>{name}</span>
        {onEdit && (
          <button
            type="button"
            aria-label="Edit group"
            onClick={onEdit}
            className="touch-target"
            style={iconButtonStyle}
          >
            <Icon name="settings" size={14} />
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label="Remove group"
            onClick={onRemove}
            className="touch-target"
            style={iconButtonStyle}
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center" }}>
        {members.slice(0, 6).map((member, index) => (
          <span key={member.id} style={{ marginLeft: index === 0 ? 0 : -8 }}>
            <Avatar initials={member.initials} tone={member.tone ?? "brand"} size={28} />
          </span>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{memberCount} members</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--dim)",
          }}
        >
          {scopeLabel}
        </span>
      </div>
    </Card>
  );
}

/* Touch: these two are 24px squares 8px apart, so an overlay on either would
   reach 8px into the other and REMOVE a group the reader meant to rename — the
   exact failure `styles/touch.css` warns about. They grow instead
   (`.touch-target` on each button): the header row is a flex line with a
   `flex: 1` name beside them, so the extra 20px each comes out of the name's
   slack rather than widening the card. */
const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
} as const;
