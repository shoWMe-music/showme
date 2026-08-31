import {
  getApiV1Events,
  getGetApiV1EventsQueryKey,
  patchApiV1EventsId,
  postApiV1EventsIdHoldRank,
  useGetApiV1ProfilesIdCapStatus,
} from "@showme/api-client";
import { Badge, Select } from "@showme/design-system";
import { useState } from "react";
import { infiniteKey, useCursorList } from "../hooks/useCursorList";
import type { EventItem } from "../hooks/useEventList";
import { errorMessage } from "../lib/errors";

/**
 * Placing a hold from the create-event wizard.
 *
 * A HOLD IS AN EVENT (`PLAN.md` §G, `apps/api/src/routes/holds.ts`): `status =
 * 'on_hold'` plus `hold_rank`, no separate table. `POST /events` deliberately
 * carries no `status` — a new event lands on the `draft` default — so placing a
 * hold is two writes: create, then move the status. The move is FREE: the plan's
 * event cap counts only `confirmed` and `concluded`
 * (`CAP_COUNTING_EVENT_STATUSES` in `apps/api/src/lib/entitlements.ts`), and
 * `assertEventCapAllows` returns early for every status outside that set. The
 * slot is charged when the act CONFIRMS the hold, which is exactly what
 * `POST /booking-requests/:id/draft-event` tells its dialog with
 * `eventCap.chargedAtConfirm`.
 */

/** How the two-step placement ended — every outcome names what actually exists. */
export type HoldPlacementOutcome =
  | { kind: "on_hold"; holdRank: number }
  | { kind: "on_hold_without_rank"; message: string }
  | { kind: "stayed_draft"; message: string };

export interface HoldPlacement {
  /** Holds already pencilled on this date, by the server's own pool rule. */
  competingHolds: number;
  /** Holds on the same date PINNED to a venue profile — a separate queue. */
  holdsPinnedToVenue: number;
  /** True until the pool is known — the rank on offer would be a guess before then. */
  poolIsPending: boolean;
  /** The ranks the operator may pick, `1 … competingHolds + 1` (never a gap). */
  rankOptions: number[];
  holdRank: number;
  setHoldRank: (rank: number) => void;
  /** The host plan's live event-slot counter, or null while unknown/unlimited. */
  eventSlots: { used: number; limit: number; allowed: boolean } | null;
  isPlacing: boolean;
  placeOnHold: (event: { id: string; version: number }) => Promise<HoldPlacementOutcome>;
}

