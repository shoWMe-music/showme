import { Avatar, type AvatarTone, Badge, Icon, ListRow, Tag } from "@showme/design-system";

/** A member row on the Team screen (§10): avatar + name + presence dot +
 * account-state badge + email, group chips, and a right-side role/access +
 * overflow menu. Built on the DS `ListRow` with a rich trailing slot.
 * Presentational. */
export type TeamAccountState = "on_platform" | "contact";
export type TeamPresence = "online" | "away" | "offline";

export interface TeamMember {
  name: string;
  email: string;
  initials: string;
  tone?: AvatarTone;
}

export interface TeamMemberRowProps {
  member: TeamMember;
  roleTitle: string;
  accessLevel: string;
  groups?: string[];
  presence?: TeamPresence;
  accountState: TeamAccountState;
  onMenu?: () => void;
}

const PRESENCE_COLOR: Record<TeamPresence, string> = {
  online: "#6FC97A",
  away: "#F4A046",
  offline: "var(--dim)",
};

export function TeamMemberRow({
  member,
  roleTitle,
  accessLevel,
  groups,
  presence,
  accountState,
  onMenu,
}: TeamMemberRowProps) {
  const leading = (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <Avatar initials={member.initials} tone={member.tone ?? "brand"} size={36} />
      {presence && (
        <span
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: PRESENCE_COLOR[presence],
            border: "2px solid var(--card)",
          }}
        />
      )}
    </span>
  );

  const title = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {member.name}
      <Badge status={accountState === "on_platform" ? "confirmed" : "pending"} dot>
        {accountState === "on_platform" ? "On shoWMe" : "Contact"}
      </Badge>
    </span>
  );

  const meta = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>{member.email}</span>
      {groups?.map((group) => (
        <Tag key={group} tone="muted">
          {group}
        </Tag>
      ))}
    </span>
  );

  const trailing = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span style={{ textAlign: "right" }}>
        <span style={{ display: "block", color: "var(--text)", fontSize: 13 }}>{roleTitle}</span>
        <span style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>{accessLevel}</span>
      </span>
      {onMenu && (
        <button type="button" aria-label="Member menu" onClick={onMenu} style={menuButtonStyle}>
          <Icon name="dots-vertical" size={16} />
        </button>
      )}
    </span>
  );

  return <ListRow leading={leading} title={title} meta={meta} trailing={trailing} />;
}

const menuButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
} as const;
