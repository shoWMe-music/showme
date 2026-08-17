import { Avatar, type AvatarTone, Card, Tag } from "@showme/design-system";

/** A centered audience/CRM person card (§12): round avatar → name → email →
 * tag chips (city + tier) → divider → mono footer "N events · {source}".
 * Presentational. */
export interface AudienceCardProps {
  name: string;
  email: string;
  initials: string;
  tone?: AvatarTone;
  tags?: string[];
  eventsCount: number;
  source: string;
  onClick?: () => void;
}

export function AudienceCard({
  name,
  email,
  initials,
  tone,
  tags,
  eventsCount,
  source,
  onClick,
}: AudienceCardProps) {
  return (
    <Card
      padding="lg"
      interactive={Boolean(onClick)}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        textAlign: "center",
      }}
    >
      <Avatar initials={initials} tone={tone ?? "brand"} shape="circle" size={56} />
      <span style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--text)" }}>
        {name}
      </span>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{email}</span>
      {tags && tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
          {tags.map((tag) => (
            <Tag key={tag} tone="accent">
              {tag}
            </Tag>
          ))}
        </div>
      )}
      <div style={{ width: "100%", height: 1, background: "var(--border)", margin: "6px 0 2px" }} />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.04em",
          color: "var(--dim)",
        }}
      >
        {eventsCount} events · {source}
      </span>
    </Card>
  );
}
