import { useGetApiV1ProfilesIdContacts, useGetApiV1ProfilesSearch } from "@showme/api-client";
import { Avatar, Icon, Skeleton } from "@showme/design-system";
import { type CSSProperties, useEffect, useState } from "react";
import { publicProfileUrl as publicProfileUrlFor } from "../lib/publicSite";
import { fieldStyle } from "./eventUi";

/**
 * Reusable performer picker — a searchable **combobox** (ported in structure from
 * the old settle-fast `PerformerSearch`, restyled for the new design): one input
 * that opens a dropdown grouping the operator's matching **contacts** and public
 * **performer profiles**. Selecting a row emits a typed `PerformerSelection`;
 * profile rows link out to the public profile; a typed name with no match can be
 * used as-is (a draft). Self-fetching; the parent only handles `onSelect`.
 */
export type PerformerSelection =
  | { source: "profile"; name: string; profileId: string; slug: string }
  | { source: "contact"; name: string; contactId: string; email?: string }
  | { source: "draft"; name: string };

export interface PerformerSearchProps {
  /** Acting profile id whose contacts feed the "My contacts" group. */
  contactsProfileId?: string;
  onSelect: (selection: PerformerSelection) => void;
  /**
   * How to build the public profile URL (opened in a new tab). Defaults to the
   * public site's own address for it — NOT a relative path: this component runs
   * in the app, and `/profile/<slug>` relative to the app's origin is a page
   * that does not exist there.
   */
  publicProfileUrl?: (slug: string) => string;
}

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const groupHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px 4px",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--dim)",
};

export function PerformerSearch({
  contactsProfileId,
  onSelect,
  publicProfileUrl = publicProfileUrlFor,
}: PerformerSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = useDebounced(query.trim(), 250);

  const profiles = useGetApiV1ProfilesSearch(
    { q: q || undefined, kind: "performer", limit: 8 },
    { query: { enabled: open } },
  );
  const contactsQuery = useGetApiV1ProfilesIdContacts(contactsProfileId ?? "", {
    query: { enabled: open && Boolean(contactsProfileId) },
  });

  const needle = q.toLowerCase();
  const contactMatches = (contactsQuery.data ?? []).filter((contact) => {
    if (!needle) return true;
    const persons = (contact.persons as { email?: string }[] | null) ?? [];
    return (
      contact.name.toLowerCase().includes(needle) ||
      persons.some((person) => person.email?.toLowerCase().includes(needle))
    );
  });
  // A contact and a public profile can share a name — show the contact, drop the
  // duplicate profile (mirrors the old app's dedupe).
  const contactNames = new Set(contactMatches.map((contact) => contact.name.toLowerCase()));
  const profileMatches = (profiles.data?.items ?? []).filter(
    (profile) => !contactNames.has(profile.name.toLowerCase()),
  );

  const loading = profiles.isFetching && (profiles.data?.items ?? []).length === 0;
  const hasResults = contactMatches.length > 0 || profileMatches.length > 0;

  const pick = (selection: PerformerSelection) => {
    onSelect(selection);
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      style={{ position: "relative" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && query.trim()) {
          event.preventDefault();
          pick({ source: "draft", name: query.trim() });
        }
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          ...fieldStyle,
          padding: "9px 12px",
        }}
      >
        <Icon name="search" size={15} />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder="Add a performer — search or type a name…"
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            background: "transparent",
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
        />
      </span>

      {open && (
        <>
          {/* Click-away scrim (behind the dropdown, above the page). */}
          <button
            type="button"
            aria-label="Close performer search"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 40,
              border: 0,
              background: "transparent",
              cursor: "default",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 41,
              maxHeight: 320,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow-lg)",
              padding: 6,
            }}
          >
            {loading ? (
              <SkeletonRows />
            ) : (
              <>
                {contactMatches.length > 0 && (
                  <>
                    <div style={groupHeaderStyle}>
                      <Icon name="user" size={12} /> My contacts
                    </div>
                    {contactMatches.map((contact) => {
                      const persons = (contact.persons as { email?: string }[] | null) ?? [];
                      const email = persons.find((person) => person.email)?.email;
                      return (
                        <Row
                          key={contact.id}
                          name={contact.name}
                          meta={email ?? contact.type ?? "Contact"}
                          onClick={() =>
                            pick({
                              source: "contact",
                              name: contact.name,
                              contactId: contact.id,
                              email,
                            })
                          }
                        />
                      );
                    })}
                  </>
                )}

                {profileMatches.length > 0 && (
                  <>
                    <div style={groupHeaderStyle}>
                      <Icon name="music" size={12} /> Public profiles
                    </div>
                    {profileMatches.map((profile) => (
                      <Row
                        key={profile.id}
                        name={profile.name}
                        avatarUrl={profile.avatarUrl}
                        meta={[profile.type ?? "Performer", profile.city]
                          .filter(Boolean)
                          .join(" · ")}
                        unclaimed={!profile.claimed}
                        publicHref={publicProfileUrl(profile.slug)}
                        onClick={() =>
                          pick({
                            source: "profile",
                            name: profile.name,
                            profileId: profile.id,
                            slug: profile.slug,
                          })
                        }
                      />
                    ))}
                  </>
                )}

                {/* Use the typed name as-is (an off-platform draft). */}
                {query.trim() && (
                  <Row
                    icon="plus"
                    name={`Use “${query.trim()}”`}
                    meta="Add as a new performer"
                    onClick={() => pick({ source: "draft", name: query.trim() })}
                  />
                )}

                {!hasResults && !query.trim() && (
                  <div style={{ color: "var(--dim)", fontSize: 12.5, padding: "10px 10px 8px" }}>
                    {contactsProfileId
                      ? "Start typing to search performers and contacts."
                      : "Start typing to search performers."}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  name,
  meta,
  avatarUrl,
  unclaimed,
  publicHref,
  icon,
  onClick,
}: {
  name: string;
  meta?: string;
  avatarUrl?: string | null;
  unclaimed?: boolean;
  publicHref?: string;
  icon?: "plus";
  onClick: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--shape-fill)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
        }}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "8px 10px",
          borderRadius: 9,
          border: 0,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {icon === "plus" ? (
          <span
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              border: "1px dashed var(--border-strong)",
              color: "var(--muted)",
            }}
          >
            <Icon name="plus" size={15} />
          </span>
        ) : (
          <Avatar
            initials={initialsOf(name)}
            src={avatarUrl ?? undefined}
            alt={name}
            tone="brand"
            shape="square"
            size={32}
          />
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13.5,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
            {unclaimed && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "1px 6px",
                  flexShrink: 0,
                }}
              >
                Unclaimed
              </span>
            )}
          </span>
          {meta && (
            <span
              style={{
                display: "block",
                color: "var(--muted)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {meta}
            </span>
          )}
        </span>
      </button>
      {publicHref && (
        <a
          href={publicHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${name}'s public profile`}
          title="Open public profile"
          style={{
            flexShrink: 0,
            display: "inline-grid",
            placeItems: "center",
            width: 30,
            height: 30,
            marginRight: 4,
            borderRadius: 8,
            color: "var(--muted)",
          }}
        >
          <Icon name="arrow-right" size={14} />
        </a>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 4 }}>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 6px" }}
        >
          <Skeleton width={32} height={32} radius={9} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton width="45%" height={11} />
            <Skeleton width="30%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}
