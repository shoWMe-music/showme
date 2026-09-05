import { useGetApiV1EventsIdDeals } from "@showme/api-client";
import { DealCostAccountabilityCard } from "./DealCostAccountabilityCard";
import { EventAgreementTab } from "./EventAgreementTab";
import { EventHospitalityCard } from "./EventHospitalityCard";

/**
 * THE DEALS TAB — the consolidation the 2026-08 settlements meeting asked for.
 *
 * > *"Consolidation of deal-specific sections. A new 'Deal' tab will be created
 * > to consolidate the agreements, accommodation, and financial deal sections."*
 * > … *"The 'Event Details' tab should be reserved for general information, while
 * > the new 'Deals' tab should manage all specific financial and contractual
 * > agreements for each participant."* (01:53:36, 01:57:22)
 *
 * Three things used to be in three places and are now in one:
 *
 * | Was | Now |
 * |---|---|
 * | the **Agreement** tab | the agreements section here, unchanged |
 * | the **Financial Deal** card on Event Details | deleted — it printed a lossy, mislabelled copy of the first deal's terms (its "Cost split" was the *door* split, and #16.3 says a cost split is never pre-filled at all). The agreement card above states the same terms correctly, per deal, per party |
 * | the **Amenities** card on Event Details | Accommodation & amenities, below |
 *
 * Plus one thing that was in no place: which costs are booked against which
 * agreement (`DealCostAccountabilityCard`).
 *
 * The tab is deliberately a composition and nothing else — every section owns its
 * own data and its own rules, so what a performer sees here is decided by the
 * server's serializer in each of them rather than by a branch in this file.
 */
export interface EventDealsTabProps {
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  eventStatusLabel: string;
  /** The caller's own effective capabilities on this event. */
  capabilities: readonly string[];
  /** The event's base currency. A deal's own currency wins over it. */
  baseCurrency: string;
  venueLabel: string;
  operatorName: string;
  /** The slice the hospitality card writes against (`events.extras`). */
  event: { id: string; version: number; extras?: Record<string, unknown> | null };
  canEdit: boolean;
}

export function EventDealsTab({
  eventId,
  eventTitle,
  eventDate,
  eventStatusLabel,
  capabilities,
  baseCurrency,
  venueLabel,
  operatorName,
  event,
  canEdit,
}: EventDealsTabProps) {
  // Read once here so the accountability card can NAME a deal rather than print
  // its id. The same query the agreements section uses, so TanStack serves both
  // from one cache entry and there is no second request.
  const deals = useGetApiV1EventsIdDeals(eventId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <EventAgreementTab
        eventId={eventId}
        eventTitle={eventTitle}
        eventDate={eventDate}
        eventStatusLabel={eventStatusLabel}
        capabilities={capabilities}
        baseCurrency={baseCurrency}
        venueLabel={venueLabel}
        operatorName={operatorName}
      />
      <DealCostAccountabilityCard
        eventId={eventId}
        capabilities={capabilities}
        deals={(deals.data ?? []).map((deal) => ({ id: deal.id, name: deal.name }))}
        currency={baseCurrency}
      />
      {/* `extras` is operator-only — the serializer omits the KEY entirely for a
          caller without `event.edit`, so an absent field (not an empty one) is
          the signal. Drawing an empty card for a performer would imply the
          operator has recorded nothing, when the truth is they may not look. */}
      {event.extras !== undefined && <EventHospitalityCard event={event} canEdit={canEdit} />}
    </div>
  );
}
