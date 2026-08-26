import { Button, Chip, Icon, TextField } from "@showme/design-system";
import type { AmenityOption } from "@showme/shared";
import { useState } from "react";

export interface VenueChipSelectFieldProps {
  label: string;
  /** The standard vocabulary, offered as toggleable chips. */
  options: readonly AmenityOption[];
  /** Currently stored values — standard keys and the venue's own strings mixed. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Turn a stored value into its display label (custom values pass through). */
  toLabel: (value: string) => string;
  /** Placeholder for the free-text add box; omit to forbid custom entries. */
  addPlaceholder?: string;
}

/**
 * A fixed vocabulary you click, plus anything the venue wants to type.
 *
 * The previous app proved both halves are needed: it shipped a ten-item checkbox
 * set AND a free-text "add custom amenity" box, and its real data is full of
 * entries no list would have had ("Green Room", "Loading Dock", "Wheelchair
 * Accessible"). Offering only the ten would silently delete that information.
 *
 * Selected standard options and custom entries render as one row of chips
 * because to the venue they are one list — the key/label distinction is storage,
 * not something a user should have to think about.
 */
export function VenueChipSelectField({
  label,
  options,
  value,
  onChange,
  toLabel,
  addPlaceholder,
}: VenueChipSelectFieldProps) {
  const [draft, setDraft] = useState("");

  const standardKeys = new Set(options.map((option) => option.key));
  const customValues = value.filter((entry) => !standardKeys.has(entry));

  const toggle = (key: string) => {
    onChange(value.includes(key) ? value.filter((entry) => entry !== key) : [...value, key]);
  };

  const addCustom = () => {
    const trimmed = draft.trim();
    // Re-adding an existing entry says nothing new and would duplicate a React
    // key, so treat it as already there and just clear the box.
    if (trimmed === "" || value.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </span>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {options.map((option) => (
          <Chip
            key={option.key}
            active={value.includes(option.key)}
            onClick={() => toggle(option.key)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {customValues.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {customValues.map((entry) => (
            <Chip key={entry} active onClick={() => toggle(entry)}>
              {toLabel(entry)} ✕
            </Chip>
          ))}
        </div>
      )}

      {addPlaceholder && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField
              aria-label={`Add ${label.toLowerCase()}`}
              value={draft}
              placeholder={addPlaceholder}
              onChange={(changeEvent) => setDraft(changeEvent.target.value)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key !== "Enter") return;
                // This field lives inside the profile form; Enter here means "add
                // this chip", never "submit the whole profile".
                keyEvent.preventDefault();
                addCustom();
              }}
            />
          </div>
          <Button
            variant="secondary"
            aria-label={`Add ${label.toLowerCase()}`}
            onClick={addCustom}
            disabled={draft.trim() === ""}
            leftIcon={<Icon name="plus" size={15} />}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
