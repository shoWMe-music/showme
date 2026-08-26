import { Avatar, Icon } from "@showme/design-system";
import { useState } from "react";
import { formatMoney } from "../lib/format";
import { EventInformationEditModal } from "./EventInformationEditModal";
import {
  CardHeader,
  Eyebrow,
  GlyphButton,
  GradientButton,
  InfoPairGrid,
  MonoPill,
  OutlineButton,
  RemovableChip,
  SectionCard,
  XIcon,
  fieldStyle,
} from "./eventUi";
import { useEventInformationEdit } from "./useEventInformationEdit";

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
  capacity: number | null;
  stageId: string | null;
  version: number;
  extras?: EventExtras | null;
}

export interface EventExtras {
  amenities?: string[];
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
  sub: string;
  connected: boolean;
}
export interface DetailsRider {
  id: string;
  name: string;
  type: string;
}
export interface DetailsScheduleEntry {
  time: string;
  label: string;
}
export interface DetailsDeal {
  dealTypeLabel: string;
  costSplit: string | null;
  guarantee: string | null;
}

export interface EventDetailsTabProps {
  event: DetailsEvent;
  statusLabel: string;
  operatorName: string;
  performers: DetailsPerformer[];
  riders: DetailsRider[];
  schedule: DetailsScheduleEntry[];
  deal: DetailsDeal | null;
  currency: string;
  /** Persist an updated extras object (read-modify-write against the event). */
  onSaveExtras: (next: EventExtras) => void;
  canEdit: boolean;
}

const rowBorder = { borderBottom: "1px solid var(--border)" } as const;

export function EventDetailsTab({
  event,
  statusLabel,
  operatorName,
  performers,
  riders,
  schedule,
  deal,
  currency,
  onSaveExtras,
  canEdit,
}: EventDetailsTabProps) {
  const extras = event.extras ?? {};
  const stack = { display: "flex", flexDirection: "column", gap: 16 } as const;

  return (
    <div style={stack}>
      <EventInformationCard
        event={event}
        statusLabel={statusLabel}
        operatorName={operatorName}
        performers={performers}
        canEdit={canEdit}
      />
      <RidersDocumentsCard riders={riders} />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}
      >
        <EventScheduleCard schedule={schedule} />
        <AmenitiesCard
          amenities={extras.amenities ?? []}
          canEdit={canEdit}
          onChange={(amenities) => onSaveExtras({ ...extras, amenities })}
        />
      </div>
      <GuestListCard
        guestList={extras.guestList ?? {}}
        canEdit={canEdit}
        onChange={(guestList) => onSaveExtras({ ...extras, guestList })}
      />
      {deal && <FinancialDealCard deal={deal} />}
      <TicketInformationCard
        tiers={extras.ticketTiers ?? []}
        capacity={event.capacity}
        ticketing={extras.ticketing ?? null}
        currency={currency}
        canEdit={canEdit}
        onChange={(ticketTiers) => onSaveExtras({ ...extras, ticketTiers })}
      />
    </div>
  );
}

function EventInformationCard({
  event,
  statusLabel,
  operatorName,
  performers,
  canEdit,
}: {
  event: DetailsEvent;
  statusLabel: string;
  operatorName: string;
  performers: DetailsPerformer[];
  canEdit: boolean;
}) {
  const edit = useEventInformationEdit(event);
  const dateLabel = event.eventDate
    ? new Date(event.eventDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : "—";
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="calendar" size={17} />}
        iconColor="#EE5746"
        title="Event Information"
        action={
          // Only offered to a caller who actually holds `event.edit` — the same
          // signal the API's PATCH gate uses, so the affordance can't outrun it.
          canEdit ? (
            <OutlineButton onClick={edit.open}>
              <Icon name="settings" size={14} /> Edit
            </OutlineButton>
          ) : undefined
        }
      />
      <InfoPairGrid
        pairs={[
          { label: "Event Name", value: event.title },
          { label: "Date", value: dateLabel },
          { label: "Venue", value: event.venueName ?? "—" },
          { label: "Room / Stage", value: event.stageId ? "Assigned" : "—" },
          { label: "Performer", value: performers[0]?.name ?? "—" },
          {
            label: "Capacity",
            value: event.capacity != null ? event.capacity.toLocaleString("en-US") : "—",
          },
          { label: "Operator", value: operatorName },
          { label: "Status", value: statusLabel },
        ]}
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
              <Avatar initials={performer.initials} tone="brand" shape="square" size={34} />
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
      <EventInformationEditModal
        open={edit.draft !== null}
        draft={edit.draft}
        onChange={edit.change}
        onClose={edit.close}
        onSave={edit.save}
        onReload={edit.reload}
        isSaving={edit.isSaving}
        canSave={edit.canSave}
        hasConflict={edit.hasConflict}
      />
    </SectionCard>
  );
}

