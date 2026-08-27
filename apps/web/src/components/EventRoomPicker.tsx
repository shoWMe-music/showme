import { useGetApiV1ProfilesIdStages } from "@showme/api-client";
import { Select } from "@showme/design-system";

/**
 * WHICH ROOM of the venue the show is in.
 *
 * `events.stage_id` has pointed at `stages` since migration 0000, and until now
 * nothing in the app could set it — so every event's Room / Stage was blank at
 * creation and the event page could say no more than "Assigned" (ClickUp
 * 86cbaxvku). `GET /profiles/:id/stages` already lists them.
 *
 * A room is NOT a seating setup. The Lantern Hall's Main Room (400) and Back
 * Room (80) are separate spaces that each hold their own show the same night,
 * which is why the choice also moves the capacity: 400 is the wrong number for a
 * show in the Back Room, and a capacity is not decoration — it caps the ticket
 * inventory and draws the break-even line.
 *
 * It draws NOTHING when there is nothing to choose. A venue with no rooms
 * listed, a room list still loading, or a venue the caller does not belong to
 * (that list is a 404 by design — a venue's internal geography is not something
 * a stranger enumerates) all mean the same thing to an operator: there is no
 * room to pick, and an empty control saying so would be worse than no control.
 */
export interface EventRoomPickerProps {
  /** The venue profile whose rooms these are; `null` unlinks the field. */
  venueProfileId: string | null;
  value: string | null;
  /** The chosen room, with its own capacity so the caller can follow it. */
  onChange: (room: { id: string; capacity: number | null } | null) => void;
  /** The wizard's own field styling, so the control matches its neighbours. */
  labelStyle?: React.CSSProperties;
}

/** No room chosen — the value an event has had since migration 0000. */
const NO_ROOM = "";

export function EventRoomPicker({
  venueProfileId,
  value,
  onChange,
  labelStyle,
}: EventRoomPickerProps) {
  const stages = useGetApiV1ProfilesIdStages(venueProfileId ?? "", {
    query: { enabled: Boolean(venueProfileId), retry: false },
  });
  const rooms = stages.data ?? [];
  if (rooms.length === 0) return null;

  return (
    <div>
      <span style={labelStyle}>Room / stage</span>
      <Select
        value={value ?? NO_ROOM}
        onChange={(next) =>
          onChange(
            next === NO_ROOM
              ? null
              : { id: next, capacity: rooms.find((room) => room.id === next)?.capacity ?? null },
          )
        }
        options={[
          { value: NO_ROOM, label: "The whole venue" },
          ...rooms.map((room) => ({
            value: room.id,
            label: room.capacity == null ? room.name : `${room.name} · ${room.capacity} cap`,
          })),
        ]}
      />
    </div>
  );
}
