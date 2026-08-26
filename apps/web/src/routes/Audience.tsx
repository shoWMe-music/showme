import { type AvatarTone, EmptyState, Icon, SectionHeader } from "@showme/design-system";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { AudienceCard } from "../components";

/** A fan/audience-CRM contact: a ticket buyer, newsletter subscriber or social
 * follower, tagged by city + tier. Shape mirrors the prototype's card. */
interface AudienceContact {
  id: string;
  name: string;
  email: string;
  initials: string;
  tone: AvatarTone;
  /** City + tier chips (e.g. "Berlin", "VIP", "Superfan"). */
  tags: string[];
  eventsCount: number;
  source: string;
}

type ViewMode = "grid" | "list";

/** There is no operator audience/RSVP read endpoint yet — the `audience_rsvps`
 * table has no GET for operators, and the generated client only exposes the
 * public `POST /events/:id/rsvp`. So this list is honestly empty: fans appear
 * once a `GET /profiles/:id/audience` (or `/events/:id/audience`) endpoint is
 * added and wired here in place of this constant. NO mock contacts. */
const CONTACTS: AudienceContact[] = [];

export function Audience() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";
  const [view, setView] = useState<ViewMode>("grid");

  const contacts = CONTACTS;
  const count = contacts.length;

  return (
    <>
      <SectionHeader
        eyebrow="CRM"
        title="Audience"
        subtitle={`${count} ${count === 1 ? "contact" : "contacts"} across ticket buyers, newsletter and socials.`}
        actions={
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              padding: 3,
              borderRadius: 12,
              background: "var(--shape-fill)",
              border: "1px solid var(--border)",
            }}
          >
            <ViewButton label="Grid view" active={view === "grid"} onClick={() => setView("grid")}>
              <Icon name="grid" size={16} />
            </ViewButton>
            <ViewButton label="List view" active={view === "list"} onClick={() => setView("list")}>
              <ListIcon />
            </ViewButton>
          </div>
        }
      />

      {!profileId ? (
        <EmptyState icon={<Icon name="users" />} title="No profile selected" />
      ) : count === 0 ? (
        <EmptyState
          icon={<Icon name="users" />}
          title="No audience yet"
          description="Fans appear here once they RSVP or buy tickets — segmented by city, tier and source."
        />
      ) : (
        <div
          style={
            view === "grid"
              ? {
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 16,
                }
              : { display: "flex", flexDirection: "column", gap: 12 }
          }
        >
          {contacts.map((contact) => (
            <AudienceCard
              key={contact.id}
              name={contact.name}
              email={contact.email}
              initials={contact.initials}
              tone={contact.tone}
              tags={contact.tags}
              eventsCount={contact.eventsCount}
              source={contact.source}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** A single icon toggle in the grid/list switcher. Active fills with a soft
 * brand-red tint; inactive stays muted — both derived from tokens so the two
 * themes track automatically. */
function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 30,
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        background: active
          ? "color-mix(in srgb, var(--brand-red) 14%, transparent)"
          : "transparent",
        color: active ? "var(--brand-red)" : "var(--muted)",
      }}
    >
      {children}
    </button>
  );
}

/** List/rows glyph — the design-system icon set has no "list", so this small
 * inline SVG matches the Icon component's stroke conventions and currentColor. */
function ListIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      <line x1="4" y1="6" x2="4" y2="6" />
      <line x1="4" y1="12" x2="4" y2="12" />
      <line x1="4" y1="18" x2="4" y2="18" />
    </svg>
  );
}
