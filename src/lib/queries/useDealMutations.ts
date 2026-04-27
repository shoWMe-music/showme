/**
 * Deal / settlement mutation hooks.
 *
 * Implemented via optimistic cache updates + Firestore writes.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { DealStructure, TicketRevenue, SettlementStatus, SettlementRevision } from "@/lib/models";
import { upsertDeal, upsertRevenue, upsertSettlement, fetchSettlement, fetchRevenue, fetchDeal, appendSettlementActivity } from "@/lib/db";
import { buildSettlementUpdate, emptyRevenue } from "@/lib/settlementUtils";
import { getAuthClient } from "@/lib/firebaseAuth";
import { queryKeys } from "./keys";
import type { EventEconomicsData } from "./useEventEconomics";

function currentActor(): string {
  const u = getAuthClient().currentUser;
  return u?.displayName || u?.email || "Unknown";
}

const REVENUE_FIELD_LABELS: Partial<Record<keyof TicketRevenue, string>> = {
  grossRevenue: "Ticket sales",
  doorSales: "Door sales",
  ticketsSold: "Tickets sold",
  ticketFees: "Ticket fees",
  tax: "Tax",
  refunds: "Refunds",
  productionExpenses: "Production expenses",
  additionalCosts: "Additional costs",
};

const DEAL_FIELD_LABELS: Partial<Record<keyof DealStructure, string>> = {
  dealType: "Deal type",
  artistGuarantee: "Guarantee",
  artistSplit: "Artist split %",
  promoterSplit: "Promoter split %",
  venueSplit: "Venue split %",
  organizerSplit: "Organizer split %",
  artistCostSplit: "Artist cost split %",
  promoterCostSplit: "Promoter cost split %",
  venueCostSplit: "Venue cost split %",
  organizerCostSplit: "Organizer cost split %",
  venueRental: "Venue rental",
  venueRentalPaidBy: "Venue rental paid by",
  venueRentalPaymentMode: "Venue rental payment mode",
};

function buildDealChanges(
  oldDeal: DealStructure | undefined,
  newDeal: DealStructure,
): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const [key, label] of Object.entries(DEAL_FIELD_LABELS)) {
    const k = key as keyof DealStructure;
    const oldVal = oldDeal?.[k] ?? "";
    const newVal = newDeal[k] ?? "";
    if (String(oldVal) !== String(newVal)) {
      changes[label] = `${oldVal} → ${newVal}`;
    }
  }
  return changes;
}

/** If the settlement was already in review, changes push it back to "revised". */
function statusAfterChange(current: SettlementStatus): SettlementStatus {
  return current === "open" ? "open" : "revised";
}

function resetApprovals(
  approvals: { party: string; approved: boolean; date?: string }[],
): { party: string; approved: boolean }[] {
  return approvals.map(({ party }) => ({ party, approved: false }));
}

function buildRevenueChanges(
  oldRev: TicketRevenue | undefined,
  newRev: TicketRevenue,
): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const [key, label] of Object.entries(REVENUE_FIELD_LABELS)) {
    const k = key as keyof TicketRevenue;
    const oldVal = ((oldRev?.[k] ?? 0) as number);
    const newVal = ((newRev[k] ?? 0) as number);
    if (oldVal !== newVal) {
      changes[label] = `${oldVal} → ${newVal}`;
    }
  }
  return changes;
}

// ── useUpdateDeal ─────────────────────────────────────────────────────────────

export function useUpdateDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { eventId: string; deal: DealStructure; actingProfile?: string }): Promise<void> => {
      const { eventId, deal, actingProfile } = vars;
      const oldDeal = await fetchDeal(eventId);
      await upsertDeal(eventId, deal);

      // Recalculate settlement after deal change
      const current = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );
      const revenue = current?.revenue ?? emptyRevenue(eventId);
      const newSettlement = buildSettlementUpdate(deal, revenue, current?.settlement);
      const settledWithReset = {
        ...newSettlement,
        status: statusAfterChange(newSettlement.status),
        approvals: resetApprovals(newSettlement.approvals),
      };
      await upsertSettlement(eventId, settledWithReset);
      const dealChanges = buildDealChanges(oldDeal ?? undefined, deal);
      appendSettlementActivity(eventId, "deal_updated", currentActor(), Object.keys(dealChanges).length > 0 ? dealChanges : undefined, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settlementActivity(eventId) });
      }, actingProfile);
    },
    onMutate: async (vars) => {
      const { eventId, deal } = vars;
      await queryClient.cancelQueries({ queryKey: queryKeys.eventEconomics(eventId) });

      const previous = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );

      queryClient.setQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
        (old) => {
          if (!old) return old;
          const revenue = old.revenue ?? emptyRevenue(eventId);
          const newSettlement = buildSettlementUpdate(deal, revenue, old.settlement);
          return {
            ...old, deal,
            settlement: {
              ...newSettlement,
              status: statusAfterChange(newSettlement.status),
              approvals: resetApprovals(newSettlement.approvals),
            },
          };
        },
      );

      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.eventEconomics(vars.eventId),
          context.previous,
        );
      }
    },
  });
}

// ── useUpdateRevenue ──────────────────────────────────────────────────────────

