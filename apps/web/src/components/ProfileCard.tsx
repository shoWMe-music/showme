import { Avatar, Badge, Button, Card, Icon } from "@showme/design-system";

/** A venue/brand profile card on the My Profiles screen (§13): logo avatar,
 * name + kind + city, a couple of stats, a published badge, and edit / view
 * public actions. Presentational. */
export interface ProfileStat {
  label: string;
  value: string;
}

export interface ProfileCardProps {
  name: string;
  /** e.g. "Venue" or "Promoter brand". */
  kind: string;
  city?: string;
  /** Brand colour driving the logo tile. */
  color?: string;
  published: boolean;
  stats?: ProfileStat[];
  logoInitials?: string;
  onEdit?: () => void;
  onViewPublic?: () => void;
}

export function ProfileCard({
  name,
  kind,
  city,
  color,
  published,
  stats,
  logoInitials,
  onEdit,
  onViewPublic,
}: ProfileCardProps) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar
          initials={logoInitials ?? name.slice(0, 2).toUpperCase()}
          tone="brand"
          shape="square"
          size={44}
          style={color ? { background: color, color: "#fff" } : undefined}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontFamily: "var(--font-display)",
              fontSize: 17,
              color: "var(--text)",
            }}
          >
            {name}
          </span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {kind}
            {city ? ` · ${city}` : ""}
          </span>
        </div>
        <Badge status={published ? "confirmed" : "draft"} dot>
          {published ? "Published" : "Unpublished"}
        </Badge>
      </div>

      {stats && stats.length > 0 && (
        <div style={{ display: "flex", gap: 24 }}>
          {stats.map((stat) => (
            <div key={stat.label} style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text)" }}
              >
                {stat.value}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--dim)",
                }}
              >
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {onEdit && (
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
        )}
        {onViewPublic && (
          <Button
            variant="ghost"
            rightIcon={<Icon name="arrow-right" size={14} />}
            onClick={onViewPublic}
          >
            View public page
          </Button>
        )}
      </div>
    </Card>
  );
}