/** "1st", "2nd", "3rd", "4th" … — how an operator says a hold rank out loud. */
export function holdOrdinal(rank: number): string {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

/**
 * "1st hold" — the rank, wherever a hold is named.
 *
 * This vocabulary existed only inside the create wizard, so an operator saw
 * their rank once, in a toast, and never again: the event screen and the events
 * list both said "On hold" and stopped. One badge, so the header, the list row
 * and the holds panel say it the same way.
 *
 * IT RENDERS NOTHING WITHOUT A RANK, and that is the security property, not a
 * convenience: `serialize/event.ts` omits `hold_rank` for anyone without
 * `event.edit`, so a performer's event simply carries no number and this badge
 * disappears on its own. Never substitute a default — `?? 1` here would invent
 * "1st hold" for every act on the bill.
 */
export function HoldRankBadge({
  holdRank,
  status,
}: {
  holdRank: number | null | undefined;
  /** Optional guard for list rows, where a cancelled event still has its rank. */
  status?: string;
}) {
  if (holdRank == null) return null;
  if (status !== undefined && status !== "on_hold") return null;
  return <Badge status="pending">{holdOrdinal(holdRank)} hold</Badge>;
}

/**
 * The competing holds for a date, matched the way the API matches them.
 *
 * `loadSiblings` in `routes/holds.ts` pools `on_hold` events sharing the exact
 * `(event_date, venue_profile_id, stage_id)`. The wizard creates events with no
 * venue PROFILE and no stage (it captures a free-text venue name), so its holds
 * land in the `(date, NULL, NULL)` pool — and a pool with no room is scoped to
 * ONE HOST (decisions #20): there is no room for two operators to be competing
 * for, so an unpinned hold queues only with its own host's. A hold pinned to a
 * venue profile is a different pool on purpose; counting it here would offer the
 * operator a rank the server would not honour.
 *
 * This file used to say the server pooled unpinned holds across every operator
 * and count them accordingly, which was true of the server and wrong of the
 * queue: it inflated the ranks on offer with strangers' pencils, and taking one
 * of those ranks demoted them.
 */
function holdsOnDate(holds: EventItem[], eventDate: string): EventItem[] {
  if (!eventDate) return [];
  return holds.filter((hold) => hold.status === "on_hold" && hold.eventDate === eventDate);
}

export function useHoldPlacement(options: {
  enabled: boolean;
  eventDate: string;
  hostProfileId: string | undefined;
}): HoldPlacement {
  const { enabled, eventDate, hostProfileId } = options;

  // Every hold the operator can reach, drained: the rank on offer is an
  // aggregate over the whole pool, and a first page of it would be a lie.
  const holdListParams = { limit: 100, status: ["on_hold" as const] };
  const holdList = useCursorList<EventItem>({
    queryKey: infiniteKey(getGetApiV1EventsQueryKey(holdListParams)),
    fetchPage: (cursor, signal) => getApiV1Events({ ...holdListParams, cursor }, signal),
    loadAllPages: true,
    enabled,
  });

  const capStatus = useGetApiV1ProfilesIdCapStatus(hostProfileId ?? "", {
    query: { enabled: enabled && Boolean(hostProfileId) },
  });

  // `null` = the operator has not picked, so the rank follows the end of the
  // queue — a new pencil joins BEHIND the holds already on the date unless its
  // owner says otherwise. Derived rather than synced through an effect, so a
  // date change can never leave a stale number on screen for a frame.
  const [pickedRank, setPickedRank] = useState<number | null>(null);

  const sameDate = holdsOnDate(holdList.items, eventDate);
  const competingHolds = sameDate.filter(
    (hold) =>
      hold.venueProfileId === null && hold.stageId === null && hold.hostProfileId === hostProfileId,
  ).length;
  // Counted from the venue field rather than as "everything else", so another
  // host's unpinned hold is not mislabelled as queueing at a venue. It is in
  // neither queue, which is the honest answer and not a sentence worth drawing.
  const holdsPinnedToVenue = sameDate.filter((hold) => hold.venueProfileId !== null).length;
  const maxRank = competingHolds + 1;
  const rankOptions = Array.from({ length: maxRank }, (_, index) => index + 1);
  const holdRank = pickedRank === null ? maxRank : Math.min(pickedRank, maxRank);

  // Metered only on the free tier: a paid plan answers `{ allowed: true }` with
  // no counts, and a counter we cannot state is better left unsaid than guessed.
  const createEventFeature = capStatus.data?.createEvent;
  const eventSlots =
    createEventFeature?.used !== undefined && createEventFeature.limit !== undefined
      ? {
          used: createEventFeature.used,
          limit: createEventFeature.limit,
          allowed: createEventFeature.allowed,
        }
      : null;

  const [isPlacing, setIsPlacing] = useState(false);

  const placeOnHold = async (event: {
    id: string;
    version: number;
  }): Promise<HoldPlacementOutcome> => {
    setIsPlacing(true);
    try {
      try {
        await patchApiV1EventsId(event.id, {
          status: "on_hold",
          expectedVersion: event.version,
        });
      } catch (error) {
        // The event EXISTS and is a draft. We keep it rather than deleting it:
        // it holds everything the operator just typed, a draft consumes no plan
        // slot, and it is visible on the Events list and the Calendar — so
        // nothing is orphaned. The caller says so out loud and opens it.
        return {
          kind: "stayed_draft",
          message: errorMessage(error, "The status couldn't be changed."),
        };
      }

      // A lone first hold needs no rank write: `hold_rank` is nullable and every
      // reader treats NULL as rank 1 (`row.holdRank ?? 1` in `routes/holds.ts`,
      // `holds.ts` in @showme/shared). Calling the rank route here would write
      // nothing (the diff is empty) while still filing a "hold.ranked" line for
      // a move that never happened.
      if (holdRank === 1 && competingHolds === 0) return { kind: "on_hold", holdRank: 1 };

      try {
        // The rank route recomputes the pool server-side and returns the whole
        // ordering, so the rank we report is the one that was actually written —
        // not the one we asked for.
        const { ranks } = await postApiV1EventsIdHoldRank(event.id, { holdRank });
        const ownEntry = ranks.find((entry) => entry.id === event.id);
        return { kind: "on_hold", holdRank: ownEntry?.holdRank ?? 1 };
      } catch (error) {
        return {
          kind: "on_hold_without_rank",
          message: errorMessage(error, "The hold priority couldn't be set."),
        };
      }
    } finally {
      setIsPlacing(false);
    }
  };

  return {
    competingHolds,
    holdsPinnedToVenue,
    poolIsPending: holdList.isPending,
    rankOptions,
    holdRank,
    setHoldRank: setPickedRank,
    eventSlots,
    isPlacing,
    placeOnHold,
  };
}

const amberPanel = {
  border: "1px solid color-mix(in srgb,var(--brand-amber) 34%,transparent)",
  background: "color-mix(in srgb,var(--brand-amber) 9%,transparent)",
  borderRadius: 13,
  padding: "13px 15px",
  display: "flex",
  flexDirection: "column",
  gap: 11,
} as const;

const panelLabel = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "#C97F2E",
} as const;

