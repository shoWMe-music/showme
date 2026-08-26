import { Button, Checkbox, Icon, TextField } from "@showme/design-system";
import { FieldLabel } from "./ProfileLinkListField";

/** A performer line-up: "Full Band", 5 people. Ported from the old app's `setups`. */
export interface ProfileSetupDraft {
  name: string;
  /** Held as a string because it comes from a number input that can be empty. */
  headcount: string;
}

export interface ProfileSetupsFieldProps {
  value: ProfileSetupDraft[];
  onChange: (next: ProfileSetupDraft[]) => void;
}

/**
 * SETUP VARIATIONS — "Solo", "Duo", "Full Band", and how many people come.
 *
 * Ported from `../showme-settle-fast/src/pages/ProfileEditPage.tsx:478`, and it
 * is not decoration: an operator reads it to size the stage, the backline, the
 * hospitality rider and the travel party BEFORE making an offer. A band that can
 * play solo or as a five-piece is two very different bookings, and without this
 * the operator has to ask.
 *
 * Rows are keyed by index: a setup has no id, two rows may hold the same
 * half-typed name while someone edits, and the list is only mutated through these
 * handlers.
 */
export function ProfileSetupsField({ value, onChange }: ProfileSetupsFieldProps) {
  const update = (index: number, patch: Partial<ProfileSetupDraft>) => {
    onChange(value.map((setup, position) => (position === index ? { ...setup, ...patch } : setup)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldLabel>Setup variations</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
        The line-ups you can be booked as. An operator sizes the stage, the backline and the travel
        party from these.
      </p>
      {value.map((setup, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the row's index IS its identity until save — see the docstring.
        <div key={index} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <TextField
              label={index === 0 ? "Name" : undefined}
              value={setup.name}
              placeholder="e.g. Full Band"
              onChange={(event) => update(index, { name: event.target.value })}
            />
          </div>
          <div style={{ width: 130, flexShrink: 0 }}>
            <TextField
              label={index === 0 ? "Headcount" : undefined}
              type="number"
              min={0}
              inputMode="numeric"
              value={setup.headcount}
              placeholder="e.g. 5"
              onChange={(event) => update(index, { headcount: event.target.value })}
            />
          </div>
          <Button
            variant="ghost"
            aria-label={`Remove ${setup.name || "setup"}`}
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
          onClick={() => onChange([...value, { name: "", headcount: "" }])}
        >
          Add setup
        </Button>
      </div>
    </div>
  );
}

/** A named way of arranging the room, with its seated/standing split. */
export interface ProfileCapacitySetupDraft {
  id: string;
  name: string;
  capacitySitting: string;
  capacityStanding: string;
  isMain: boolean;
  notes: string;
}

export interface ProfileCapacitySetupsFieldProps {
  value: ProfileCapacitySetupDraft[];
  onChange: (next: ProfileCapacitySetupDraft[]) => void;
}

/**
 * CAPACITY SETUPS — "Theater seating" 220, "Standing only" 400, one of them the
 * headline. Ported from `ProfileEditPage.tsx:605`.
 *
 * `venue_details.capacity_setups` has held these since migration 0010 and nothing
 * has ever written to it: a room that can be seated or standing had one number to
 * offer, which is not how a promoter picks a room.
 *
 * "Main" is a radio, not a checkbox set, even though it is stored per row: exactly
 * one setup is the headline capacity, and the server enforces that on write
 * (`normalizeCapacitySetups`). Checking a new one here unchecks the others so the
 * form cannot show a state the server would then quietly repair.
 */
export function ProfileCapacitySetupsField({ value, onChange }: ProfileCapacitySetupsFieldProps) {
  const update = (index: number, patch: Partial<ProfileCapacitySetupDraft>) => {
    onChange(value.map((setup, position) => (position === index ? { ...setup, ...patch } : setup)));
  };

  const setMain = (index: number) => {
    onChange(value.map((setup, position) => ({ ...setup, isMain: position === index })));
  };

  const remove = (index: number) => {
    const next = value.filter((_, position) => position !== index);
    // Deleting the headline has to promote another one, or the room has no
    // headline capacity at all.
    if (next.length > 0 && !next.some((setup) => setup.isMain)) {
      const [first, ...rest] = next;
      if (first) onChange([{ ...first, isMain: true }, ...rest]);
      return;
    }
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <FieldLabel>Capacity setups</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
        Alternate configurations — “Theater seating”, “Standing only”, “Banquet”. One is the
        headline a promoter sees first.
      </p>
      {value.map((setup, index) => (
        <div
          key={setup.id}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <TextField
                label="Name"
                value={setup.name}
                placeholder="e.g. Theater seating"
                onChange={(event) => update(index, { name: event.target.value })}
              />
            </div>
            <div style={{ width: 120, flexShrink: 0 }}>
              <TextField
                label="Seated"
                type="number"
                min={0}
                inputMode="numeric"
                value={setup.capacitySitting}
                onChange={(event) => update(index, { capacitySitting: event.target.value })}
              />
            </div>
            <div style={{ width: 120, flexShrink: 0 }}>
              <TextField
                label="Standing"
                type="number"
                min={0}
                inputMode="numeric"
                value={setup.capacityStanding}
                onChange={(event) => update(index, { capacityStanding: event.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              aria-label={`Remove ${setup.name || "setup"}`}
              onClick={() => remove(index)}
            >
              <Icon name="trash" size={15} />
            </Button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Checkbox
              checked={setup.isMain}
              onChange={() => setMain(index)}
              label="Headline capacity"
            />
            <div style={{ flex: 1 }}>
              <TextField
                value={setup.notes}
                placeholder="Notes — e.g. back rows removed for a taller stage"
                onChange={(event) => update(index, { notes: event.target.value })}
              />
            </div>
          </div>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          leftIcon={<Icon name="plus" />}
          onClick={() =>
            onChange([
              ...value,
              {
                id: `VCS-${Date.now()}`,
                name: "",
                capacitySitting: "",
                capacityStanding: "",
                isMain: value.length === 0,
                notes: "",
              },
            ])
          }
        >
          Add capacity setup
        </Button>
      </div>
    </div>
  );
}