export function useUpdateRevenue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { eventId: string; newRevenue: TicketRevenue; actingProfile?: string }): Promise<void> => {
      const { eventId, newRevenue, actingProfile } = vars;

      // Fetch old revenue from Firestore before writing — the cache is already
      // optimistically updated by onMutate, so we can't diff from there.
      const [oldRevenue, current] = await Promise.all([
        fetchRevenue(eventId),
        Promise.resolve(queryClient.getQueryData<EventEconomicsData>(queryKeys.eventEconomics(eventId))),
      ]);
      const deal = current?.deal;

      const revenueChanges = buildRevenueChanges(oldRevenue ?? undefined, newRevenue);
      await upsertRevenue(eventId, newRevenue);

      if (deal) {
        const newSettlement = buildSettlementUpdate(deal, newRevenue, current?.settlement);
        const settledWithReset = {
          ...newSettlement,
          status: statusAfterChange(newSettlement.status),
          approvals: resetApprovals(newSettlement.approvals),
        };
        await upsertSettlement(eventId, settledWithReset);
      }
      appendSettlementActivity(eventId, "revenue_updated", currentActor(), revenueChanges, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settlementActivity(eventId) });
      }, actingProfile);
    },
    onMutate: async (vars) => {
      const { eventId, newRevenue } = vars;
      await queryClient.cancelQueries({ queryKey: queryKeys.eventEconomics(eventId) });

      const previous = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );

      queryClient.setQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
        (old) => {
          if (!old) return old;
          const deal = old.deal;
          if (!deal) return { ...old, revenue: newRevenue };
          const newSettlement = buildSettlementUpdate(deal, newRevenue, old.settlement);
          return {
            ...old, revenue: newRevenue,
            settlement: {
              ...newSettlement,
              status: statusAfterChange(newSettlement.status),
              approvals: resetApprovals(newSettlement.approvals),
            },
          };
        },
      );

      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.eventEconomics(vars.eventId),
          context.previous,
        );
      }
    },
  });
}

// ── useUpdateSettlementStatus ─────────────────────────────────────────────────

export function useUpdateSettlementStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { eventId: string; status: SettlementStatus; actingProfile?: string }): Promise<void> => {
      const { eventId, status, actingProfile } = vars;
      const current = await fetchSettlement(eventId);
      if (!current) return;
      const prevStatus = current.status;
      await upsertSettlement(eventId, { ...current, status });
      appendSettlementActivity(eventId, "status_changed", currentActor(), { from: prevStatus, to: status }, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settlementActivity(eventId) });
      }, actingProfile);
    },
    onMutate: async (vars) => {
      const { eventId, status } = vars;
      await queryClient.cancelQueries({ queryKey: queryKeys.eventEconomics(eventId) });

      const previous = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );

      queryClient.setQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
        (old) => old && old.settlement
          ? { ...old, settlement: { ...old.settlement, status } }
          : old,
      );

      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.eventEconomics(vars.eventId),
          context.previous,
        );
      }
    },
  });
}

// ── useAddComment ─────────────────────────────────────────────────────────────

export function useAddComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      eventId: string;
      party: string;
      message: string;
      attachments?: { name: string; size: string; type: string }[];
      date: string;
      actingProfile?: string;
    }): Promise<void> => {
      const { eventId, party, message, attachments, date, actingProfile } = vars;
      const current = await fetchSettlement(eventId);
      if (!current) return;
      const newComment = { party, message, date, ...(attachments ? { attachments } : {}) };
      await upsertSettlement(eventId, {
        ...current,
        comments: [...(current.comments ?? []), newComment],
      });
      appendSettlementActivity(eventId, "comment_added", currentActor(), { party }, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settlementActivity(eventId) });
      }, actingProfile);
    },
    onMutate: async (vars) => {
      const { eventId, party, message, attachments, date } = vars;
      await queryClient.cancelQueries({ queryKey: queryKeys.eventEconomics(eventId) });

      const previous = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );

      queryClient.setQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
        (old) => {
          if (!old || !old.settlement) return old;
          const newComment = { party, message, date, ...(attachments ? { attachments } : {}) };
          return {
            ...old,
            settlement: {
              ...old.settlement,
              comments: [...(old.settlement.comments ?? []), newComment],
            },
          };
        },
      );

      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.eventEconomics(vars.eventId),
          context.previous,
        );
      }
    },
  });
}

// ── useAddRevision ────────────────────────────────────────────────────────────

export function useAddRevision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: {
      eventId: string;
      revision: SettlementRevision;
      actingProfile?: string;
    }): Promise<void> => {
      const { eventId, revision, actingProfile } = vars;
      const current = await fetchSettlement(eventId);
      if (!current) return;
      await upsertSettlement(eventId, {
        ...current,
        revisions: [...(current.revisions ?? []), revision],
      });
      appendSettlementActivity(eventId, "revision_added", currentActor(), { changes: revision.changes }, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settlementActivity(eventId) });
      }, actingProfile);
    },
    onMutate: async (vars) => {
      const { eventId, revision } = vars;
      await queryClient.cancelQueries({ queryKey: queryKeys.eventEconomics(eventId) });

      const previous = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );

      queryClient.setQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
        (old) => {
          if (!old || !old.settlement) return old;
          return {
            ...old,
            settlement: {
              ...old.settlement,
              revisions: [...(old.settlement.revisions ?? []), revision],
            },
          };
        },
      );

      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.eventEconomics(vars.eventId),
          context.previous,
        );
      }
    },
  });
}
