import { getGetApiV1EventsIdQueryKey, usePatchApiV1EventsId } from "@showme/api-client";
import { Button, Icon, Select, TextField, useToast } from "@showme/design-system";
import { type GuestListEntry, guestListProblem } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { EventInlineInformation } from "./EventInlineInformation";
import { EventScheduleCard } from "./EventScheduleCard";
import { ProfileFace } from "./ProfileFace";
import { ProfileImageField } from "./ProfileImageField";
import { ProfileNameMenu } from "./ProfileNameMenu";
import { RidersDocumentsCard } from "./RidersDocumentsCard";
import styles from "./eventDetailsFields.module.css";
import { CardHeader, Eyebrow, GlyphButton, MonoPill, SectionCard, XIcon } from "./eventUi";
import { useEventExtrasEditor } from "./useEventExtrasEditor";
import { useProfileImageUpload } from "./useProfileImageUpload";

/** Local, decoupled shapes for the event-detail sections — kept minimal so this
 * file doesn't depend on the exact generated model names (structurally equal). */
export interface DetailsEvent {
  id: string;
  title: string;
  status: string;
  eventDate: string | null;
  doorTime: string | null;
  startTime: string | null;
  endTime: string | null;
  curfew: string | null;
  venueName: string | null;
  /** The venue PROFILE this event is placed at, when one is linked. */
  venueProfileId?: string | null;
  /**
   * That venue's address, shown read-only beside its name (ClickUp
   * `123qy9rnfab`). Owned by the venue's own profile — a show does not move a
   * building — so it is passed through rather than edited here.
   */
  venueLocation?: {
    street?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
  /** The venue's public slug — the address "Go to profile" needs (`123qy9rnfab`). */
  venueSlug?: string | null;
  /** Whose event this is — a poster is uploaded into THIS profile's folder. */
  hostProfileId: string;
  /** The poster, resolved and signed by the API. Null when there is none. */
  imageUrl: string | null;
  capacity: number | null;
  stageId: string | null;
  /** The name of that room, carried by the event — see `roomFieldText`. */
  stageName?: string | null;
  version: number;
  extras?: EventExtras | null;
}

export interface EventExtras {
  amenities?: string[];
  /** The venue's own prose, COPIED onto the event when it was placed there —
   * never a live read of the profile (`EventHospitalityCard` explains why). */
  soundSystem?: string | null;
  cateringNotes?: string | null;
  accommodationNotes?: string | null;
  artistLogisticsNotes?: string | null;
  city?: string | null;
  country?: string | null;
  /** The receipt for that copy: which room, when, and exactly what arrived. */
  venueCarryOver?: {
    profileId: string;
    venueName: string;
    copiedAt: string;
    fields: string[];
  };
  ticketTiers?: TicketTier[];
  guestList?: {
    limitTotal?: number | null;
    limitPerGuest?: number | null;
    guests?: Guest[];
  };
  ticketing?: { provider?: string | null; syncedAt?: string | null };
  [key: string]: unknown;
}
export interface TicketTier {
  id: string;
  name: string;
  price: number;
  max: number;
  est: number;
}
/**
 * One row of the guest list. Aliased to the shared shape rather than restated,
 * so the card, the API's `event-extras` schema and the limit rule cannot drift
 * apart — the `note` field going missing from one of three copies is exactly how
 * it went missing in the first place.
 */
export type Guest = GuestListEntry;

export interface DetailsPerformer {
  id: string;
  name: string;
  initials: string;
  /** The act's own picture, straight off the roster (`serialize/participant.ts`
   * resolves it). Nullable — an off-platform act has no profile to take one from. */
  avatarUrl: string | null;
  /** The act's public profile slug, when they have a published page. */
  slug?: string | null;
  sub: string;
  /** What the act calls itself, from their own profile. Empty renders nothing. */
  genres: string[];
  connected: boolean;
}
export interface DetailsRider {
  id: string;
  name: string;
  type: string;
  description: string | null;
  /** The attached document, or null for a rider that is only written down. */
  file: { name: string; contentType: string | null; sizeBytes: number | null } | null;
}
/** Pre-formatted schedule row. Superseded by `EventScheduleCard`, which reads
 * `/events/:id/schedule` itself so it has the ids an edit needs; kept because
 * the parent still composes and passes it. */
export interface DetailsScheduleEntry {
  time: string;
  label: string;
}
export interface EventDetailsTabProps {
  event: DetailsEvent;
  operatorName: string;
  performers: DetailsPerformer[];
  riders: DetailsRider[];
  /** @deprecated The Event Schedule card loads and writes the schedule itself. */
  schedule?: DetailsScheduleEntry[];
  currency: string;
  /** @deprecated Superseded by `useEventExtrasEditor`, which tracks the event
   * version from each PATCH response instead of the last completed refetch —
   * see the hook for the lost-update race this replaces. */
  onSaveExtras?: (next: EventExtras) => void;
  canEdit: boolean;
}

const rowBorder = { borderBottom: "1px solid var(--border)" } as const;

export function EventDetailsTab({
  event,
  operatorName,
  performers,
  riders,
  currency,
  canEdit,
}: EventDetailsTabProps) {
  // One editor for every `extras` card on the tab: a single draft, a single
  // write queue, and one authoritative version — so two edits in a row on two
  // different cards can't overwrite each other.
  const extrasEditor = useEventExtrasEditor(event);
  const extras = extrasEditor.extras;
  const stack = { display: "flex", flexDirection: "column", gap: 16 } as const;

  // `extras` is operator-only: the serializer omits the KEY entirely for a caller
  // without `event.edit` (apps/api/src/serialize/event.ts), so an absent field —
  // not an empty one — is the signal. Drawing the amenities / guest-list / ticket
  // cards anyway would show a performer three empty shells and imply the operator
  // has filled in nothing, when the truth is that they aren't allowed to look.
  const canSeeExtras = event.extras !== undefined;

  return (
    <div style={stack}>
      <EventInformationCard
        event={event}
        operatorName={operatorName}
        performers={performers}
        canEdit={canEdit}
      />
      <EventPosterCard event={event} canEdit={canEdit} />
      <RidersDocumentsCard eventId={event.id} riders={riders} />
      {/* The four times come from the event the card is already inside, so a starting
          point agrees with the header rather than inventing its own doors
          (ClickUp `123qy9rpvfq`). */}
      <EventScheduleCard
        eventId={event.id}
        eventDate={event.eventDate}
        canEdit={canEdit}
        times={{
          doorTime: event.doorTime,
          startTime: event.startTime,
          endTime: event.endTime,
          curfew: event.curfew,
        }}
      />
      {canSeeExtras && (
        <GuestListCard
          guestList={extras.guestList ?? {}}
          savedGuestList={event.extras?.guestList ?? {}}
          canEdit={canEdit}
          onSave={(guestList) => extrasEditor.save({ ...extras, guestList })}
          onDraft={(guestList) => extrasEditor.change({ ...extras, guestList })}
          onCommit={extrasEditor.commit}
        />
      )}
      {canSeeExtras && (
        <TicketInformationCard
          tiers={extras.ticketTiers ?? []}
          capacity={event.capacity}
          ticketing={extras.ticketing ?? null}
          currency={currency}
          canEdit={canEdit}
          onSave={(ticketTiers) => extrasEditor.save({ ...extras, ticketTiers })}
          onDraft={(ticketTiers) => extrasEditor.change({ ...extras, ticketTiers })}
          onCommit={extrasEditor.commit}
          hasUnwrittenChanges={extrasEditor.hasUnwrittenChanges}
        />
      )}
    </div>
  );
}

function EventInformationCard({
  event,
  operatorName,
  performers,
  canEdit,
}: {
  event: DetailsEvent;
  operatorName: string;
  performers: DetailsPerformer[];
  canEdit: boolean;
}) {
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="calendar" size={17} />}
        iconColor="#EE5746"
        title="Event Information"
      />
      {/* No Edit button, and no modal behind it. The six values this card used
          to hand to a popup or to a control somewhere else — name, date, venue,
          room, capacity, status — are edited on the rows that show them
          (`EventInlineInformation`), which is what the old app did and what the
          operator asked for. */}
      <EventInlineInformation
        event={event}
        operatorName={operatorName}
        performerName={performers[0]?.name ?? ""}
        canEdit={canEdit}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "20px 0 10px",
        }}
      >
        <Eyebrow>Performers</Eyebrow>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {performers.length === 0 ? (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>No performers added yet.</div>
        ) : (
          performers.map((performer) => (
            <div
              key={performer.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "var(--elevated)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "13px 16px",
              }}
            >
              {/* The face is a door too, not only the name beside it
                  (`86cbcn1je`: "Profile avatars across the platform show images but
                  still don't link to the public profile pages"). Same slug the name's
                  menu uses, so the two cannot disagree about whether there is a page —
                  and `ProfileFace` draws a plain avatar when there is none, which is
                  every unpublished act and every off-platform hand.

                  Safe here, where it is not in `Events.tsx`: this row is a plain div.
                  The list row is a click target and a link inside it would be a link
                  within a link. */}
              <ProfileFace
                avatarUrl={performer.avatarUrl}
                publicSlug={performer.slug}
                name={performer.name}
                tone="brand"
                size={34}
                shape="square"
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                  {/* "Go to profile", and no map: Ran asked for the map on the
                      VENUE only, and an act's address is not a place anybody is
                      being sent to (ClickUp `123qy9rnfab`). */}
                  <ProfileNameMenu name={performer.name} slug={performer.slug} />
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{performer.sub}</div>
                {/* The act's genres, under the venue line (ClickUp `86cbcf6gr`). A
                    middot list rather than chips: this is a reading line on a details
                    card, and a row of pills here would compete with the status dot
                    beside it for the eye. */}
                {performer.genres.length > 0 && (
                  <div style={{ color: "var(--dim)", fontSize: 12 }}>
                    {performer.genres.join(" · ")}
                  </div>
                )}
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: performer.connected ? "#6FC97A" : "var(--muted)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: performer.connected ? "#6FC97A" : "var(--dim)",
                  }}
                />
                {performer.connected ? "Connected" : "Invited"}
              </span>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}

