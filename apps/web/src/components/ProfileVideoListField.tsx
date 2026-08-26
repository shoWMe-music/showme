import { Button, Icon, TextField } from "@showme/design-system";
import { VIDEO_LINK_REJECTION, parseVideoLink } from "@showme/shared";
import { useState } from "react";
import { FieldLabel } from "./ProfileLinkListField";
import { VideoEmbed } from "./VideoEmbed";

export interface ProfileVideoListFieldProps {
  /** Canonical video URLs, in the order they appear on the public page. */
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * The videos on a profile — pasted as a link, shown as a PLAYER.
 *
 * What this replaced listed the raw URL beside a link icon, so the only way to
 * find out whether the right video had been pasted was to save, open the public
 * page, and look. Now the player appears the moment the link is accepted, which
 * is also the moment it is proven embeddable: the field will not add a link
 * `parseVideoLink` refuses, and refuses it with the same sentence the server
 * would — one rule, stated once, enforced in both places.
 *
 * ORDER IS CONTENT (`profile_media.position`), as with photos and links.
 */
export function ProfileVideoListField({ value, onChange }: ProfileVideoListFieldProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    const link = parseVideoLink(trimmed);
    if (!link) {
      setProblem(VIDEO_LINK_REJECTION);
      return;
    }
    setProblem(null);
    setDraft("");
    // Stored canonical, so the same video pasted in three forms is one entry.
    if (value.includes(link.canonicalUrl)) return;
    onChange([...value, link.canonicalUrl]);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  // The link being typed, previewed live — the answer to "is this the right
  // video" before it is even added.
  const draftLink = draft.trim() === "" ? null : parseVideoLink(draft.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldLabel>Videos</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
        A YouTube or Vimeo link. It plays inline on your public page; nothing else can be embedded.
      </p>

      {value.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {value.map((url, index) => {
            const link = parseVideoLink(url);
            return (
              <div
                key={url}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "var(--card)",
                }}
              >
                {link ? (
                  <VideoEmbed link={link} title={`Video ${index + 1}`} />
                ) : (
                  // Only reachable for a row stored before this rule existed.
                  // It stays visible and removable rather than vanishing.
                  <div
                    style={{
                      aspectRatio: "16 / 9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 12,
                      color: "var(--dim)",
                      fontSize: 12.5,
                      textAlign: "center",
                    }}
                  >
                    This link can't be embedded.
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", padding: 4 }}>
                  <Button
                    variant="ghost"
                    aria-label={`Move video ${index + 1} earlier`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    ←
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Move video ${index + 1} later`}
                    onClick={() => move(index, 1)}
                    disabled={index === value.length - 1}
                  >
                    →
                  </Button>
                  <span style={{ flex: 1 }} />
                  <Button
                    variant="ghost"
                    aria-label={`Remove video ${index + 1}`}
                    onClick={() => onChange(value.filter((entry) => entry !== url))}
                  >
                    <Icon name="trash" size={15} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draftLink && (
        <div style={{ maxWidth: 360 }}>
          <VideoEmbed link={draftLink} title="Video preview" />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            label={undefined}
            value={draft}
            placeholder="https://youtube.com/watch?v=… or https://vimeo.com/…"
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // The field lives inside the profile form; Enter here means "add
              // this video", never "save the whole profile".
              event.preventDefault();
              add();
            }}
          />
        </div>
        <Button variant="secondary" leftIcon={<Icon name="plus" />} onClick={add}>
          Add
        </Button>
      </div>

      {problem && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
