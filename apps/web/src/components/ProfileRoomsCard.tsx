import { Button, Card, Icon, TextField } from "@showme/design-system";
import { useState } from "react";
import { ConfirmDialog, useConfirmDialog } from "./ConfirmDialog";
import { RoomSetupsField } from "./ProfileSetupsField";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";
import { type ProfileRoomsView, type RoomRow, useProfileRooms } from "./useProfileRooms";

/**
 * ROOMS — and with them, the venue's capacity. This is the ONLY place either is
 * entered.
 *
 * It used to be three places on one screen: a flat "The room → Capacity" in the
 * profile form, a "Capacity setups" list further down, and this card with a
 * capacity box per room. The copy on this card had to say out loud that the
 * setups above were "not the same as" the rooms below — and a UI that needs a
 * disclaimer to be understood is the thing that is wrong. One model now: a venue
 * has rooms, a room has a capacity, and a room may be counted another way. The
 * nesting is the explanation.
 *
 * Its own card, beneath the profile form rather than inside it, because rooms are
 * their own records: events point AT a room (`events.stage_id`), so one exists the
 * moment it is named and saves on the spot. Everything in the form above is a
 * field ON the profile and saves with "Save changes"; mixing the two under one
 * button would be a lie in one direction or the other.
 *
 * FLAT FOR ONE ROOM. Most venues are one room, and one room does not need a name,
 * a delete button or a box drawn round it to be understood — so with none or one,
 * the card is a single Capacity field. The hierarchy appears the moment there is
 * something to be hierarchical about. (The room underneath is real either way:
 * typing that first capacity creates it, because only a row can be pointed at by
 * an event or answer "is the venue free on the 12th?".)
 */

function RoomFields({
  room,
  showsName,
  onRename,
  onCapacityChange,
  onSetupsChange,
  onRemove,
}: {
  room: RoomRow;
  /** False for a venue's only room — see the card's docstring. */
  showsName: boolean;
  onRename: (name: string) => void;
  onCapacityChange: (capacity: string) => void;
  onSetupsChange: (setups: RoomRow["capacitySetups"]) => void;
  onRemove: () => void;
}) {
  // Local drafts so typing doesn't fire a request per keystroke; committed on blur.
  const [name, setName] = useState(room.name);
  const [capacity, setCapacity] = useState(room.capacity === null ? "" : String(room.capacity));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        {showsName && (
          <div style={{ flex: 1 }}>
            <TextField
              label="Room"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => name.trim() !== room.name && onRename(name)}
            />
          </div>
        )}
        <div style={{ width: showsName ? 130 : 180, flexShrink: 0 }}>
          <TextField
            label="Capacity"
            type="number"
            min={0}
            inputMode="numeric"
            value={capacity}
            placeholder="e.g. 400"
            onChange={(event) => setCapacity(event.target.value)}
            onBlur={() =>
              capacity.trim() !== (room.capacity === null ? "" : String(room.capacity)) &&
              onCapacityChange(capacity)
            }
          />
        </div>
        <div style={{ flex: showsName ? undefined : 1, paddingBottom: 11 }}>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            {room.eventCount === 0
              ? "No shows"
              : `${room.eventCount} ${room.eventCount === 1 ? "show" : "shows"}`}
          </span>
        </div>
        {showsName && (
          <Button variant="ghost" aria-label={`Remove ${room.name}`} onClick={onRemove}>
            <Icon name="trash" size={15} />
          </Button>
        )}
      </div>
      <RoomSetupsField value={room.capacitySetups} onChange={onSetupsChange} />
    </div>
  );
}

/** The bare Capacity box a venue with no rooms yet sees. Typing it makes the room. */
function FirstRoomCapacityField({ onSave }: { onSave: (capacity: string) => void }) {
  const [capacity, setCapacity] = useState("");
  return (
    <div style={{ width: 180 }}>
      <TextField
        label="Capacity"
        type="number"
        min={0}
        inputMode="numeric"
        value={capacity}
        placeholder="e.g. 400"
        onChange={(event) => setCapacity(event.target.value)}
        onBlur={() => capacity.trim() !== "" && onSave(capacity)}
      />
    </div>
  );
}

/** Name and capacity for one more room, shown once a venue admits to having two. */
function AddRoomFields({ rooms }: { rooms: ProfileRoomsView }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <div style={{ flex: 1 }}>
        <TextField
          label="Add a room"
          value={rooms.draftName}
          placeholder="e.g. Back Room"
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
          placeholder="e.g. 80"
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
  );
}

export function ProfileRoomsCard({ profileId }: { profileId: string }) {
  const rooms = useProfileRooms(profileId);
  const confirm = useConfirmDialog();
  // A one-room venue is not shown the machinery for two until it asks for it.
  const [addingRoom, setAddingRoom] = useState(false);

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

  const soleRoom = rooms.rooms.length <= 1;

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Eyebrow>Rooms &amp; capacity</Eyebrow>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
          {soleRoom
            ? "How many people fit. If this venue has more than one space, add them — each room is its own calendar, so two rooms can hold two shows on the same night."
            : "Each room is its own calendar — two rooms can hold two shows on the same night, and availability is answered per room."}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dim)" }}>
          Saves as you go — rooms are separate records, not fields on this profile.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 14 }}>
        {rooms.isPending ? (
          <LoadingState label="Loading rooms" />
        ) : rooms.isError ? (
          <ErrorState error={rooms.error} title="Couldn't load this venue's rooms" />
        ) : rooms.rooms.length === 0 ? (
          <FirstRoomCapacityField onSave={rooms.saveSoleRoomCapacity} />
        ) : (
          rooms.rooms.map((room) => (
            <div
              key={room.id}
              style={
                soleRoom
                  ? undefined
                  : {
                      display: "flex",
                      flexDirection: "column",
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }
              }
            >
              <RoomFields
                room={room}
                showsName={!soleRoom}
                onRename={(name) => rooms.rename(room.id, name)}
                onCapacityChange={(capacity) => rooms.changeCapacity(room.id, capacity)}
                onSetupsChange={(setups) => rooms.changeSetups(room.id, setups)}
                onRemove={() => removeRoom(room)}
              />
            </div>
          ))
        )}

        {soleRoom && !addingRoom ? (
          <div>
            <Button
              variant="ghost"
              leftIcon={<Icon name="plus" size={14} />}
              onClick={() => setAddingRoom(true)}
            >
              This venue has another room
            </Button>
          </div>
        ) : (
          <AddRoomFields rooms={rooms} />
        )}
      </div>
      <ConfirmDialog {...confirm.dialogProps} />
    </Card>
  );
}
