import { useGetApiV1ProfilesIdStages } from "@showme/api-client";
import { Icon, StatusDot, TextField } from "@showme/design-system";
import { type ReactNode, useMemo } from "react";
import { useDateConflicts } from "../hooks/useDateConflicts";
import { formatDay } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";
import { EventInlineDateChoice, EventInlineOptionChoice } from "./EventInlineChoice";
import {
  EVENT_INLINE_CONTROL_BOX,
  EventInlineField,
  EventInlineFieldGrid,
  EventInlineGlyphValue,
  eventInlineSlot,
} from "./EventInlineField";
import { EventPublishPanel } from "./EventPublishPanel";
import { EventVenuePicker } from "./EventVenuePicker";
import {
  EVENT_INLINE_FIELD_LABEL,
  EVENT_STATUS_OPTIONS,
  type EditableEventInformation,
  type EventInlineRoom,
  useEventInlineFields,
} from "./useEventInlineFields";

export interface EventInlineInformationProps {
  event: EditableEventInformation;
  operatorName: string;
  /** The first performer on the bill, or "" for none — read-only here; the bill
   * is owned by the participants surface. */
  performerName: string;
  /** The caller holds `event.edit` — the same signal the API's PATCH gate uses,
   * so the affordance cannot outrun it. */
  canEdit: boolean;
}

/**
 * The Event Information card's fields, edited where they are read.
 *
 * This replaces a pencil that opened a modal over the whole screen to change
 * five values that were already on it. A row is a value until you click it (or
 * tab to it and press Enter), then it is the control for that value, then it is
 * the value again — the operator never loses sight of the event they are editing
 * and never has to decide what "Save changes" covers.
 *
 * Rows that are NOT edited here — the performer, the operator, the status — keep
 * the same geometry and no affordance, so the difference between "you can change
 * this" and "this is owned elsewhere" is visible without clicking anything.
 *
 * The commit model, the optimistic lock and the conflict path are all in
 * `useEventInlineFields`; the row behaviour (keyboard, focus return, the empty
 * value that is still reachable) is in `EventInlineField`. This file only says
 * which fields exist and how each one reads.
 */
