import { Button, Icon } from "@showme/design-system";
import { useRef } from "react";
import { FieldLabel } from "./ProfileLinkListField";
import { PROFILE_IMAGE_ACCEPT } from "./useProfileImageUpload";

/**
 * One tile as the editor holds it. `fileId` is the uploaded picture; `url` is how
 * to draw it right now (a signed URL, which is why it is not what gets saved).
 * A tile with `fileId: null` is an external address a previous save recorded —
 * still shown, still removable, and it keeps working.
 */
export interface ProfilePhotoDraft {
  fileId: string | null;
  url: string | null;
}

export interface ProfilePhotoGalleryFieldProps {
  value: ProfilePhotoDraft[];
  onChange: (next: ProfilePhotoDraft[]) => void;
  isUploading: boolean;
  disabled?: boolean;
  onPick(files: File[]): void;
}

/**
 * The photo gallery — uploaded, ordered, removable.
 *
 * It replaces a list of pasted image URLs. ORDER IS CONTENT, same argument as the
 * links field: the first photo is the one a booker sees, and the server stores
 * that as `profile_media.position`.
 *
 * Rows are keyed by index because a freshly uploaded tile shares its identity
 * with nothing until it is saved, and the list is only ever mutated through these
 * handlers.
 */
export function ProfilePhotoGalleryField({
  value,
  onChange,
  isUploading,
  disabled,
  onPick,
}: ProfilePhotoGalleryFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
      <FieldLabel>Photos</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
        Uploaded to your own storage and shown on your public page, in this order. The first one
        leads.
      </p>

      {value.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
            gap: 10,
          }}
        >
          {value.map((photo, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: position IS the row's identity here — see the docstring.
              key={index}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                overflow: "hidden",
                background: "var(--card)",
              }}
            >
              {photo.url ? (
                <img
                  src={photo.url}
                  alt=""
                  style={{
                    width: "100%",
                    aspectRatio: "16 / 10",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                // The file row is gone, so there is nothing to draw. Say that,
                // rather than showing a broken image — and keep the tile, so a
                // save does not silently drop a photo the screen could not load.
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "16 / 10",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--dim)",
                    fontSize: 12.5,
                  }}
                >
                  Picture unavailable
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", padding: 4 }}>
                <Button
                  variant="ghost"
                  aria-label={`Move photo ${index + 1} earlier`}
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                >
                  ←
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move photo ${index + 1} later`}
                  onClick={() => move(index, 1)}
                  disabled={index === value.length - 1}
                >
                  →
                </Button>
                <span style={{ flex: 1 }} />
                <Button
                  variant="ghost"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => onChange(value.filter((_, position) => position !== index))}
                >
                  <Icon name="trash" size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <Button
          variant="secondary"
          leftIcon={<Icon name="upload" />}
          disabled={disabled || isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? "Uploading…" : "Upload photos"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        multiple
        aria-label="Upload photos"
        hidden
        onChange={(changed) => {
          const picked = [...(changed.target.files ?? [])];
          changed.target.value = "";
          if (picked.length > 0) onPick(picked);
        }}
      />
    </div>
  );
}