/**
 * The show's poster — the one picture an event has, and the only thing on this
 * tab that is FOR the public.
 *
 * Everything else here is operational (the guest list, the ticket tiers, the
 * riders); this is what a fan sees on the venue's programme and on the show's own
 * page. It sits directly under the information card because it is part of what
 * the show IS, not an attachment to it.
 *
 * WHO MAY SET IT: whoever may edit the event AND is acting as the host profile.
 * That second half is not this component being cautious — the bytes go into the
 * host's storage folder, and `POST /files/upload-url` only issues a write URL to
 * an owner or admin of that profile. An agent holds `event.edit` and would get a
 * refusal from storage, so the picker is not offered to them; they see the poster
 * as everyone else does.
 *
 * The save carries NO `expectedVersion`. Optimistic locking is there for the form
 * fields two people edit at once (`useEventExtrasEditor` explains the race it
 * fixes); a poster is one scalar, replacing it is the whole intent, and a 409 in
 * the face of someone who just picked a picture buys nothing.
 */
function EventPosterCard({ event, canEdit }: { event: DetailsEvent; canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const upload = useProfileImageUpload(event.hostProfileId);
  const isHost = getActiveProfileId() === event.hostProfileId;
  const mayChange = canEdit && isHost;

  const patch = usePatchApiV1EventsId({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(event.id) });
      },
      onError: (error) => toast.error(errorMessage(error, "Couldn't save the poster.")),
    },
  });

  const setPoster = (imageFileId: string | null) => {
    // Both halves of the ladder are sent: picking a file must clear an address
    // the show was pointing at before, and removing must clear both.
    patch.mutate({ id: event.id, data: { imageFileId, imageUrl: null } });
  };

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="image" />}
        title="Poster"
        action={
          event.imageUrl ? undefined : (
            <span style={{ color: "var(--dim)", fontSize: 12.5 }}>Optional</span>
          )
        }
      />
      <p style={{ margin: "6px 0 14px", color: "var(--muted)", fontSize: 13.5 }}>
        Shown on this show&rsquo;s public page and on the programme of everyone billed on it. Wide
        artwork works best.
      </p>
      <div style={{ maxWidth: 420 }}>
        <ProfileImageField
          label="Show poster"
          hint={
            mayChange
              ? "Around 1200×800. It leads the public page for this show."
              : isHost
                ? "You need edit rights on this show to change its poster."
                : "Only the profile operating this show can change its poster."
          }
          previewUrl={event.imageUrl}
          shape="banner"
          isUploading={upload.isUploading || patch.isPending}
          disabled={!mayChange}
          onPick={async (file) => {
            const fileId = await upload.upload(file);
            if (fileId) setPoster(fileId);
          }}
          onRemove={() => setPoster(null)}
        />
      </div>
      {upload.error && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
          {upload.error}
        </p>
      )}
    </SectionCard>
  );
}