export function EventInlineInformation({
  event,
  operatorName,
  performerName,
  canEdit,
}: EventInlineInformationProps) {
  const inline = useEventInlineFields(event);

  /**
   * The venue's rooms, so this card can NAME the one the show is in rather than
   * say "Assigned". Skipped when the event stands at no venue profile — the
   * wizard captures a free-text venue name for a room the operator does not run,
   * and there is nobody to ask for its rooms.
   */
  const rooms = useGetApiV1ProfilesIdStages(event.venueProfileId ?? "", {
    query: { enabled: Boolean(event.venueProfileId) },
  });
  /** "No room set" leads the list because it is a real choice, not an empty
   * state: a show whose room nobody has decided yet is a different statement
   * from one in the main hall — and it costs the venue every room's availability
   * that night until it is placed. */
  const roomChoices = useMemo<EventInlineRoom[]>(
    () => [
      { id: "", name: "No room set", capacity: null },
      ...(rooms.data ?? []).map((room) => ({
        id: room.id,
        name: room.name,
        capacity: room.capacity,
      })),
    ],
    [rooms.data],
  );

  const dateConflicts = useDateConflicts({
    venueProfileId: event.venueProfileId ?? null,
    // The draft, so the warning tracks what is being typed rather than what is
    // already saved. Only while the field is open — otherwise every event page
    // would ask this on load for a date nobody is changing.
    date: inline.editingField === "eventDate" ? inline.draft : null,
    stageId: inline.values.stageId || null,
    excludeEventId: event.id,
  });

  const stageId = inline.values.stageId;
  const roomText = (() => {
    if (stageId === "") return "";
    // A room id we cannot resolve is not "not set": the show IS in a room, we
    // just could not read the list (no venue profile, or the request has not
    // landed).
    return roomChoices.find((room) => room.id === stageId)?.name ?? "Assigned";
  })();
  const draftRoom = roomChoices.find((room) => room.id === inline.draft);

  const capacityText = inline.values.capacity;
  const status = apiStatusToDisplay(inline.values.status);
  const isEditing = (field: keyof typeof EVENT_INLINE_FIELD_LABEL) => inline.editingField === field;

  return (
    <>
      {inline.conflict && (
        <EventInlineNotice onDismiss={inline.dismissConflict}>
          Someone else changed this event while you were editing. Your{" "}
          {inline.conflict.label.toLowerCase()} — <strong>{inline.conflict.attempted}</strong> — was{" "}
          <strong>not</strong> saved. This card now shows their version; set it again if you still
          want it.
        </EventInlineNotice>
      )}

      {/* A refusal is the answer to the question just asked — a free plan
          declining `confirmed`, most often — so it stays on the card in the
          API's own words rather than only flashing past in a toast. */}
      {inline.refusal && (
        <EventInlineNotice onDismiss={inline.dismissRefusal}>
          {inline.refusal.message}
        </EventInlineNotice>
      )}

      <EventInlineFieldGrid>
        <EventInlineField
          label={EVENT_INLINE_FIELD_LABEL.title}
          valueText={inline.values.title}
          emptyLabel="Add a name"
          editable={canEdit}
          isEditing={isEditing("title")}
          onBegin={() => inline.begin("title")}
          onCancel={inline.cancel}
          onCommit={inline.commitDraft}
          error={isEditing("title") ? inline.draftError : null}
        >
          <TextField
            className={eventInlineSlot.text}
            aria-label={EVENT_INLINE_FIELD_LABEL.title}
            value={inline.draft}
            onChange={(changeEvent) => inline.changeDraft(changeEvent.target.value)}
            placeholder="e.g. Open Mic Wednesdays"
            autoFocus
          />
        </EventInlineField>

        <EventInlineField
          label={EVENT_INLINE_FIELD_LABEL.eventDate}
          // The house format ("13 Sept 2026"), not this card's own shorter one:
          // it used to print "05 Dec" with no year, on a screen that routinely
          // holds next year's shows. Kept as TEXT rather than a `DateText` — the
          // row IS the control for this field, and a link inside a click target
          // is not a thing. "" (not "—") when unset, so the row still offers
          // its "Add a date" empty label.
          valueText={inline.values.eventDate ? formatDay(inline.values.eventDate) : ""}
          emptyLabel="Add a date"
          editable={canEdit}
          isEditing={isEditing("eventDate")}
          onBegin={() => inline.begin("eventDate")}
          onCancel={inline.cancel}
          // A day is PICKED, and the calendar it is picked on is a popover: a
          // click inside it reads as focus leaving this control, so blur cannot
          // be allowed to decide anything. Cancel and Save decide instead.
          commitOnBlur={false}
          hasOpenPicker={isEditing("eventDate")}
        >
          <EventInlineDateChoice
            label={EVENT_INLINE_FIELD_LABEL.eventDate}
            value={inline.draft}
            canSave={inline.hasUnsavedChanges}
            onChange={inline.changeDraft}
            onCancel={inline.cancel}
            onSave={inline.commitDraft}
          />
          {/* The same warning the create wizard gives, on the other way a date
              gets set (ClickUp 86cbceux0). Asked about the DRAFT rather than the
              saved value, so it answers the date being typed; and excluding this
              event, so moving a show never reports it as clashing with itself.
              It warns and nothing more — Save stays enabled. */}
          {dateConflicts.message && (
            <output
              style={{
                display: "block",
                margin: "6px 0 0",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--brand-amber)",
              }}
            >
              {dateConflicts.message}
            </output>
          )}
        </EventInlineField>

        <EventInlineField
          label={EVENT_INLINE_FIELD_LABEL.venueName}
          valueText={inline.values.venueName}
          emptyLabel="Add a venue"
          valueNode={
            event.venueProfileId && inline.values.venueName !== "" ? (
              <EventInlineGlyphValue glyph={<Icon name="building" size={13} />}>
                {inline.values.venueName}
              </EventInlineGlyphValue>
            ) : undefined
          }
          editable={canEdit}
          isEditing={isEditing("venueName")}
          onBegin={() => inline.begin("venueName")}
          onCancel={inline.cancel}
          onCommit={inline.commitDraft}
          noteAbove
          hint={
            event.venueProfileId
              ? "Linked to a venue profile. Anything this event had not filled in — capacity, house curfew, amenities, city — came from it, and everything already typed was left alone. Take the chip off to unlink it."
              : "Type any name, or pick the room off shoWMe and it fills in what this event is still missing: capacity, house curfew, amenities and city. Nothing already typed is touched."
          }
        >
          <span className={eventInlineSlot.venue}>
            <EventVenuePicker
              value={inline.draft}
              onChangeText={(text) => inline.changeDraft(text)}
              onSelectProfile={(choice) =>
                choice ? inline.chooseVenueProfile(choice) : inline.unlinkVenueProfileOnCommit()
              }
              selectedProfileId={event.venueProfileId ?? null}
              placeholder="Search shoWMe, or type a name…"
              inputStyle={EVENT_INLINE_CONTROL_BOX}
              inputAriaLabel={EVENT_INLINE_FIELD_LABEL.venueName}
            />
          </span>
        </EventInlineField>

        <EventInlineField
          label={EVENT_INLINE_FIELD_LABEL.stageId}
          valueText={roomText}
          // Not "add a room": a show whose room nobody has decided yet is a real
          // state, and the picker's own first option says the same words.
          emptyLabel="No room set"
          // A picker with nothing to pick is a dead end: with no venue profile,
          // or a venue that has recorded no rooms, the place to add one is the
          // venue's own profile.
          editable={canEdit && roomChoices.length > 1}
          isEditing={isEditing("stageId")}
          onBegin={() => inline.begin("stageId")}
          onCancel={inline.cancel}
          // Same reason as the day: the list is a popover, so blur means "the
          // popover opened", not "the operator finished".
          commitOnBlur={false}
          hasOpenPicker={isEditing("stageId")}
        >
          <EventInlineOptionChoice
            label={EVENT_INLINE_FIELD_LABEL.stageId}
            options={roomChoices.map((room) => ({
              value: room.id,
              label: room.name,
              description:
                room.capacity != null
                  ? `Holds ${room.capacity.toLocaleString("en-US")}`
                  : undefined,
            }))}
            value={inline.draft}
            placeholder="No room set"
            canSave={inline.hasUnsavedChanges}
            hint="Each room is its own calendar — two rooms can hold two shows the same night. A show with no room set counts against every room's availability."
            // Said BEFORE Save, not discovered after it. A room is a more
            // specific statement than a building, so its capacity wins over the
            // one the venue filled in — but only on Save, and only if the room
            // states one.
            consequence={
              draftRoom?.capacity != null && String(draftRoom.capacity) !== capacityText
                ? `Saving also sets the capacity to ${draftRoom.capacity.toLocaleString("en-US")}, from ${draftRoom.name}.`
                : undefined
            }
            onChange={inline.changeDraft}
            onCancel={inline.cancel}
            onSave={() => draftRoom && inline.saveRoom(draftRoom)}
          />
        </EventInlineField>

        <EventInlineField
          label="Performer"
          valueText={performerName}
          isEditing={false}
          onBegin={() => {}}
          onCancel={() => {}}
        />

        <EventInlineField
          label={EVENT_INLINE_FIELD_LABEL.capacity}
          valueText={capacityText === "" ? "" : Number(capacityText).toLocaleString("en-US")}
          emptyLabel="Add a capacity"
          sourceNote={
            inline.capacityFromRoom ? `from ${inline.capacityFromRoom.roomName}` : undefined
          }
          editable={canEdit}
          isEditing={isEditing("capacity")}
          onBegin={() => inline.begin("capacity")}
          onCancel={inline.cancel}
          onCommit={inline.commitDraft}
          error={isEditing("capacity") ? inline.draftError : null}
        >
          <TextField
            className={eventInlineSlot.text}
            aria-label={EVENT_INLINE_FIELD_LABEL.capacity}
            type="number"
            min={0}
            step={1}
            value={inline.draft}
            onChange={(changeEvent) => inline.changeDraft(changeEvent.target.value)}
            placeholder="Leave empty for no capacity"
            autoFocus
          />
        </EventInlineField>

        <EventInlineField
          label="Operator"
          valueText={operatorName}
          isEditing={false}
          onBegin={() => {}}
          onCancel={() => {}}
        />

        {/* Status moved here from a Select above the tabs. It is one of the
            event's facts, and it belongs on the card that holds the facts —
            read and changed in the same place as the rest of them. Nothing about
            WHO may set it moved with it: `PATCH /events/:id` has always taken
            the whole enum behind `event.edit`, and counterparty consent still
            lives where it always did, on the deal and the invitation. */}
        <EventInlineField
          label={EVENT_INLINE_FIELD_LABEL.status}
          valueText={status.label}
          valueNode={
            <EventInlineGlyphValue glyph={<StatusDot status={status.status} size={8} />}>
              {status.label}
            </EventInlineGlyphValue>
          }
          editable={canEdit}
          isEditing={isEditing("status")}
          onBegin={() => inline.begin("status")}
          onCancel={inline.cancel}
          commitOnBlur={false}
          hasOpenPicker={isEditing("status")}
        >
          <EventInlineOptionChoice
            label={EVENT_INLINE_FIELD_LABEL.status}
            // The glyph rides on the LABEL, so the same definition draws the
            // dot in the menu and on the row behind it.
            options={EVENT_STATUS_OPTIONS.map((option) => ({
              value: option.value,
              label: (
                <EventInlineGlyphValue
                  glyph={<StatusDot status={apiStatusToDisplay(option.value).status} size={8} />}
                >
                  {option.label}
                </EventInlineGlyphValue>
              ),
              searchText: option.label,
              description: option.description,
            }))}
            value={inline.draft}
            placeholder="Not set"
            canSave={inline.hasUnsavedChanges}
            onChange={inline.changeDraft}
            onCancel={inline.cancel}
            onSave={inline.commitDraft}
          />
        </EventInlineField>
      </EventInlineFieldGrid>

      {inline.isSaving && (
        <output
          style={{
            display: "block",
            marginTop: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          Saving…
        </output>
      )}

      {/* Publishing lives here, at the foot of the card, because it is the one
          place the operator is already deciding what this event says about
          itself. It is NOT one of the fields above: it takes effect the moment
          it is pressed, on its own route and its own capability — see the panel
          itself for the reasoning. It is told when an editor is holding an
          unsaved value, because the public page renders the SAVED row. */}
      {canEdit && (
        <EventPublishPanel
          eventId={event.id}
          hasUnsavedChanges={inline.hasUnsavedChanges}
          disabled={inline.conflict !== null}
        />
      )}
    </>
  );
}

/**
 * Something the card has to keep saying after the toast has gone.
 *
 * Two things use it. A save that lost the optimistic lock (decisions #8) names
 * the field and quotes what was thrown away, because inline editing gives the
 * operator no draft to go back to: the row has already snapped to the other
 * writer's version, and without the quote the only record of what they meant is
 * their memory. A refusal repeats the server's own sentence, because "couldn't
 * save" is not the same information as "the free plan allows three confirmed
 * events".
 *
 * Amber, like every other "this is not going to work" notice on the event
 * screen — never red, which this app reserves for something that already failed.
 */
function EventInlineNotice({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        background: "color-mix(in srgb,#F4A046 12%,transparent)",
        border: "1px solid color-mix(in srgb,#F4A046 30%,transparent)",
        borderRadius: 11,
        padding: "11px 14px",
        marginBottom: 14,
        color: "#c8842f",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <Icon name="alert" size={16} />
      <span style={{ flex: 1 }}>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          border: 0,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          padding: 0,
          fontSize: 12.5,
          textDecoration: "underline",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
