import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdSettlements,
  getGetApiV1EventsIdSettlementCommentsQueryKey,
  getGetApiV1EventsIdSettlementLinesQueryKey,
  getGetApiV1EventsIdSettlementPlannedVsActualQueryKey,
  getGetApiV1EventsIdSettlementsQueryKey,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdSettlementComments,
  useGetApiV1EventsIdSettlements,
  usePatchApiV1EventsIdTransfersTid,
  usePostApiV1EventsIdSettlementComments,
  usePostApiV1EventsIdSettlementCompute,
  usePostApiV1EventsIdSettlementFinalize,
  usePostApiV1EventsIdSettlementInvitations,
  usePostApiV1EventsIdSettlementStatus,
  usePostApiV1EventsIdSettlementsSidConfirm,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { eventParticipantRoleLabel } from "@showme/shared";
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

/**
 * The settlement statuses at which the figures are frozen.
 *
 * These three and no others, because that is `LOCKED_SETTLEMENT_STATUSES` in
 * `apps/api/src/routes/settlement.ts` — the set the server actually refuses a
 * recompute or a re-issue on. This list used to also carry `revised` and
 * `concluded`, and the cost was the review loop's whole point: a settlement that
 * came back with comments and was re-issued could never be recalculated or sent
 * back out, so an operator could agree a figure was wrong and then have no
 * affordance to correct it. A screen that hides a button the API would have
 * honoured is a worse lie than one that shows a button and gets refused.
 */
const FROZEN_STATUSES = new Set(["finalized", "partly_paid", "paid"]);

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
  /**
   * Whether the reader may sign THIS line off. Not the same question as
   * `isYours`: a delegated performer's signature is their agent's to give
   * (decisions.md #14), so an agent may sign a line that is not its own. The
   * server answers it; nothing here re-derives it.
   */
  signableByYou: boolean;
  /** Null until the event has been reconciled — a real "not yet", not a zero. */
  entitlement: string | null;
  collected: string | null;
  paid: string | null;
  /**
   * Money that moved before the night under a deal — a rental paid to hold the
   * room, a guarantee paid to secure the booking. Null when nothing did, so the
   * board can leave the row out rather than print a zero that invites the reader
   * to wonder what it means.
   */
  prepaid: string | null;
  /**
   * "Paid in advance TO the venue", "…BY the promoter" — the sentence the product
   * owner asked for (ClickUp `86cbcn1ue`: *"marked 'paid in advance' by X to Y"*).
   *
   * Direction comes from the SIGN of `prepaid`, which is the part the old label
   * got wrong: a payee's advance is positive, and the board called it "Paid before
   * the event", so a performer holding a 10 000 advance read as having paid it.
   * Null when nothing moved early.
   */
  prepaidLabel: string | null;
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

/**
 * An agent's commission on their performer's income, ready to render.
 *
 * The amounts arrive from the API as MINOR UNITS in a string (`docs/money.md` —
 * integer minor units, string at the JSON boundary, never a float), and this
 * screen used to hand that string straight to the row: the agent's own panel read
 * "2100000" where it meant SEK 21,000, off by a factor of a hundred to anybody
 * reading quickly. Formatting happens here with the same `formatAmount` every
 * other figure on the screen goes through, so the commission follows the currency
 * preview too.
 */
export interface SettlementCommissionRow {
  id: string;
  performerLabel: string;
  performerEntitlement: string;
  commissionLabel: string;
  commission: string;
}

/** One party's sign-off, named, as the roster shows it. */
/**
 * How one party is reached about their settlement — the operator's view of the
 * review step, not a party's.
 *
 * `onPlatform` decides which half of the mechanism applies: an account means
 * "Send for review" already reaches them, in the app and by mail, with nothing to
 * arrange. No account means there is no address on file and the operator has to
 * say where it goes — which is what `sendInvitation` is for.
 */
export interface SettlementDeliveryRow {
  participantId: string;
  name: string;
  role: string;
  onPlatform: boolean;
  /** The address their settlement was sent to, when one has been assigned. */
  invitedEmail: string | null;
  invitedAt: string | null;
  /** When they last opened the link — "sent" and "read" are different answers. */
  lastSeenAt: string | null;
}

