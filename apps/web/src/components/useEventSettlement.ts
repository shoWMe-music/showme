import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdSettlements,
  getGetApiV1EventsIdSettlementCommentsQueryKey,
  getGetApiV1EventsIdSettlementsQueryKey,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdSettlementComments,
  useGetApiV1EventsIdSettlements,
  usePatchApiV1EventsIdTransfersTid,
  usePostApiV1EventsIdSettlementComments,
  usePostApiV1EventsIdSettlementCompute,
  usePostApiV1EventsIdSettlementFinalize,
  usePostApiV1EventsIdSettlementStatus,
  usePostApiV1EventsIdSettlementsSidConfirm,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { errorMessage } from "../lib/errors";
import { formatMoney } from "../lib/format";
import type { Transfer } from "./WhoOwesWhomBoard";
import {
  type EntitlementRule,
  type LadderRow,
  describeBasis,
  entitlementRules,
  initialsOf,
  isWholeBoard,
  ladderRows,
  netToneOf,
  transferStateOf,
} from "./settlementDocument";

type Settlements = Awaited<ReturnType<typeof getApiV1EventsIdSettlements>>;

/** The settlement statuses at which the figures are frozen (`LOCKED_SETTLEMENT_STATUSES`). */
const FROZEN_STATUSES = new Set(["finalized", "revised", "partly_paid", "paid", "concluded"]);

/** What the caller may do with this event's settlement, straight off `capabilities`. */
export interface SettlementAuthority {
  /** `settlement.edit` — run the reconciliation. */
  canCompute: boolean;
  /** `settlement.finalize` — freeze the figures and LOCK the exchange rates. */
  canFinalize: boolean;
  /** `settlement.confirm` — sign off your own line. */
  canConfirm: boolean;
}

export function settlementAuthorityOf(capabilities: readonly string[]): SettlementAuthority {
  return {
    canCompute: capabilities.includes("settlement.edit"),
    canFinalize: capabilities.includes("settlement.finalize"),
    canConfirm: capabilities.includes("settlement.confirm"),
  };
}

/**
 * One party's payout card: who they are, what they take, and — the point of the
 * whole screen — the RULE each part of it settled under.
 *
 * Every money field arrives pre-formatted because the engine already decided it.
 * Nothing on this object is arithmetic done in the browser.
 */
export interface SettlementParty {
  settlementId: string;
  participantId: string | null;
  name: string;
  initials: string;
  role: string;
  isYours: boolean;
  approvedByYou: boolean;
  /** Null until the event has been reconciled — a real "not yet", not a zero. */
  entitlement: string | null;
  collected: string | null;
  paid: string | null;
  net: string | null;
  /** Raw minor units — for summing only. Never rendered. */
  netMinor: string | null;
  netTone: "positive" | "negative" | "neutral";
  /**
   * The sentences behind the entitlement ("70% of the adjusted net beats the
   * €50,000 guarantee"). Empty for a settlement snapshotted before the engine
   * recorded a basis — the card then shows the bare figure rather than inventing
   * an explanation for it.
   */
  rules: EntitlementRule[];
}

/** One remark in the review thread, with its author resolved to a person. */
export interface SettlementComment {
  id: string;
  author: string;
  message: string;
  createdAt: string;
  isYours: boolean;
}

/** One party's sign-off, named, as the roster shows it. */
export interface SettlementApprovalRow {
  participantId: string;
  name: string;
  role: string;
  approved: boolean;
  approvedAt: string | null;
  isYours: boolean;
}

/**
 * One agreement, as the SETTLEMENT saw it: what it paid in total, and who took
 * which slice of it under which rule.
 *
 * Distinct from the event workspace's Deals tab, which is about authoring and
 * confirming terms. This is the settled reading of the same agreement — built
 * from the entitlement lines the engine recorded, so a deal that produced no
 * entitlement for anyone visible simply does not appear.
 */