function RidersDocumentsCard({ riders }: { riders: DetailsRider[] }) {
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="file" size={17} />}
        iconColor="#EE5746"
        title="Riders & Documents"
        action={
          <OutlineButton>
            <Icon name="upload" size={14} /> Upload
          </OutlineButton>
        }
      />
      {riders.length === 0 ? (
        <div style={{ color: "var(--dim)", fontSize: 13 }}>No riders or documents yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {riders.map((rider) => (
            <div
              key={rider.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "13px 16px",
              }}
            >
              <Icon name="file" size={18} />
              <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 13.5 }}>
                {rider.name}
              </span>
              <MonoPill>{rider.type}</MonoPill>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function EventScheduleCard({ schedule }: { schedule: DetailsScheduleEntry[] }) {
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="clock" size={17} />}
        iconColor="#F4A046"
        title="Event Schedule"
      />
      {schedule.length === 0 ? (
        <div style={{ color: "var(--dim)", fontSize: 13 }}>No schedule yet.</div>
      ) : (
        schedule.map((entry) => (
          <div
            key={`${entry.time}-${entry.label}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "9px 0",
              ...rowBorder,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--muted)",
                width: 50,
              }}
            >
              {entry.time}
            </span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#EE5746" }} />
            <span style={{ flex: 1, color: "var(--text)", fontSize: 13.5 }}>{entry.label}</span>
          </div>
        ))
      )}
    </SectionCard>
  );
}

function AmenitiesCard({
  amenities,
  canEdit,
  onChange,
}: {
  amenities: string[];
  canEdit: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...amenities, value]);
    setDraft("");
  };
  return (
    <SectionCard>
      <CardHeader icon={<Icon name="star" size={17} />} iconColor="#6FC97A" title="Amenities" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {amenities.length === 0 && (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>No amenities added yet.</div>
        )}
        {amenities.map((amenity, index) => (
          <RemovableChip
            key={amenity}
            label={amenity}
            onRemove={canEdit ? () => onChange(amenities.filter((_, i) => i !== index)) : undefined}
          />
        ))}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Add amenity…"
            style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
          />
          <OutlineButton onClick={add}>+ Add</OutlineButton>
        </div>
      )}
    </SectionCard>
  );
}

function GuestListCard({
  guestList,
  canEdit,
  onChange,
}: {
  guestList: NonNullable<EventExtras["guestList"]>;
  canEdit: boolean;
  onChange: (next: NonNullable<EventExtras["guestList"]>) => void;
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
      id: `g-${guests.length}-${trimmed.replace(/\s+/g, "-").toLowerCase()}`,
      name: trimmed,
      tickets: count,
      invitedBy,
    };
    onChange({ ...guestList, guests: [...guests, guest] });
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          background: "var(--elevated)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <GuestLimit
          label="Limit list to total tickets"
          value={guestList.limitTotal}
          disabled={!canEdit}
          onCommit={(limitTotal) => onChange({ ...guestList, limitTotal })}
        />
        <GuestLimit
          label="Limit tickets per guest"
          value={guestList.limitPerGuest}
          disabled={!canEdit}
          onCommit={(limitPerGuest) => onChange({ ...guestList, limitPerGuest })}
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
          <label style={{ flex: 1, minWidth: 140 }}>
            <FieldLabel>Guest name</FieldLabel>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name…"
              style={{ ...fieldStyle, width: "100%" }}
            />
          </label>
          <label style={{ width: 90 }}>
            <FieldLabel>Tickets</FieldLabel>
            <input
              type="number"
              min={1}
              value={tickets}
              onChange={(event) => setTickets(event.target.value)}
              style={{
                ...fieldStyle,
                width: "100%",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
              }}
            />
          </label>
          <label style={{ width: 150 }}>
            <FieldLabel>Invited by</FieldLabel>
            <select
              value={invitedBy}
              onChange={(event) => setInvitedBy(event.target.value)}
              style={{ ...fieldStyle, width: "100%" }}
            >
              <option>Promoter</option>
              <option>Performer</option>
              <option>Venue</option>
            </select>
          </label>
          <GradientButton onClick={add}>+ Add</GradientButton>
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
                  onChange({ ...guestList, guests: guests.filter((_, i) => i !== index) })
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

function GuestLimit({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null | undefined;
  disabled: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  return (
    <label style={{ display: "block" }}>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        value={draft}
        disabled={disabled}
        placeholder="No limit"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = draft.trim() === "" ? null : Number(draft);
          onCommit(parsed != null && Number.isFinite(parsed) ? parsed : null);
        }}
        style={{ ...fieldStyle, width: "100%", fontFamily: "var(--font-mono)" }}
      />
    </label>
  );
}

function FinancialDealCard({ deal }: { deal: DetailsDeal }) {
  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="receipt" size={17} />}
        iconColor="#6FC97A"
        title="Financial Deal"
      />
      <Row label="Deal type" value={deal.dealTypeLabel} />
      {deal.costSplit && <Row label="Cost split" value={deal.costSplit} />}
      {deal.guarantee && <Row label="Guarantee" value={deal.guarantee} mono last />}
    </SectionCard>
  );
}

function TicketInformationCard({
  tiers,
  capacity,
  ticketing,
  currency,
  canEdit,
  onChange,
}: {
  tiers: TicketTier[];
  capacity: number | null;
  ticketing: EventExtras["ticketing"] | null;
  currency: string;
  canEdit: boolean;
  onChange: (next: TicketTier[]) => void;
}) {
  const invTotal = tiers.reduce((sum, tier) => sum + (tier.max || 0), 0);
  const estTotal = tiers.reduce((sum, tier) => sum + (tier.est || 0), 0);
  const overCap = capacity != null && invTotal > capacity;
  const symbol = currencySymbol(currency);

  const patch = (id: string, field: keyof TicketTier, value: string) => {
    onChange(
      tiers.map((tier) =>
        tier.id === id ? { ...tier, [field]: field === "name" ? value : Number(value) || 0 } : tier,
      ),
    );
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
              <OutlineButton>
                <Icon name="download" size={13} /> Sync from Ticketing Company
              </OutlineButton>
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
        <span style={{ textAlign: "right" }}>Price</span>
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
              <input
                value={tier.name}
                disabled={!canEdit}
                onChange={(event) => patch(tier.id, "name", event.target.value)}
                style={fieldStyle}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  border: "1px solid var(--border)",
                  background: "var(--elevated)",
                  borderRadius: 9,
                  padding: "0 8px",
                }}
              >
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{symbol}</span>
                <input
                  type="number"
                  value={tier.price}
                  disabled={!canEdit}
                  onChange={(event) => patch(tier.id, "price", event.target.value)}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    border: 0,
                    background: "transparent",
                    color: "var(--text)",
                    fontSize: 13,
                    padding: "9px 4px",
                    outline: "none",
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                  }}
                />
              </div>
              <input
                type="number"
                value={tier.max}
                disabled={!canEdit}
                onChange={(event) => patch(tier.id, "max", event.target.value)}
                style={{ ...fieldStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}
              />
              <input
                type="number"
                value={tier.est}
                disabled={!canEdit}
                onChange={(event) => patch(tier.id, "est", event.target.value)}
                style={{ ...fieldStyle, textAlign: "right", fontFamily: "var(--font-mono)" }}
              />
              {canEdit ? (
                <GlyphButton
                  ariaLabel={`Remove ${tier.name}`}
                  onClick={() => onChange(tiers.filter((row) => row.id !== tier.id))}
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
            onChange([
              ...tiers,
              { id: `tier-${tiers.length}-${Date.now()}`, name: "", price: 0, max: 0, est: 0 },
            ])
          }
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
          {invTotal.toLocaleString("en-US")} max · {estTotal.toLocaleString("en-US")} est.
        </span>
      </div>

      {overCap && (
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

function Row({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "11px 0",
        fontSize: 13.5,
        ...(last ? {} : rowBorder),
      }}
    >
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span
        style={{
          color: "var(--text)",
          fontWeight: 500,
          fontFamily: mono ? "var(--font-mono)" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>
      {children}
    </span>
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