export interface SettlementApprovalRow {
  participantId: string;
  name: string;
  role: string;
  approved: boolean;
  approvedAt: string | null;
  isYours: boolean;
  /** The settlement to sign, or null when this signature is not the reader's to give. */
  signableSettlementId: string | null;
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
  commissions: SettlementCommissionRow[];
  /**
   * Gross takings → adjusted net, or NULL for a caller who may not read the
   * night's money. Null is the ceiling itself (story.md:44), not a loading state
   * and not an empty one — the screen must say so rather than render a blank.
   */
  ladder: LadderRow[] | null;
  approvals: SettlementApprovalRow[];
  /**
   * Who still has to be told, and how. Empty for anyone who cannot send the
   * settlement out — the API withholds it rather than the screen hiding it.
   */
  delivery: SettlementDeliveryRow[];
  /** Address a party who is not on shoWMe, and mail them their settlement. */
  sendInvitation: (participantId: string, email: string, name?: string) => void;
  isInviting: boolean;
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
  /**
   * WHY THE SETTLEMENT CANNOT BE RUN, naming the agreements it is waiting on — or
   * null when nothing is blocking it. Non-null means compute and finalize will
   * both be refused (decisions.md #21; the API answers 409 naming the same deals).
   *
   * A sentence rather than a list, because every place that needs it needs the
   * same sentence, and hand-assembled variants of one rule are the kind of
   * divergence that drifts. `UnsignedAgreementsNotice` takes it and renders it —
   * and it is the ONLY thing that draws it. Three components used to print this
   * string, two of them on the same tab, so the Financials screen carried the
   * identical paragraph twice.
   *
   * Party-scoped, like the deals list it comes from, so it is a lower bound: a
   * reader who is not a party to some deal will not see that deal here. Which is
   * why the buttons are DISABLED on a non-null notice rather than enabled on a
   * null one — null means "nothing I can see is blocking", and the server still
   * has the last word.
   */
  unsignedAgreementsNotice: string | null;
  /**
   * The event this settlement is for. Carried on the return so a component that
   * takes only `settlement` can still link back into the event workspace — the
   * unsigned-agreement notice sends the operator to its Deals tab.
   */
  eventId: string;
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
  /**
   * How to render minor units. Defaults to the settlement's own currency; the
   * screen passes a CONVERTING formatter when the reader is previewing in another
   * one. Threading it here rather than at each call site is what guarantees the
   * whole screen previews together — a page half-converted would be worse than
   * one not converted at all.
   */
  formatAmount: (minorUnits: string) => string = (minorUnits) => formatMoney(minorUnits, currency),
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