const panelNote = { fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 } as const;

/**
 * The wizard's hold block — shown ONLY when the wizard is placing a hold.
 *
 * Two sentences the operator cannot get anywhere else: where this pencil sits in
 * the queue for that date, and what it costs. Dumb by construction: every number
 * comes from `useHoldPlacement`.
 */
export function HoldPriorityField({
  placement,
  eventDate,
}: {
  placement: HoldPlacement;
  eventDate: string;
}) {
  const { competingHolds, holdsPinnedToVenue, poolIsPending, rankOptions, holdRank, setHoldRank } =
    placement;

  // Never claims the DAY is free — only that nothing is competing for it. Holds
  // pinned to a venue profile queue separately (the API pools by
  // `(date, venue, stage)`), and the wizard cannot pin one, so they are named
  // rather than silently counted or silently ignored.
  const queueLine = !eventDate
    ? "Pick a date — a hold is a claim on one, and its priority is decided per date."
    : poolIsPending
      ? "Checking what else is held on this date…"
      : competingHolds === 0
        ? "No hold is competing for this date yet, so this is the 1st hold."
        : `${competingHolds} hold${competingHolds === 1 ? " is" : "s are"} already competing for this date. Taking a rank pushes the ones at or below it down one.`;

  return (
    <div style={amberPanel}>
      <div style={panelLabel}>Hold priority</div>
      {rankOptions.length > 1 ? (
        <Select
          value={String(holdRank)}
          onChange={(value) => setHoldRank(Number(value))}
          aria-label="Hold priority"
          options={rankOptions.map((rank) => ({
            value: String(rank),
            label: `${holdOrdinal(rank)} hold`,
          }))}
        />
      ) : (
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>1st hold</div>
      )}
      <div style={panelNote}>{queueLine}</div>
      {holdsPinnedToVenue > 0 && (
        <div style={panelNote}>
          {holdsPinnedToVenue === 1
            ? "One other hold on this date is attached to a venue, and queues separately."
            : `${holdsPinnedToVenue} other holds on this date are attached to a venue, and queue separately.`}
        </div>
      )}
      <HoldPlanNote placement={placement} />
    </div>
  );
}

/**
 * The plan consequence, said out loud — the same honesty as the draft-event
 * dialog's `eventCap`: a hold spends no event slot, because the cap counts only
 * `confirmed`/`concluded`. Stated even when the plan is already spent, since
 * that is precisely when an operator needs to know a hold is still allowed.
 */
function HoldPlanNote({ placement }: { placement: HoldPlacement }) {
  const { eventSlots } = placement;
  if (!eventSlots) {
    return <div style={panelNote}>A hold spends no plan event slot — confirming it does.</div>;
  }
  return (
    <div style={panelNote}>
      {eventSlots.allowed
        ? `Plan: ${eventSlots.used} of ${eventSlots.limit} event slots used. A hold spends none — the slot is charged when the act confirms.`
        : `Plan: all ${eventSlots.limit} event slots are used. You can still hold this date — the slot is only charged when the act confirms, and confirming will be refused until a slot frees up or you upgrade.`}
    </div>
  );
}