function GuestListCard({
  guestList,
  savedGuestList,
  canEdit,
  onSave,
  onDraft,
  onCommit,
}: {
  guestList: NonNullable<EventExtras["guestList"]>;
  /**
   * The list as the SERVER holds it. Only ever read to put a refused limit back:
   * `guestList` above is the draft, so once a lowered limit has been rejected
   * there is nothing else on the screen that still knows what it was.
   */
  savedGuestList: NonNullable<EventExtras["guestList"]>;
  canEdit: boolean;
  onSave: (next: NonNullable<EventExtras["guestList"]>) => void;
  onDraft: (next: NonNullable<EventExtras["guestList"]>) => void;
  onCommit: () => void;
}) {
  const guests = guestList.guests ?? [];
  const total = guests.reduce((sum, guest) => sum + (guest.tickets || 0), 0);
  const [name, setName] = useState("");
  const [tickets, setTickets] = useState("1");
  const [invitedBy, setInvitedBy] = useState("Promoter");
  const [note, setNote] = useState("");
  /**
   * Why the last thing the operator tried was not saved, in the same sentence the
   * API would have answered with (`@showme/shared/guest-list` is the one rule,
   * called on both sides). Held rather than toasted because it belongs beside the
   * fields it is about — and cleared by the next thing that works.
   */
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * Bumped whenever a limit is refused, and part of both limit fields' `key`.
   *
   * `NumericField` holds the digits as its own text so a half-typed value
   * survives, and it seeds that text once. Putting the draft back therefore is
   * not enough on its own — the box would go on showing a number nothing stored,
   * which is the one thing a refusal must not leave behind. Remounting re-seeds
   * it from the saved value, so what is on screen is what is in the document.
   */
  const [limitResetToken, setLimitResetToken] = useState(0);

  const add = () => {
    const trimmed = name.trim();
    const count = Number(tickets);
    if (!trimmed || !Number.isFinite(count) || count < 1) return;
    const guest: Guest = {
      // Time-stamped so removing a guest and re-adding the same name can't
      // collide with a live row's id.
      id: `guest-${Date.now()}-${trimmed.replace(/\s+/g, "-").toLowerCase()}`,
      name: trimmed,
      tickets: count,
      invitedBy,
      ...(note.trim() !== "" ? { note: note.trim() } : {}),
    };
    const next = { ...guestList, guests: [...guests, guest] };
    // The limits are checked HERE, before the write, so an over-limit guest is
    // refused under the cursor rather than after a round trip. The server checks
    // the same thing and has the last word.
    const refusal = guestListProblem(next);
    if (refusal) {
      setProblem(refusal);
      return;
    }
    setProblem(null);
    onSave(next);
    setName("");
    setTickets("1");
    setNote("");
  };

  /**
   * A limit, once the operator has finished typing it.
   *
   * Lowering one under a list that already breaks it is REFUSED rather than
   * stored-and-flagged (see `guest-list.ts` for the reasoning), so the field goes
   * back to the value the server holds and the sentence says which guests are in
   * the way. Only the limits are reverted — anything else the draft is carrying
   * is somebody's unrelated edit and is not this refusal's business.
   */
  const commitLimits = () => {
    const refusal = guestListProblem(guestList);
    if (refusal) {
      setProblem(refusal);
      onDraft({
        ...guestList,
        limitTotal: savedGuestList.limitTotal ?? null,
        limitPerGuest: savedGuestList.limitPerGuest ?? null,
      });
      setLimitResetToken((token) => token + 1);
      return;
    }
    setProblem(null);
    onCommit();
  };

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="users" size={17} />}
        iconColor="#EE5746"
        title="Guest List"
        action={<MonoPill>{total} tickets</MonoPill>}
      />
      {/* The limits are settings for the list below, not a separate object, so a
          tinted box of their own overstated them — and on a white card in light
          mode the beige ground read as a stray panel. A rule does the same job:
          it says "these belong together and the list starts after them" without
          drawing a second surface inside the first. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          paddingBottom: 16,
          marginBottom: 16,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <NumericField
          key={`limit-total-${limitResetToken}`}
          label="Limit list to total tickets"
          value={guestList.limitTotal ?? null}
          disabled={!canEdit}
          placeholder="No limit"
          onDraft={(limitTotal) => onDraft({ ...guestList, limitTotal })}
          onCommit={commitLimits}
        />
        <NumericField
          key={`limit-per-guest-${limitResetToken}`}
          label="Limit tickets per guest"
          value={guestList.limitPerGuest ?? null}
          disabled={!canEdit}
          placeholder="No limit"
          onDraft={(limitPerGuest) => onDraft({ ...guestList, limitPerGuest })}
          onCommit={commitLimits}
        />
      </div>

      {problem && (
        <p role="alert" style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--brand-red)" }}>
          {problem}
        </p>
      )}

      {canEdit && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 140 }}>
            <TextField
              label="Guest name"
              value={name}
              onChange={(changeEvent) => setName(changeEvent.target.value)}
              onKeyDown={(keyEvent) => keyEvent.key === "Enter" && add()}
              placeholder="Full name…"
            />
          </div>
          <div style={{ width: 90 }}>
            <TextField
              label="Tickets"
              type="number"
              min={1}
              className={styles.numeric}
              value={tickets}
              onChange={(changeEvent) => setTickets(changeEvent.target.value)}
            />
          </div>
          <div style={{ width: 150 }}>
            <Select
              label="Invited by"
              value={invitedBy}
              onChange={setInvitedBy}
              options={["Promoter", "Performer", "Venue"]}
            />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <TextField
              label="Note"
              value={note}
              onChange={(changeEvent) => setNote(changeEvent.target.value)}
              onKeyDown={(keyEvent) => keyEvent.key === "Enter" && add()}
              placeholder="Optional — e.g. collects at the box office"
            />
          </div>
          <Button
            variant="primary"
            aria-label="Add guest"
            onClick={add}
            disabled={name.trim() === ""}
          >
            + Add
          </Button>
        </div>
      )}

      {guests.length === 0 ? (
        <div style={{ color: "var(--dim)", fontSize: 13, padding: "6px 0" }}>
          No guest list added yet.
        </div>
      ) : (
        guests.map((guest, index) => (
          <div
            key={guest.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 0",
              fontSize: 13.5,
              color: "var(--text)",
              ...rowBorder,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span>{guest.name}</span>
              {/* The note is editable in place: one typed on the way in that
                  cannot be corrected afterwards is a note people stop writing.
                  Draft on every keystroke, persist once on blur — the same
                  contract `NumericField` keeps, for the same reason. */}
              {canEdit ? (
                <TextField
                  aria-label={`Note for ${guest.name}`}
                  value={guest.note ?? ""}
                  placeholder="Add a note…"
                  onChange={(changeEvent) =>
                    onDraft({
                      ...guestList,
                      guests: guests.map((row, position) =>
                        position === index ? { ...row, note: changeEvent.target.value } : row,
                      ),
                    })
                  }
                  onBlur={onCommit}
                />
              ) : (
                guest.note && (
                  <span style={{ color: "var(--dim)", fontSize: 12 }}>{guest.note}</span>
                )
              )}
            </div>
            <MonoPill>{guest.invitedBy}</MonoPill>
            <span
              style={{
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                width: 44,
                textAlign: "right",
              }}
            >
              ×{guest.tickets}
            </span>
            {canEdit && (
              <GlyphButton
                ariaLabel={`Remove ${guest.name}`}
                onClick={() => {
                  setProblem(null);
                  onSave({
                    ...guestList,
                    guests: guests.filter((_, position) => position !== index),
                  });
                }}
              >
                <XIcon />
              </GlyphButton>
            )}
          </div>
        ))
      )}
    </SectionCard>
  );
}

