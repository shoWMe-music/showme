import { Button, Icon, TextField } from "@showme/design-system";
import { useState } from "react";
import { FieldLabel } from "./ProfileLinkListField";

export interface ProfileMediaFieldProps {
  label: string;
  /** What the box is for, in the owner's language. */
  hint: string;
  placeholder: string;
  /** URLs, in the order they appear on the public page. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Show a thumbnail strip (photos) rather than a list of links (videos). */
  preview: "image" | "link";
}

/**
 * A gallery, edited as an ordered list of URLs.
 *
 * URLS, NOT AN UPLOADER, and that is a deliberate boundary rather than a stub.
 * Uploading is its own subsystem in this rebuild — `files` rows plus API-issued
 * signed URLs (CLAUDE.md) — and it is not what the feedback asked for: the
 * complaint is that the fields are missing, and a venue with photos already
 * hosted somewhere could not put them on its profile at all. This captures the
 * information now, stores it in `profile_media` exactly as an uploader would, and
 * leaves the upload button as the only thing left to add.
 *
 * Order is content, same as links: the first photo is the one a booker sees.
 */
export function ProfileMediaField({
  label,
  hint,
  placeholder,
  value,
  onChange,
  preview,
}: ProfileMediaFieldProps) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    // Re-adding one says nothing new and would duplicate a React key.
    if (trimmed === "" || value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
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
      <FieldLabel>{label}</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>{hint}</p>

      {value.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {value.map((url, index) => (
            <div
              key={url}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: 8,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--card)",
              }}
            >
              {preview === "image" ? (
                <img
                  src={url}
                  alt=""
                  style={{
                    width: 72,
                    height: 44,
                    objectFit: "cover",
                    borderRadius: 8,
                    flexShrink: 0,
                    background: "var(--card)",
                  }}
                />
              ) : (
                <span style={{ color: "var(--muted)", display: "flex", flexShrink: 0 }}>
                  <Icon name="link" size={15} />
                </span>
              )}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {url}
              </span>
              <Button
                variant="ghost"
                aria-label={`Move ${url} up`}
                onClick={() => move(index, -1)}
                disabled={index === 0}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move ${url} down`}
                onClick={() => move(index, 1)}
                disabled={index === value.length - 1}
              >
                ↓
              </Button>
              <Button
                variant="ghost"
                aria-label={`Remove ${url}`}
                onClick={() => onChange(value.filter((entry) => entry !== url))}
              >
                <Icon name="trash" size={15} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            label={undefined}
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // The field lives inside the profile form; Enter here means "add
              // this URL", never "save the whole profile".
              event.preventDefault();
              add();
            }}
          />
        </div>
        <Button variant="secondary" leftIcon={<Icon name="plus" />} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}