export interface SettlementDealRow {
  dealId: string;
  name: string;
  /** What the whole agreement pays; the shares below divide it. */
  dealTotal: string;
  shares: { key: string; name: string; rule: string; amount: string }[];
}

export interface EventSettlement {
  parties: SettlementParty[];
  transfers: Transfer[];
  /** Private agent↔performer commissions — only ever the two parties' own (#14). */
  commissions: Settlements["commissions"];
  /**
   * Gross takings → adjusted net, or NULL for a caller who may not read the
   * night's money. Null is the ceiling itself (story.md:44), not a loading state
   * and not an empty one — the screen must say so rather than render a blank.
   */
  ladder: LadderRow[] | null;
  approvals: SettlementApprovalRow[];
  approvedCount: number;
  /** The agreements behind the figures. Empty until the event is reconciled. */
  deals: SettlementDealRow[];
  /**
   * What actually has to leave the building — one row per party owed money, the
   * operator's own retained share excluded.
   */
  payouts: { key: string; label: string; value: string }[];
  totalPayable: string;
  /** True when the caller is the party whose share is retained rather than paid. */
  retainsOwnShare: boolean;
  /** The caller's own party line, if they are a party at all. */
  ownParty: SettlementParty | null;
  /**
   * Whether the visible lines are the WHOLE board (Σ net = 0) or a party-scoped
   * slice. A slice is a redaction, never an accounting error — see `isWholeBoard`.
   */
  isWholeBoard: boolean;
  nameOf: (participantId: string | null | undefined) => string;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  authority: SettlementAuthority;
  /** True once the reconciliation has been run at least once on this event. */
  isComputed: boolean;
  /** True once the figures are frozen — no recompute, no second finalize. */
  isFinalized: boolean;
  status: string;
  isBusy: boolean;
  /** The review conversation the API can actually move it through. */
  sendForReview: () => void;
  reissue: () => void;
  flagDispute: () => void;
  /** True while the figures can still be re-issued — i.e. not yet frozen. */
  canReview: boolean;
  comments: SettlementComment[];
  postComment: (message: string) => void;
  compute: () => void;
  finalize: () => void;
  confirmOwn: (settlementId: string) => void;
  markTransfer: (transferId: string, state: "owed" | "paid" | "handled") => void;
}

/**
 * The settlement, for both surfaces that show one: the event workspace's thin tab
 * and the full settlement workspace.
 *
 * Everything the two screens render is derived HERE — names resolved against the
 * roster, figures formatted, the basis turned into its sentence, the ladder into
 * its rungs — so the components take values and emit events, and the two can never
 * disagree about what a figure means.
 *
 * The roster is fetched here rather than passed in: it is the only way to turn a
 * `participantId` into a person, both screens need it, and TanStack Query dedupes
 * the request against the copy the event workspace already holds.
 *
 * Finalize is the one action here that cannot be taken back. It freezes an
 * immutable snapshot and **locks the exchange rates** that produced it
 * (money.md), and there is no un-finalize — not in this screen and not in the
 * API. It is therefore offered only to a caller holding `settlement.finalize`,
 * only once figures exist to freeze, and only behind a dialog that says so. The
 * server refuses it a second time (409) and refuses it at all if a budget line,
 * a deal or a rate has moved since the last compute, so the rates locked and the
 * figures frozen always agree.
 */