/**
 * A number that lives in the saved document: typed freely, held as text so a
 * half-typed value survives, pushed into the draft on every change and
 * persisted once on blur. Empty means "not set" (`null`) when the caller allows
 * it, which is what "No limit" is.
 */
function NumericField({
  label,
  value,
  disabled,
  placeholder,
  emptyValue = null,
  onDraft,
  onCommit,
  ariaLabel,
}: {
  label?: string;
  value: number | null;
  disabled?: boolean;
  placeholder?: string;
  /** What an emptied field means — `null` for a limit, `0` for a ticket count. */
  emptyValue?: number | null;
  onDraft: (next: number | null) => void;
  onCommit: () => void;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value != null ? String(value) : "");
  /**
   * THE FIELD MUST NOT SHOW A FIGURE NOTHING IS HOLDING.
   *
   * This kept its own text and never looked at `value` again after mount, so when a
   * draft was dropped — a 409, a failed write, or the settle path that used to
   * discard in-flight edits — the input went on displaying a number that no longer
   * existed anywhere, and the operator had no way to know. Syncing while the field
   * is NOT focused keeps the display honest without fighting the person typing
   * (re-deriving mid-keystroke would eat a half-typed "1" out of "10").
   */
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value != null ? String(value) : "");
  }, [value, focused]);
  return (
    <TextField
      label={label}
      aria-label={ariaLabel}
      type="number"
      min={0}
      className={styles.numeric}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(changeEvent) => {
        const raw = changeEvent.target.value;
        setText(raw);
        const parsed = Number(raw);
        onDraft(raw.trim() === "" || !Number.isFinite(parsed) ? emptyValue : parsed);
      }}
      /**
       * A CLICK SELECTS WHAT IS THERE, exactly as a tab already does.
       *
       * These cells start at `0` — a figure the system put there, not one anybody
       * typed — and a caret landing before it turns a typed "50" into "500" and a
       * typed "250" into "0250". Tabbing in was always fine, because a tab selects
       * the contents; so the defect only ever bit the reader who reached for the
       * mouse, which is most of them, and it bit silently: the number feeds
       * `seedTicketTiersIntoBudget` and reaches the settlement, so a tenfold error
       * arrives with nothing on screen to question it (QA sweep, 2026-09-27).
       *
       * The trade is that a click no longer places a caret mid-number. For a figure
       * of a few digits, retyping it is the cheaper of the two, and it is what every
       * other numeric cell in this app now does too.
       */
      onFocus={(focusEvent) => {
        setFocused(true);
        focusEvent.currentTarget.select();
      }}
      onMouseUp={(mouseEvent) => {
        // Chrome collapses a focus-time selection when the mouse button comes back
        // up, which would undo the line above for the one input method it exists
        // for. Preventing the default keeps the selection the focus made.
        mouseEvent.preventDefault();
      }}
      onBlur={() => {
        setFocused(false);
        onCommit();
      }}
    />
  );
}

