import { getGetApiV1EventsIdQueryKey, usePatchApiV1EventsId } from "@showme/api-client";
import { Avatar, Button, Icon, Select, TextField, useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { EventInlineInformation } from "./EventInlineInformation";
import { EventScheduleCard } from "./EventScheduleCard";
import { ProfileImageField } from "./ProfileImageField";
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
  /** Whose event this is — a poster is uploaded into THIS profile's folder. */
  hostProfileId: string;
  /** The poster, resolved and signed by the API. Null when there is none. */
  imageUrl: string | null;
  capacity: number | null;
  stageId: string | null;
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
export interface Guest {
  id: string;
  name: string;
  tickets: number;
  invitedBy: string;
}

export interface DetailsPerformer {
  id: string;
  name: string;
  initials: string;
  /** The act's own picture, straight off the roster (`serialize/participant.ts`
   * resolves it). Nullable — an off-platform act has no profile to take one from. */
  avatarUrl: string | null;
  sub: string;
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
      <EventScheduleCard eventId={event.id} eventDate={event.eventDate} canEdit={canEdit} />
      {canSeeExtras && (
        <GuestListCard
          guestList={extras.guestList ?? {}}
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
              <Avatar
                src={performer.avatarUrl ?? undefined}
                alt=""
                initials={performer.initials}
                tone="brand"
                shape="square"
                size={34}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                  {performer.name}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{performer.sub}</div>
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
  canEdit,
  onSave,
  onDraft,
  onCommit,
}: {
  guestList: NonNullable<EventExtras["guestList"]>;
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
    };
    onSave({ ...guestList, guests: [...guests, guest] });
    setName("");
    setTickets("1");
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
          label="Limit list to total tickets"
          value={guestList.limitTotal ?? null}
          disabled={!canEdit}
          placeholder="No limit"
          onDraft={(limitTotal) => onDraft({ ...guestList, limitTotal })}
          onCommit={onCommit}
        />
        <NumericField
          label="Limit tickets per guest"
          value={guestList.limitPerGuest ?? null}
          disabled={!canEdit}
          placeholder="No limit"
          onDraft={(limitPerGuest) => onDraft({ ...guestList, limitPerGuest })}
          onCommit={onCommit}
        />
      </div>

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
            <span style={{ flex: 1 }}>{guest.name}</span>
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
                onClick={() =>
                  onSave({
                    ...guestList,
                    guests: guests.filter((_, position) => position !== index),
                  })
                }
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
      onBlur={onCommit}
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
}: {
  tiers: TicketTier[];
  capacity: number | null;
  ticketing: EventExtras["ticketing"] | null;
  currency: string;
  canEdit: boolean;
  onSave: (next: TicketTier[]) => void;
  onDraft: (next: TicketTier[]) => void;
  onCommit: () => void;
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
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
          {inventoryTotal.toLocaleString("en-US")} max · {estimateTotal.toLocaleString("en-US")}{" "}
          est.
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

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

// Re-export so the parent can format the guarantee consistently.
export { formatMoney };