  /**
   * Everything a compute rewrites, not just the settlements list.
   *
   * A compute does three writes, and this used to invalidate one of them.
   * `reconcileEvent` also runs `ensureSettlementLines` (the settlement's own copy
   * of the budget) and captures the budget snapshot behind planned-vs-actual
   * (decisions.md #16.8) — so after "Run the settlement" the Financials tab sat
   * there still saying "No plan captured yet" over a plan that had just been
   * captured. Measured on the live stack 2026-08-31: the toast said "Reconciled 6
   * parties into 2 transfers" and the card below it did not move until a reload.
   *
   * `useSettlementLines` already invalidates exactly these three for the same
   * reason — all three are readings of the same money, and a screen showing one
   * fresh beside two stale is a screen that has lied once.
   */
  const refresh = useCallback(() => {
    for (const queryKey of [
      getGetApiV1EventsIdSettlementsQueryKey(eventId),
      getGetApiV1EventsIdSettlementLinesQueryKey(eventId),
      getGetApiV1EventsIdSettlementPlannedVsActualQueryKey(eventId),
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient, eventId]);

  const computeSettlement = usePostApiV1EventsIdSettlementCompute();
  const finalizeSettlement = usePostApiV1EventsIdSettlementFinalize();
  const confirmSettlement = usePostApiV1EventsIdSettlementsSidConfirm();
  const patchTransfer = usePatchApiV1EventsIdTransfersTid();
  const setStatus = usePostApiV1EventsIdSettlementStatus();
  const inviteToSettlement = usePostApiV1EventsIdSettlementInvitations();
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

  /**
   * Address a party who is not on shoWMe, and send them their settlement.
   *
   * The toast reports what actually happened rather than what was asked for: the
   * link is minted whether or not the mail sink accepted it, and telling somebody
   * their settlement "was sent" when the send failed is how a settlement sits
   * unsigned for a week with nobody wondering why.
   */
  const sendInvitation = useCallback(
    (participantId: string, email: string, name?: string) => {
      inviteToSettlement.mutate(
        { id: eventId, data: { participantId, email, name } },
        {
          onSuccess: (result) => {
            refresh();
            if (result.emailed) {
              toast.success(`Settlement sent to ${result.email}.`);
            } else {
              toast.error(
                `The link for ${result.email} was created, but the email could not be sent. Copy it from Share & Export.`,
              );
            }
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't send the settlement.")),
        },
      );
    },
    [inviteToSettlement, eventId, refresh, toast],
  );

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
      if (match) return match.name ?? match.performerTag ?? eventParticipantRoleLabel(match.role);
      // No roster entry to hand: the short id is honest where an invented label
      // ("Participant 2") would not be.
      return participantId ? participantId.slice(0, 8) : "Participant";
    },
    [roster],
  );

  const roleOf = useCallback(
    (participantId: string | null | undefined): string => {
      const match = (roster ?? []).find((party) => party.id === participantId);
      return match ? eventParticipantRoleLabel(match.role) : "Party";
    },
    [roster],
  );

  const rows = settlements.data?.settlements ?? [];

  /**
   * The settlements belonging to PARTIES on the bill, which is what every
   * whole-document question is really about: what status the document is at,
   * whether its figures are frozen, whether the review conversation is still
   * open.
   *
   * A representation settlement — an agent's commission on their performer's
   * income — is a private side agreement that rides along with the event and has
   * its own lifecycle; it must never answer for the document. The API already
   * draws this line (it serves commission rows under `commissions`, and
   * `settlements` only where `participantId` is set), so today this filter
   * removes nothing. It stays because the whole-document questions below are
   * meaningless over a side agreement, and that should not depend on a filter
   * happening to be applied one service away.
   */
  const partyRows = rows.filter((row) => row.participantId != null);

  const parties = useMemo(
    () => rows.map((row) => toParty(row, currency, nameOf, roleOf, formatAmount)),
    [rows, currency, nameOf, roleOf, formatAmount],
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
    return formatAmount(total.toString());
  }, [payable, formatAmount]);

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
          amount: formatAmount(transfer.amount),
          state: transferStateOf(transfer.state),
        })),
    [settlements.data, formatAmount, nameOf],
  );

  const approvals = useMemo(() => {
    const mine = new Set(
      rows.filter((row) => row.isYours).map((row) => row.participantId as string),
    );
    const signable = new Map(
      rows
        .filter((row) => row.signableByYou)
        .map((row) => [row.participantId as string, row.id] as const),
    );
    return (settlements.data?.approvals ?? []).map((approval) => ({
      participantId: approval.participantId,
      name: nameOf(approval.participantId),
      role: roleOf(approval.participantId),
      approved: approval.approved,
      approvedAt: approval.approvedAt,
      isYours: mine.has(approval.participantId),
      // The settlement id to sign, or null when this line is not the reader's to
      // sign. Carried on the roster row because the roster IS where somebody
      // looks to find out who still owes a signature.
      signableSettlementId: signable.get(approval.participantId) ?? null,
    }));
  }, [settlements.data, rows, nameOf, roleOf]);

  const ladder = settlements.data?.ladder ?? null;

  const dealRows = useMemo(
    () => toDealRows(rows, deals.data ?? [], currency, nameOf, formatAmount),
    [rows, deals.data, currency, nameOf, formatAmount],
  );

  /**
   * The same three questions the server's `assertEveryAgreementSigned` asks, in
   * the same order: is it withdrawn (nothing to wait for), has anybody actually
   * got to sign it (an all-`observer` deal can never be confirmed), and is it
   * signed. Kept literally parallel so a reader can check the two against each
   * other; the server is the enforcement and this is only the affordance.
   */
  const unsignedAgreementsNotice = useMemo(() => {
    const waiting = (deals.data ?? []).filter(
      (deal) =>
        deal.status !== "cancelled" &&
        deal.parties.some((party) => party.roleInDeal !== "observer") &&
        deal.agreementStatus !== "confirmed" &&
        deal.agreementStatus !== "signed",
    );
    if (waiting.length === 0) return null;
    // NAMED, never counted. "1 agreement outstanding" sends the operator hunting
    // through the Deals tab for it, and chasing the signature is the only move
    // this message exists to enable.
    const names = waiting.map((deal) => `“${deal.name}”`).join(", ");
    return `The settlement cannot open until every agreement is signed. Still waiting on ${names}. Send each to its parties and have them confirm it, or cancel one whose booking is off.`;
  }, [deals.data]);

  return {
    parties,
    transfers,
    commissions: (settlements.data?.commissions ?? []).map((commission) => ({
      id: commission.id,
      performerLabel: `${nameOf(commission.performerParticipantId)} entitlement`,
      performerEntitlement: formatAmount(commission.performerEntitlement),
      commissionLabel: `Commission to ${nameOf(commission.agentParticipantId)}`,
      commission: formatAmount(commission.commission),
    })),
    ladder: ladder ? ladderRows(ladder, currency, formatAmount) : null,
    approvals,
    approvedCount: approvals.filter((approval) => approval.approved).length,
    delivery: (settlements.data?.delivery ?? []).map((row) => ({
      participantId: row.participantId,
      name: nameOf(row.participantId),
      role: roleOf(row.participantId),
      onPlatform: row.onPlatform,
      invitedEmail: row.invitedEmail,
      invitedAt: row.invitedAt,
      lastSeenAt: row.lastSeenAt,
    })),
    sendInvitation,
    isInviting: inviteToSettlement.isPending,
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
    unsignedAgreementsNotice,
    eventId,
    isComputed: partyRows.some((row) => row.computed != null),
    isFinalized: partyRows.some((row) => FROZEN_STATUSES.has(row.status)),
    status: partyRows[0]?.status ?? "open",
    payouts: payable.map((party) => ({
      key: party.settlementId,
      label: `${party.name} payout`,
      value: party.net as string,
    })),
    totalPayable,
    retainsOwnShare: ownRetains,
    // The review conversation is over once the figures freeze — after that the
    // only honest objection is a dispute, which stays available.
    canReview: partyRows.length > 0 && !partyRows.some((row) => FROZEN_STATUSES.has(row.status)),
    sendForReview: () => moveTo("pending_review", "Sent for review."),
    reissue: () => moveTo("revised", "Figures re-issued."),
    flagDispute: () => moveTo("dispute", "Flagged as disputed."),
    comments: (commentThread.data ?? []).map((row) => ({
      id: row.id,
      // Resolved from the participant, not from a name stored on the row — one
      // source for who somebody is. A remark with no party is either the
      // operator speaking for the event or somebody off-platform, and only the
      // second kind carries `authorName` — so attributing it to the operator
      // when a name IS on the row would put a stranger's words in the venue's
      // mouth.
      author: row.partyParticipantId
        ? nameOf(row.partyParticipantId)
        : (row.authorName ?? "Operator"),
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

/**
 * "Paid in advance to The Lantern Hall" / "…by Marlo Vance and Neon Tide".
 *
 * THE DIRECTION IS THE POINT, and the old board had it backwards. `prepaid` is
 * POSITIVE for a party that RECEIVED an advance and negative for the one that
 * paid it out (`reconcile()` step 4b), while the row was labelled "Paid before
 * the event" for both — so a performer holding a 10 000 guarantee read as having
 * paid 10 000 out, which is the opposite of the truth and the wrong sign on the
 * one figure a settlement conversation starts from.
 *
 * Falls back to a direction with no names when the counterparties are absent —
 * every settlement finalized before the engine recorded them, which are legal
 * records and are never rewritten. Saying less is fine; saying it backwards is
 * not.
 */
function prepaidLabelOf(
  computed:
    | { prepaid?: string | null; prepaidCounterpartyIds?: string[] | null }
    | null
    | undefined,
  nameOf: (participantId: string | null | undefined) => string,
): string | null {
  const raw = computed?.prepaid;
  if (raw == null || raw === "0") return null;
  const received = !raw.startsWith("-");
  const others = (computed?.prepaidCounterpartyIds ?? []).map(nameOf).filter(Boolean);
  const direction = received ? "Paid in advance by" : "Paid in advance to";
  if (others.length === 0) return received ? "Paid in advance to you" : "Paid in advance by you";
  const named =
    others.length > 1
      ? `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`
      : others[0];
  return `${direction} ${named}`;
}

function toParty(
  row: Settlements["settlements"][number],
  currency: string,
  nameOf: (participantId: string | null | undefined) => string,
  roleOf: (participantId: string | null | undefined) => string,
  formatAmount: (minorUnits: string) => string,
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
    signableByYou: row.signableByYou,
    entitlement: computed ? formatAmount(computed.entitlement) : null,
    collected: computed ? formatAmount(computed.collected) : null,
    paid: computed ? formatAmount(computed.paid) : null,
    // Absent on a settlement finalized before advances were accounted for, and
    // zero on a night where nothing moved early — both mean "no row to show".
    prepaid:
      computed?.prepaid != null && computed.prepaid !== "0" ? formatAmount(computed.prepaid) : null,
    prepaidLabel: prepaidLabelOf(computed, nameOf),
    net: computed ? formatAmount(computed.net) : null,
    // The raw minor units alongside the formatted figure, ONLY so totals can be
    // summed as integers. Nothing renders this — `docs/money.md`: never do money
    // arithmetic on formatted text, and never through a float.
    netMinor: computed?.net ?? null,
    netTone: computed ? netToneOf(computed.net) : "neutral",
    rules: computed ? entitlementRules(computed, currency, formatAmount) : [],
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
  formatAmount: (minorUnits: string) => string,
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
        amount: formatAmount(line.amount),
      };
      if (existing) {
        existing.shares.push(share);
        continue;
      }
      byDeal.set(line.dealId, {
        dealId: line.dealId,
        name: deal?.name ?? `Deal ${line.dealId.slice(0, 8)}`,
        dealTotal: formatAmount(line.dealTotal),
        shares: [share],
      });
    }
  }
  return [...byDeal.values()];
}