export function useEventSettlement(
  eventId: string,
  capabilities: readonly string[],
  currency: string,
): EventSettlement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settlements = useGetApiV1EventsIdSettlements(eventId);
  // Names only. The board is readable without them (an id falls back to a short
  // stub), so a caller whose permission set stops short of the roster still sees
  // their own money.
  const participants = useGetApiV1EventsIdParticipants(eventId);
  // Names and structures for the Deal Structure tab. Already party-scoped by the
  // API (`GET /events/:id/deals` returns only deals the caller is a party to), so
  // a performer's tab narrows to her own agreement without this screen deciding.
  const deals = useGetApiV1EventsIdDeals(eventId);
  // The review thread. Party-scoped by the API — a performer sees their own
  // remarks and the event-side ones, never another act's.
  const commentThread = useGetApiV1EventsIdSettlementComments(eventId);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdSettlementsQueryKey(eventId) });
  }, [queryClient, eventId]);

  const computeSettlement = usePostApiV1EventsIdSettlementCompute();
  const finalizeSettlement = usePostApiV1EventsIdSettlementFinalize();
  const confirmSettlement = usePostApiV1EventsIdSettlementsSidConfirm();
  const patchTransfer = usePatchApiV1EventsIdTransfersTid();
  const setStatus = usePostApiV1EventsIdSettlementStatus();
  const addComment = usePostApiV1EventsIdSettlementComments();

  const compute = useCallback(() => {
    computeSettlement.mutate(
      { id: eventId },
      {
        onSuccess: (summary) => {
          refresh();
          toast.success(
            `Reconciled ${summary.breakdowns.length} parties into ${summary.transfers.length} transfers.`,
          );
        },
        // The API's refusals here are diagnostic on purpose (audit A-14 names the
        // offending budget line), so the message is shown rather than replaced.
        onError: (error) => toast.error(errorMessage(error, "Couldn't run the settlement.")),
      },
    );
  }, [computeSettlement, eventId, refresh, toast]);

  const finalize = useCallback(() => {
    finalizeSettlement.mutate(
      { id: eventId },
      {
        onSuccess: () => {
          refresh();
          toast.success("Settlement finalized. The figures and exchange rates are locked.");
        },
        onError: (error) => toast.error(errorMessage(error, "Couldn't finalize the settlement.")),
      },
    );
  }, [finalizeSettlement, eventId, refresh, toast]);

  const confirmOwn = useCallback(
    (settlementId: string) => {
      confirmSettlement.mutate(
        { id: eventId, sid: settlementId },
        {
          onSuccess: () => {
            refresh();
            toast.success("You have signed off on your settlement.");
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't record your sign-off.")),
        },
      );
    },
    [confirmSettlement, eventId, refresh, toast],
  );

  /**
   * Move the settlement through the review conversation.
   *
   * Only the three states a human actually decides. `finalized` has its own
   * action because it locks FX irreversibly, and `partly_paid`/`paid` are derived
   * from the transfers — the API refuses to be told them, so there is no button.
   */
  const moveTo = useCallback(
    (status: "pending_review" | "revised" | "dispute", done: string) => {
      setStatus.mutate(
        { id: eventId, data: { status } },
        {
          onSuccess: () => {
            refresh();
            toast.success(done);
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't update the settlement.")),
        },
      );
    },
    [setStatus, eventId, refresh, toast],
  );

  const postComment = useCallback(
    (message: string) => {
      addComment.mutate(
        { id: eventId, data: { message } },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({
              queryKey: getGetApiV1EventsIdSettlementCommentsQueryKey(eventId),
            });
            // Posting can move the settlement to `comments_received`, so the
            // status on screen has to be re-read too.
            refresh();
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't post your comment.")),
        },
      );
    },
    [addComment, eventId, queryClient, refresh, toast],
  );

  const markTransfer = useCallback(
    (transferId: string, state: "owed" | "paid" | "handled") => {
      const transfer = (settlements.data?.transfers ?? []).find((row) => row.id === transferId);
      patchTransfer.mutate(
        {
          id: eventId,
          tid: transferId,
          // Version-locked (decisions #8): two people settling the same night must
          // not overwrite each other's record of what was paid.
          data: {
            state,
            ...(transfer?.version != null ? { expectedVersion: transfer.version } : {}),
          },
        },
        {
          onSuccess: () => refresh(),
          onError: (error) => toast.error(errorMessage(error, "Couldn't update the transfer.")),
        },
      );
    },
    [patchTransfer, settlements.data, eventId, refresh, toast],
  );

  const roster = participants.data;

  const nameOf = useCallback(
    (participantId: string | null | undefined): string => {
      const match = (roster ?? []).find((party) => party.id === participantId);
      if (match) return match.name ?? match.performerTag ?? humanize(match.role);
      // No roster entry to hand: the short id is honest where an invented label
      // ("Participant 2") would not be.
      return participantId ? participantId.slice(0, 8) : "Participant";
    },
    [roster],
  );

  const roleOf = useCallback(
    (participantId: string | null | undefined): string => {
      const match = (roster ?? []).find((party) => party.id === participantId);
      return match ? humanize(match.role) : "Party";
    },
    [roster],
  );

  const rows = settlements.data?.settlements ?? [];

  const parties = useMemo(
    () => rows.map((row) => toParty(row, currency, nameOf, roleOf)),
    [rows, currency, nameOf, roleOf],
  );

  /**
   * WHO ACTUALLY GETS PAID.
   *
   * The operator's own share is RETAINED — it is what is left after everyone else,
   * so it never moves — and the design's Total Payouts panel says so. Excluded here
   * rather than in the component, because whether a share is retained is a fact
   * about the settlement, not a rendering choice.
   *
   * `totalPayable` is summed in MINOR UNITS from the same strings the API served
   * and formatted once at the end. The browser never does money arithmetic on
   * formatted text, and never on a float (`docs/money.md`).
   */
  const payable = useMemo(() => parties.filter((party) => party.netTone === "positive"), [parties]);
  // Whoever is HOLDING the night's money has a negative net — they are the one who
  // pays everybody else, and their own share is retained rather than transferred.
  const ownRetains = useMemo(
    () => parties.some((party) => party.isYours && party.netTone === "negative"),
    [parties],
  );
  const totalPayable = useMemo(() => {
    const total = payable.reduce((running, party) => running + BigInt(party.netMinor ?? "0"), 0n);
    return formatMoney(total.toString(), currency);
  }, [payable, currency]);

  const transfers = useMemo(
    () =>
      (settlements.data?.transfers ?? [])
        // A representation transfer is the private agent commission — it belongs
        // with the commission card, not among the event's who-owes-whom lines (#14).
        .filter((transfer) => !transfer.representationId)
        .map((transfer, index) => ({
          id: transfer.id ?? `transfer-${index}`,
          from: nameOf(transfer.fromParticipantId),
          to: nameOf(transfer.toParticipantId),
          amount: formatMoney(transfer.amount, currency),
          state: transferStateOf(transfer.state),
        })),
    [settlements.data, currency, nameOf],
  );

  const approvals = useMemo(() => {
    const mine = new Set(
      rows.filter((row) => row.isYours).map((row) => row.participantId as string),
    );
    return (settlements.data?.approvals ?? []).map((approval) => ({
      participantId: approval.participantId,
      name: nameOf(approval.participantId),
      role: roleOf(approval.participantId),
      approved: approval.approved,
      approvedAt: approval.approvedAt,
      isYours: mine.has(approval.participantId),
    }));
  }, [settlements.data, rows, nameOf, roleOf]);

  const ladder = settlements.data?.ladder ?? null;

  const dealRows = useMemo(
    () => toDealRows(rows, deals.data ?? [], currency, nameOf),
    [rows, deals.data, currency, nameOf],
  );

  return {
    parties,
    transfers,
    commissions: settlements.data?.commissions ?? [],
    ladder: ladder ? ladderRows(ladder, currency) : null,
    approvals,
    approvedCount: approvals.filter((approval) => approval.approved).length,
    deals: dealRows,
    ownParty: parties.find((party) => party.isYours) ?? null,
    isWholeBoard: isWholeBoard(
      rows.filter((row) => row.computed != null).map((row) => row.computed?.net ?? "0"),
    ),
    nameOf,
    isPending: settlements.isPending,
    isError: settlements.isError,
    error: settlements.error,
    authority: settlementAuthorityOf(capabilities),
    isComputed: rows.some((row) => row.computed != null),
    isFinalized: rows.some((row) => FROZEN_STATUSES.has(row.status)),
    status: rows[0]?.status ?? "open",
    payouts: payable.map((party) => ({
      key: party.settlementId,
      label: `${party.name} payout`,
      value: party.net as string,
    })),
    totalPayable,
    retainsOwnShare: ownRetains,
    // The review conversation is over once the figures freeze — after that the
    // only honest objection is a dispute, which stays available.
    canReview: rows.length > 0 && !rows.some((row) => FROZEN_STATUSES.has(row.status)),
    sendForReview: () => moveTo("pending_review", "Sent for review."),
    reissue: () => moveTo("revised", "Figures re-issued."),
    flagDispute: () => moveTo("dispute", "Flagged as disputed."),
    comments: (commentThread.data ?? []).map((row) => ({
      id: row.id,
      // Resolved from the participant, not from a name stored on the row — one
      // source for who somebody is. An event-side remark has no party.
      author: row.partyParticipantId ? nameOf(row.partyParticipantId) : "Operator",
      message: row.message,
      createdAt: row.createdAt,
      isYours: row.isYours,
    })),
    postComment,
    isBusy:
      computeSettlement.isPending ||
      finalizeSettlement.isPending ||
      confirmSettlement.isPending ||
      patchTransfer.isPending,
    compute,
    finalize,
    confirmOwn,
    markTransfer,
  };
}

