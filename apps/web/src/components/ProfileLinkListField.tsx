import { Button, Icon, Select, TextField } from "@showme/design-system";

/**
 * The platforms the old app offered, in its order
 * (`../showme-settle-fast/src/pages/ProfileEditPage.tsx:910`). Streaming first,
 * then social, then the catch-all — which is the order a booker scans them in.
 *
 * A list, not an enum: the value stored is the label, and an unknown one from
 * older data still renders. The picker is a shortcut, not a gate.
 */
export const SOCIAL_PLATFORMS: readonly string[] = [
  "Spotify",
  "Apple Music",
  "YouTube Music",
  "SoundCloud",
  "Bandcamp",
  "Tidal",
  "Deezer",
  "Instagram",
  "Facebook",
  "TikTok",
  "X",
  "YouTube",
  "Website",
];

export interface ProfileLinkDraft {
  platform: string;
  url: string;
}

export interface ProfileLinkListFieldProps {
  value: ProfileLinkDraft[];
  onChange: (next: ProfileLinkDraft[]) => void;
}

/**
 * The links that go on the public page — "Spotify → https://…".
 *
 * ORDER IS CONTENT here, which is why the rows are draggable-by-buttons rather
 * than a set: the owner decides what a booker sees first, and the server stores
 * that as `profile_social_links.position`. A set would silently reshuffle.
 *
 * Rows are keyed by index on purpose. A link has no id until it is saved, two
 * rows may legitimately hold the same half-typed value while someone is editing,
 * and the list is short and only ever mutated through these handlers — so the
 * index IS the stable identity of a row for as long as the form is open.
 */
export function ProfileLinkListField({ value, onChange }: ProfileLinkListFieldProps) {
  const update = (index: number, patch: Partial<ProfileLinkDraft>) => {
    onChange(value.map((link, position) => (position === index ? { ...link, ...patch } : link)));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldLabel>Links</FieldLabel>
      {value.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--dim)" }}>
          No links yet. Spotify, Instagram, your own site — whatever you want a booker to open
          first.
        </p>
      )}
      {value.map((link, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the row's index IS its identity until save — see the docstring.
        <div key={index} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ width: 170, flexShrink: 0 }}>
            <Select
              label={index === 0 ? "Platform" : undefined}
              value={link.platform}
              onChange={(platform) => update(index, { platform })}
              options={SOCIAL_PLATFORMS.map((platform) => ({ value: platform, label: platform }))}
              placeholder="Choose…"
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextField
              label={index === 0 ? "URL" : undefined}
              value={link.url}
              placeholder="https://…"
              onChange={(event) => update(index, { url: event.target.value })}
            />
          </div>
          <Button
            variant="ghost"
            aria-label={`Move ${link.platform || "link"} up`}
            onClick={() => move(index, -1)}
            disabled={index === 0}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            aria-label={`Move ${link.platform || "link"} down`}
            onClick={() => move(index, 1)}
            disabled={index === value.length - 1}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            aria-label={`Remove ${link.platform || "link"}`}
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            <Icon name="trash" size={15} />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          leftIcon={<Icon name="plus" />}
          onClick={() => onChange([...value, { platform: "Spotify", url: "" }])}
        >
          Add link
        </Button>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {children}
    </span>
  );
}
