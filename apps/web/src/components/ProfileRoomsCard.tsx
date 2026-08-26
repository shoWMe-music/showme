import { Button, Card, Icon, TextField } from "@showme/design-system";
import { useState } from "react";
import { ConfirmDialog, useConfirmDialog } from "./ConfirmDialog";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";
import { type RoomRow, useProfileRooms } from "./useProfileRooms";

/**
 * ROOMS & STAGES — the separate spaces inside one venue.
 *
 * Its own card, beneath the profile form rather than inside it, because rooms are
 * their own records: events point AT a room, so it exists the moment it is named
 * and saves on the spot. Everything in the form above is a field ON the profile
 * and saves with "Save changes"; mixing the two under one button would be a lie
 * in one direction or the other.
 *
 * Why this matters at all: a room is the unit that can be double-booked. A venue
 * with a hall and a basement sells two shows on the same Friday, so availability
 * — "are you free on the 12th?" — has one answer per room and none for the
 * building. Until this card existed, nothing in the app could create a room, so
 * the calendar had no honest calendar to offer.
 */

function RoomFields({
  room,
  onRename,
  onCapacityChange,
  onRemove,
}: {
  room: RoomRow;
  onRename: (name: string) => void;
  onCapacityChange: (capacity: string) => void;
  onRemove: () => void;
}) {
  // Local drafts so typing doesn't fire a request per keystroke; committed on blur.
  const [name, setName] = useState(room.name);
  const [capacity, setCapacity] = useState(room.capacity === null ? "" : String(room.capacity));

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <div style={{ flex: 1 }}>
        <TextField
          label="Room"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() !== room.name && onRename(name)}
        />
      </div>
      <div style={{ width: 130, flexShrink: 0 }}>
        <TextField
          label="Capacity"
          type="number"
          min={0}
          inputMode="numeric"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          onBlur={() =>
            capacity.trim() !== (room.capacity === null ? "" : String(room.capacity)) &&
            onCapacityChange(capacity)
          }
        />
      </div>
      <div style={{ width: 92, flexShrink: 0, paddingBottom: 11 }}>
        <span style={{ fontSize: 12, color: "var(--dim)" }}>
          {room.eventCount === 0
            ? "No shows"
            : `${room.eventCount} ${room.eventCount === 1 ? "show" : "shows"}`}
        </span>
      </div>
      <Button variant="ghost" aria-label={`Remove ${room.name}`} onClick={onRemove}>
        <Icon name="trash" size={15} />
      </Button>
    </div>
  );
}

export function ProfileRoomsCard({ profileId }: { profileId: string }) {
  const rooms = useProfileRooms(profileId);
  const confirm = useConfirmDialog();

  const removeRoom = (room: RoomRow) => {
    if (room.eventCount === 0) {
      rooms.remove(room.id);
      return;
    }
    // The shows survive — `events.stage_id` is ON DELETE SET NULL — but they lose
    // their room, and an unassigned show then occupies EVERY room for
    // availability. Worth saying before, not after.
    confirm.ask({
      title: `Remove ${room.name}?`,
      body: `${room.eventCount} ${room.eventCount === 1 ? "event is" : "events are"} in this room. They keep their date and lose their room — and a show with no room counts against every room's availability until it is put in one.`,
      confirmLabel: "Remove room",
      destructive: true,
      onConfirm: () => rooms.remove(room.id),
    });
  };

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Eyebrow>Rooms &amp; stages</Eyebrow>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
          The separate spaces in this venue. Each one is its own calendar — two rooms can hold two
          shows on the same night, and availability is answered per room. Not the same as the
          capacity setups above, which are one room counted two ways.
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dim)" }}>
          Rooms save as you go — they are separate records, not fields on this profile.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
        {rooms.isPending ? (
          <LoadingState label="Loading rooms" />
        ) : rooms.isError ? (
          <ErrorState error={rooms.error} title="Couldn't load this venue's rooms" />
        ) : (
          rooms.rooms.map((room) => (
            <RoomFields
              key={room.id}
              room={room}
              onRename={(name) => rooms.rename(room.id, name)}
              onCapacityChange={(capacity) => rooms.changeCapacity(room.id, capacity)}
              onRemove={() => removeRoom(room)}
            />
          ))
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Add a room"
              value={rooms.draftName}
              placeholder="e.g. Main Room"
              onChange={(event) => rooms.setDraftName(event.target.value)}
            />
          </div>
          <div style={{ width: 130, flexShrink: 0 }}>
            <TextField
              label="Capacity"
              type="number"
              min={0}
              inputMode="numeric"
              value={rooms.draftCapacity}
              placeholder="e.g. 400"
              onChange={(event) => rooms.setDraftCapacity(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            leftIcon={<Icon name="plus" size={14} />}
            disabled={!rooms.canAdd || rooms.isAdding}
            onClick={rooms.add}
          >
            {rooms.isAdding ? "Adding…" : "Add room"}
          </Button>
        </div>
      </div>
      <ConfirmDialog {...confirm.dialogProps} />
    </Card>
  );
}