/** `team_and_crew` → "Team and crew". */
function humanize(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function toParty(
  row: Settlements["settlements"][number],
  currency: string,
  nameOf: (participantId: string | null | undefined) => string,
  roleOf: (participantId: string | null | undefined) => string,
): SettlementParty {
  const name = nameOf(row.participantId);
  const computed = row.computed;
  return {
    settlementId: row.id,
    participantId: row.participantId,
    name,
    initials: initialsOf(name),
    role: roleOf(row.participantId),
    isYours: row.isYours,
    approvedByYou: row.approvedByYou,
    entitlement: computed ? formatMoney(computed.entitlement, currency) : null,
    collected: computed ? formatMoney(computed.collected, currency) : null,
    paid: computed ? formatMoney(computed.paid, currency) : null,
    net: computed ? formatMoney(computed.net, currency) : null,
    // The raw minor units alongside the formatted figure, ONLY so totals can be
    // summed as integers. Nothing renders this — `docs/money.md`: never do money
    // arithmetic on formatted text, and never through a float.
    netMinor: computed?.net ?? null,
    netTone: computed ? netToneOf(computed.net) : "neutral",
    rules: computed ? entitlementRules(computed, currency) : [],
  };
}

/**
 * Group every visible entitlement line by the deal it came from.
 *
 * The lines are the settlement's own record, so the total shown is what the deal
 * actually paid — not what its terms projected. A deal the caller can see but
 * which paid nobody visible produces no row, and a deal whose name the caller
 * cannot read falls back to its short id rather than to an invented label.
 */
function toDealRows(
  rows: Settlements["settlements"],
  deals: Awaited<ReturnType<typeof getApiV1EventsIdDeals>>,
  currency: string,
  nameOf: (participantId: string | null | undefined) => string,
): SettlementDealRow[] {
  const byDeal = new Map<string, SettlementDealRow>();
  for (const row of rows) {
    for (const line of row.computed?.lines ?? []) {
      const existing = byDeal.get(line.dealId);
      const deal = deals.find((candidate) => candidate.id === line.dealId);
      const share = {
        key: `${line.dealId}-${row.id}`,
        name: nameOf(row.participantId),
        rule: describeBasis(line.basis, currency),
        amount: formatMoney(line.amount, currency),
      };
      if (existing) {
        existing.shares.push(share);
        continue;
      }
      byDeal.set(line.dealId, {
        dealId: line.dealId,
        name: deal?.name ?? `Deal ${line.dealId.slice(0, 8)}`,
        dealTotal: formatMoney(line.dealTotal, currency),
        shares: [share],
      });
    }
  }
  return [...byDeal.values()];
}