function TicketInformationCard({
  tiers,
  capacity,
  ticketing,
  currency,
  canEdit,
  onSave,
  onDraft,
  onCommit,
  hasUnwrittenChanges,
}: {
  tiers: TicketTier[];
  capacity: number | null;
  ticketing: EventExtras["ticketing"] | null;
  currency: string;
  canEdit: boolean;
  onSave: (next: TicketTier[]) => void;
  onDraft: (next: TicketTier[]) => void;
  onCommit: () => void;
  /** True while the draft holds a figure the server has not been told about. */
  hasUnwrittenChanges: boolean;
}) {
  const inventoryTotal = tiers.reduce((sum, tier) => sum + (tier.max || 0), 0);
  const estimateTotal = tiers.reduce((sum, tier) => sum + (tier.est || 0), 0);
  const overCapacity = capacity != null && inventoryTotal > capacity;
  const symbol = currencySymbol(currency);

  const draftTier = (id: string, field: keyof TicketTier, value: string | number) => {
    onDraft(tiers.map((tier) => (tier.id === id ? { ...tier, [field]: value } : tier)));
  };

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="receipt" size={17} />}
        iconColor="#F4A046"
        title="Ticket Information"
        action={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {ticketing?.provider ? (
              <MonoPill>
                {ticketing.provider} · synced {ticketing.syncedAt ?? "—"}
              </MonoPill>
            ) : (
              // Ticketing stays an INTEGRATION, and it is explicitly later work
              // (decisions #15: `source` + `provider_ref` exist, the
              // `TicketingSync` port is a stub, no provider is wired). Shown
              // disabled so the seam is visible without promising a sync that
              // cannot happen.
              <Button
                variant="ghost"
                disabled
                title="Ticketing-provider sync isn't connected yet — enter tiers by hand for now."
                leftIcon={<Icon name="download" size={13} />}
              >
                Sync from Ticketing Company
              </Button>
            )}
            <MonoPill>
              {capacity != null ? `${capacity.toLocaleString("en-US")} capacity` : "no cap"}
            </MonoPill>
          </span>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
          gap: 8,
          padding: "0 2px 8px",
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "var(--dim)",
        }}
      >
        <span>Ticket type</span>
        <span style={{ textAlign: "right" }}>Price ({symbol})</span>
        <span style={{ textAlign: "right" }}>Max</span>
        <span style={{ textAlign: "right" }}>Est. sales</span>
        <span style={{ width: 28 }} />
      </div>

      {tiers.length === 0 ? (
        <div style={{ color: "var(--dim)", fontSize: 13, padding: "4px 0" }}>
          No ticket types yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tiers.map((tier) => (
            <div
              key={tier.id}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <TextField
                aria-label={`Ticket type name${tier.name ? ` (${tier.name})` : ""}`}
                value={tier.name}
                disabled={!canEdit}
                placeholder="e.g. Early bird"
                onChange={(changeEvent) => draftTier(tier.id, "name", changeEvent.target.value)}
                onBlur={onCommit}
              />
              <NumericField
                ariaLabel={`Price for ${tier.name || "this ticket type"}`}
                value={tier.price}
                disabled={!canEdit}
                emptyValue={0}
                onDraft={(price) => draftTier(tier.id, "price", price ?? 0)}
                onCommit={onCommit}
              />
              <NumericField
                ariaLabel={`Maximum for ${tier.name || "this ticket type"}`}
                value={tier.max}
                disabled={!canEdit}
                emptyValue={0}
                onDraft={(max) => draftTier(tier.id, "max", max ?? 0)}
                onCommit={onCommit}
              />
              <NumericField
                ariaLabel={`Estimated sales for ${tier.name || "this ticket type"}`}
                value={tier.est}
                disabled={!canEdit}
                emptyValue={0}
                onDraft={(est) => draftTier(tier.id, "est", est ?? 0)}
                onCommit={onCommit}
              />
              {canEdit ? (
                <GlyphButton
                  ariaLabel={`Remove ${tier.name || "ticket type"}`}
                  onClick={() => onSave(tiers.filter((row) => row.id !== tier.id))}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  <XIcon size={13} />
                </GlyphButton>
              ) : (
                <span style={{ width: 28 }} />
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() =>
            onSave([...tiers, { id: `tier-${Date.now()}`, name: "", price: 0, max: 0, est: 0 }])
          }
          // Touch: 33px tall and alone under the ticket-tier list, so it simply
          // grows — an overlay would hang 6px over the last tier's own fields.
          className="touch-target"
          style={{
            marginTop: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "1px dashed var(--border-strong)",
            borderRadius: 9,
            padding: "8px 13px",
            color: "var(--muted)",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          + Add ticket type
        </button>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 14,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
          fontSize: 13,
        }}
      >
        <span style={{ color: "var(--muted)" }}>Total inventory</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
          }}
        >
          {inventoryTotal.toLocaleString("en-US")} max · {estimateTotal.toLocaleString("en-US")}{" "}
          est.
          {/*
            THESE FIGURES ARE THE DRAFT'S, and the draft is not the record until the
            field loses focus (QA sweep run 5, QA5-13). The band read "50 max · 40 est."
            while `events.extras.ticketTiers` held `est: 0`, and a reload took the
            screen back to zero — a live total is right, and reading like a saved one is
            not. Blur-saving stays; the band now says which of the two it is.
          */}
          {hasUnwrittenChanges && (
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 11.5,
                color: "var(--brand-amber)",
              }}
            >
              unsaved — click outside the field to save
            </span>
          )}
        </span>
      </div>

      {overCapacity && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "color-mix(in srgb,#F4A046 12%,transparent)",
            border: "1px solid color-mix(in srgb,#F4A046 30%,transparent)",
            borderRadius: 11,
            padding: "11px 14px",
            marginTop: 12,
            color: "#c8842f",
            fontSize: 12.5,
          }}
        >
          <Icon name="alert" size={16} />
          Total ticket inventory exceeds venue capacity ({capacity?.toLocaleString("en-US")}). This
          is allowed, but double-check your allocations.
        </div>
      )}
    </SectionCard>
  );
}

/**
 * The symbol for a currency code — "kr" for SEK, "€" for EUR.
 *
 * Exported because it is not decoration: it is the leftIcon on the Budget
 * Planner's money INPUTS, so it names the currency an operator is typing in. A
 * wrong symbol here is not a cosmetic slip, it is a figure entered under the
 * wrong denomination and settled under another — which is exactly what a
 * "display currency" picker on this screen used to cause (ClickUp 123qy9rnjb8).
 */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

// Re-export so the parent can format the guarantee consistently.
export { formatMoney };
