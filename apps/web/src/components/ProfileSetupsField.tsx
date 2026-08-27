import { Button, Icon, TextField } from "@showme/design-system";
import { useState } from "react";
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

/**
 * One alternate arrangement of a room — "Theater seating" 220, "Standing only"
 * 400. `capacity` is a string because it comes from a number input that can be
 * empty; `id` is the server's, and is what keys the row while it is edited.
 */
export interface RoomSetupDraft {
  id: string;
  name: string;
  capacity: string;
}

/**
 * ALTERNATE SETUPS OF ONE ROOM — nested inside the room they belong to.
 *
 * The venue used to be asked for a capacity three times on one screen: a flat
 * "The room → Capacity", a "Capacity setups" list, and a room list under its own
 * heading — with a sentence on the rooms card explaining that the setups were
 * "one room counted two ways". Setups now live INSIDE the room, so the nesting
 * says that and the sentence is gone.
 *
 * What went with the sentence: the seated/standing pair (the NAME already says
 * which arrangement it is), the "headline capacity" radio (the room's own
 * capacity is the headline), and the notes line. A name and a number is the whole
 * of it.
 *
 * Like the room fields around it, this saves as you go: a row commits on blur,
 * and adding or removing one commits immediately. There are no blank rows to
 * strand — a new setup is typed into the add row and only then exists.
 */
export function RoomSetupsField({
  value,
  onChange,
}: {
  value: RoomSetupDraft[];
  onChange: (next: RoomSetupDraft[]) => void;
}) {
  const [draftName, setDraftName] = useState("");
  const [draftCapacity, setDraftCapacity] = useState("");

  const add = () => {
    const name = draftName.trim();
    if (name === "") return;
    onChange([...value, { id: `VCS-${value.length + 1}`, name, capacity: draftCapacity.trim() }]);
    setDraftName("");
    setDraftCapacity("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <FieldLabel>Alternate setups</FieldLabel>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
        The same room counted another way — “Theater seating”, “Banquet”. Optional.
      </p>
      {value.map((setup) => (
        <SetupRow
          key={setup.id}
          setup={setup}
          onCommit={(next) =>
            onChange(value.map((row) => (row.id === setup.id ? { ...row, ...next } : row)))
          }
          onRemove={() => onChange(value.filter((row) => row.id !== setup.id))}
        />
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField
            value={draftName}
            placeholder="e.g. Theater seating"
            onChange={(event) => setDraftName(event.target.value)}
          />
        </div>
        <div style={{ width: 110, flexShrink: 0 }}>
          <TextField
            type="number"
            min={0}
            inputMode="numeric"
            value={draftCapacity}
            placeholder="e.g. 220"
            onChange={(event) => setDraftCapacity(event.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          leftIcon={<Icon name="plus" size={14} />}
          disabled={draftName.trim() === ""}
          onClick={add}
        >
          Add setup
        </Button>
      </div>
    </div>
  );
}

/**
 * One setup row, holding its own draft so typing does not fire a request per
 * keystroke. Committed on blur, and only when the value actually moved — the same
 * shape the room's own name and capacity fields use.
 */
function SetupRow({
  setup,
  onCommit,
  onRemove,
}: {
  setup: RoomSetupDraft;
  onCommit: (next: { name: string; capacity: string }) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(setup.name);
  const [capacity, setCapacity] = useState(setup.capacity);

  const commit = () => {
    // An emptied name is a half-finished edit, not a request to unname a setup.
    if (name.trim() === "") return;
    if (name.trim() === setup.name && capacity.trim() === setup.capacity) return;
    onCommit({ name: name.trim(), capacity: capacity.trim() });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      <div style={{ flex: 1 }}>
        <TextField value={name} onChange={(event) => setName(event.target.value)} onBlur={commit} />
      </div>
      <div style={{ width: 110, flexShrink: 0 }}>
        <TextField
          type="number"
          min={0}
          inputMode="numeric"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          onBlur={commit}
        />
      </div>
      <Button variant="ghost" aria-label={`Remove ${setup.name}`} onClick={onRemove}>
        <Icon name="trash" size={15} />
      </Button>
    </div>
  );
}
