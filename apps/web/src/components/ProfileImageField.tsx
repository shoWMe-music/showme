import { Button, Icon } from "@showme/design-system";
import { useRef } from "react";
import { FieldLabel } from "./ProfileLinkListField";
import { PROFILE_IMAGE_ACCEPT } from "./useProfileImageUpload";

export interface ProfileImageFieldProps {
  label: string;
  hint: string;
  /** The picture as it currently renders — a signed URL, or null for none. */
  previewUrl: string | null;
  /** How tall the preview draws. A banner is wide and short; an avatar is square. */
  shape: "avatar" | "banner";
  isUploading: boolean;
  disabled?: boolean;
  onPick(file: File): void;
  onRemove(): void;
}

/**
 * ONE picture — the avatar or the cover banner.
 *
 * It replaces a text box labelled "Avatar image URL". That box was not a smaller
 * version of this: it could only ever point at a picture the owner was already
 * hosting somewhere else, which for most of them means they had no way to put a
 * face on their profile at all.
 *
 * Presentational by the review gate's rule — it holds no state and fetches
 * nothing. The upload lives in `useProfileImageUpload`; this takes a URL to draw
 * and emits "the owner picked this file" / "the owner took it off".
 *
 * The empty state is a bordered, clickable placeholder rather than nothing:
 * STYLE-GUIDE §7 — an empty value is not a reason for an invisible control.
 */
export function ProfileImageField({
  label,
  hint,
  previewUrl,
  shape,
  isUploading,
  disabled,
  onPick,
  onRemove,
}: ProfileImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <FieldLabel>{label}</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>{hint}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isUploading}
          aria-label={previewUrl ? `Replace ${label}` : `Upload ${label}`}
          style={{
            all: "unset",
            cursor: disabled || isUploading ? "default" : "pointer",
            flexShrink: 0,
            width: shape === "avatar" ? 88 : 200,
            height: 88,
            borderRadius: shape === "avatar" ? "50%" : 12,
            border: previewUrl ? "1px solid var(--border)" : "1.5px dashed var(--border-strong)",
            background: previewUrl
              ? `center / cover no-repeat url("${encodeURI(previewUrl)}"), var(--card)`
              : "var(--card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
        >
          {previewUrl ? null : <Icon name="plus" />}
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <Button
            variant="secondary"
            leftIcon={<Icon name="upload" />}
            disabled={disabled || isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? "Uploading…" : previewUrl ? "Replace" : "Upload"}
          </Button>
          {previewUrl && (
            <Button variant="ghost" leftIcon={<Icon name="trash" size={14} />} onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        aria-label={label}
        hidden
        onChange={(changed) => {
          const picked = changed.target.files?.[0];
          // Reset the input so picking the SAME file twice still fires a change.
          changed.target.value = "";
          if (picked) onPick(picked);
        }}
      />
    </div>
  );
}
