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
import { dealKindLabel, eventParticipantRoleLabel } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { errorMessage } from "../lib/errors";
import { absoluteMinor, formatMoney } from "../lib/format";
import type { Transfer } from "./WhoOwesWhomBoard";
import {
  type EntitlementRule,
  type LadderRow,
  type PayoutAdjustment,
  describeBasis,
  entitlementGapSentence,
  entitlementRules,
  initialsOf,
  isWholeBoard,
  ladderRows,
  netToneOf,
  payoutAdjustments,
  payoutsCaption,
  transferStateOf,
  withheldPartyCount,
  withheldPayees,
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
  /**
   * `budget.edit` — whether the Financials tab will actually let this reader in
   * (QA sweep run 8, QA8-14).
   *
   * The revenue preview's subtitle said *"Edit them there"* to everybody, and for a party
   * without `budget.view` the Financials tab answers *"The plan is the operator's view"*.
   * The instruction and the refusal were one click apart.
   */
  canEditFinancials: boolean;
}

export function settlementAuthorityOf(capabilities: readonly string[]): SettlementAuthority {
  return {
    canCompute: capabilities.includes("settlement.edit"),
    canFinalize: capabilities.includes("settlement.finalize"),
    canConfirm: capabilities.includes("settlement.confirm"),
    canEditFinancials: capabilities.includes("budget.edit"),
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
  /**
   * The same figure with its sign stripped — for a label that already names the
   * direction in words (QA7-28).
   *
   * "You owe −SEK 45,000" is a double negative and reads as a credit. The magnitude
   * is taken off the RAW minor units and re-formatted, never by cutting a character
   * off `net`: a formatted amount puts its minus wherever the locale wants it
   * (`docs/money.md`).
   */
  netAbsolute: string | null;
  /** Raw minor units — for summing only. Never rendered. */
  netMinor: string | null;
  /**
   * The entitlement in raw minor units, for the same reason `netMinor` exists and
   * under the same rule: summing and proportioning only, never rendered.
   *
   * The design's Overview draws a stacked bar of who took what and a percentage
   * beside every party ("66.3%"). Both need the figures as integers, and both
   * would otherwise be computed off formatted text — which `docs/money.md`
   * forbids, and for good reason: "SEK 50 750,00" parses differently in four
   * locales and silently in none.
   */
  entitlementMinor: string | null;
  netTone: "positive" | "negative" | "neutral";
  /**
   * The sentences behind the entitlement ("70% of the adjusted net beats the
   * €50,000 guarantee"). Empty for a settlement snapshotted before the engine
   * recorded a basis — the card then shows the bare figure rather than inventing
   * an explanation for it.
   */
  rules: EntitlementRule[];
  /**
   * The rows UNDER the card's divider — cash that moves the payout without being part of
   * the entitlement above it (QA8-5, and QA7-10 for the advance).
   *
   * `rules` sum to the headline; these explain the distance from it to what actually
   * moves. Built by `payoutAdjustments` from the engine's own `net = entitlement − held`.
   */
  adjustments: PayoutAdjustment[];
}

/** One remark in the review thread, with its author resolved to a person. */
export interface SettlementComment {
  id: string;
  author: string;
  message: string;
  createdAt: string;
  isYours: boolean;
  /** The one figure this is about, or null for the settlement as a whole. */
  settlementLineId: string | null;
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
  commissionableIncome: string;
  commissionLabel: string;
  commission: string;
  /**
   * WHO ELSE CAN SEE THIS CARD, said to whoever is reading it (QA8-13).
   *
   * The eyebrow was a fixed *"private to you and your agent"*, which is true on the
   * performer's copy and nonsense on the agent's — the agent IS the agent. Same class of
   * slip as QA6-9, in a card that fix did not reach, and it is built here because this is
   * where the names are.
   */
  privacyNote: string;
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
  /**
   * Whether this party already has the WHOLE settlement (decisions.md #24.2).
   * The send dialog seeds its toggle from this, so a re-send cannot silently
   * revoke a disclosure the operator made deliberately.
   */
  fullAccess: boolean;
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

/**
 * A DEAL'S TERMS, for the Overview — what kind it is and what it pays.
 *
 * ClickUp `86cbcn1ue`: *"Deal type and Fee must appear in the Overview section of
 * the settlement."*
 *
 * Built from the DEALS themselves, not from `settlements.computed.lines` the way
 * `SettlementDealRow` is. That difference is the whole point: the agreement's
 * terms are readable the moment it is written, while what it PAID does not exist
 * until the night has been reconciled. An operator opening the Overview before
 * computing was shown a page with no mention of the deal at all — and "what did we
 * agree" is the question the Overview is for.
 */
export interface SettlementAgreementRow {
  dealId: string;
  name: string;
  /** "Guarantee vs door", "Door split" — the composer's own words. */
  kind: string;
  /** The headline figure, already formatted. Null for terms that state no amount. */
  fee: string | null;
  /** "70% of the adjusted net", when that is what it pays. Null otherwise. */
  share: string | null;
  /**
   * The same percentage as a NUMBER, for the ticket-revenue illustration the
   * design draws beside the terms. Null when the deal states no percentage.
   *
   * Carried as well as the sentence because the two are used for different
   * things: the sentence is read, the number is multiplied. Re-parsing "70% of
   * the adjusted net" to get 7000 back would be a second, worse copy of a figure
   * the API already served.
   */
  splitBasisPoints: number | null;
  /** Set only when part of it moved before the night. */
  paidInAdvance: string | null;
}

/**
 * ONE PARTY'S SLICE OF THE ADJUSTED NET, ready to draw — the design's
 * "Entitlement by party" list and the stacked bar above it.
 *
 * `fraction` is what the bar is drawn from and `percent` is what is printed
 * beside the name ("66.3%"). Both come off the same integer division, so the bar
 * and the number can never disagree — which is the failure mode of computing one
 * in the hook and the other in the component.
 */
export interface EntitlementShare {
  key: string;
  name: string;
  role: string;
  initials: string;
  /** Formatted, in the reader's display currency like every other figure. */
  amount: string;
  /** "66.3", or null when there is nothing to take a share of. */
  percent: string | null;
  /** 0‥1 of the total entitlement — the bar's width. */
  fraction: number;
  /** The rule behind the figure, one line, as the design prints it. */
  rule: string | null;
  isYours: boolean;
}

export interface EventSettlement {
  parties: SettlementParty[];
  /**
   * Every party's slice of the adjusted net, largest first — the Overview's
   * "Total settlement" card and the Collaborators tab's positions.
   */
  shares: EntitlementShare[];
  /** Σ of those slices, formatted — what the bar adds up to. */
  totalEntitlement: string;
  /** The bottom of the waterfall, formatted. Null behind the pool ceiling. */
  adjustedNet: string | null;
  /** The agreements' TERMS, readable before anything is reconciled. */
  agreements: SettlementAgreementRow[];
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
  /**
   * Why the entitlements below do not sum to the adjusted net above them, or null
   * when they do. See the memo where it is computed.
   */
  entitlementReconciliation: string | null;
  /**
   * THE SCREEN'S OWN MONEY FORMATTER, so a card built outside this hook cannot format
   * a figure differently from the rest of the page.
   *
   * The Ticketing card did exactly that: it formatted in the settlement's base
   * currency while every card around it read the reader's preview, and one night
   * looked like two ledgers (measured 2026-09-26).
   */
  formatMoney: (minorUnits: string) => string;
  /** The same, to the minor unit — for a per-unit price a reader multiplies. */
  formatMoneyUnit: (minorUnits: string) => string;
  /**
   * How many of this event's deals this reader may not see. Non-zero with an empty
   * `agreements` means "not yours to read", not "none exists" — the Deal-structure tab
   * told crew a show with a confirmed door split had no agreement at all.
   */
  hiddenDealCount: number;
  payouts: { key: string; label: string; value: string }[];
  totalPayable: string;
  /**
   * The Total Payouts panel's one sentence, chosen by `payoutsCaption`.
   *
   * It replaces `retainsOwnShare` and `payoutsIncludeOthers`, which the component nested into a
   * ternary that told a co-operator its share was retained while it held nothing (QA sweep run
   * 11). Neither flag was read anywhere else, so neither survives as a separate export.
   */
  payoutsCaptionText: string;
  /** The caller's own party line, if they are a party at all. */
  ownParty: SettlementParty | null;
  /**
   * WHAT THIS NIGHT MOVES FOR THE READER — the one figure a settlement screen leads with.
   *
   * `ownParty.net` is not it, and the third seat is where that shows. An agent's money on
   * an event is a COMMISSION (#14): a representation-scoped settlement with a null
   * `participantId`, so the event breakdown carries `net 0` for them and is right to. The
   * headline read "SEK 0 · Your payout" while the dashboard, `/settlements` and this
   * workspace's own Total Payouts all said SEK 3,000, and a transfer row existed for it
   * (QA sweep run 8, QA8-4).
   *
   * So it is the reader's own net PLUS their own commission, summed here on minor units
   * rather than in a component (`docs/money.md`, and components stay dumb). `commissions`
   * only ever carries rows naming the reader as the agent, so this is identical to `net`
   * for an operator and a performer — which is why QA7-28's proof in those two seats still
   * stands.
   *
   * Null when the reader is not a party at all: a real "nothing here for you", which the
   * tab distinguishes from an unreconciled event.
   */
  ownFigure: { amount: string; tone: "positive" | "negative" | "neutral" } | null;
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
  /**
   * Send it out — to everyone, or to named parties, optionally granting them the
   * whole settlement (#24.2). The modal composes all three; the header's plain
   * button calls it with nothing, which is what it has always meant.
   */
  sendForReview: (options?: { participantIds?: string[]; fullAccess?: boolean }) => void;
  /**
   * Ask ONE party to review, leaving the rest of the bill where it is.
   *
   * The same route as `sendForReview` with the party named — `status` is a column
   * on each participant's own settlement row, so this is a narrower call rather
   * than a different mechanism (ClickUp `86cbcn1ue`).
   */
  sendForReviewTo: (participantId: string, name: string) => void;
  reissue: () => void;
  flagDispute: () => void;
  /** True while the figures can still be re-issued — i.e. not yet frozen. */
  canReview: boolean;
  comments: SettlementComment[];
  /**
   * Add a remark. Naming a line anchors it to that figure — which is the whole
   * point, since answering a settlement comment MEANS changing a figure and a
   * remark in a general thread makes the reader hunt for which one.
   */
  postComment: (message: string, settlementLineId?: string) => void;
  /**
   * Run the reconciliation. `seedFromBudget: false` is the design's "start fresh"
   * — the same run, copying nothing (see `reconcileEvent`).
   */
  compute: (options?: { seedFromBudget?: boolean }) => void;
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
  /**
   * The same money to the MINOR UNIT, for a per-unit price a reader multiplies —
   * `60 x ≈ €7` beside `≈ €414` reads as an error when neither figure is wrong. Only
   * passed while the screen is previewing in another currency; in the settlement's own
   * currency the whole-unit form already reconciles.
   */
  formatAmountExact?: (minorUnits: string) => string,
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

  const compute = useCallback(
    (options?: { seedFromBudget?: boolean }) => {
      computeSettlement.mutate(
        {
          id: eventId,
          // Sent only when the operator chose "start fresh". Every other caller
          // means the default, and the route has always been bodyless.
          ...(options?.seedFromBudget === false ? { params: { seedFromBudget: "false" } } : {}),
        },
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
    },
    [computeSettlement, eventId, refresh, toast],
  );

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
    (
      status: "pending_review" | "revised" | "dispute",
      done: string,
      /** Named parties only. Omitted means everyone, which is what the header does. */
      participantIds?: string[],
      /**
       * Grant or withdraw full settlement access as part of the send (#24.2).
       * OMITTED leaves each party's grant as it was — silence about access is
       * silence, not withdrawal.
       */
      fullAccess?: boolean,
    ) => {
      setStatus.mutate(
        {
          id: eventId,
          data: {
            status,
            ...(participantIds ? { participantIds } : {}),
            ...(fullAccess != null ? { fullAccess } : {}),
          },
        },
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
    (message: string, settlementLineId?: string) => {
      addComment.mutate(
        { id: eventId, data: settlementLineId ? { message, settlementLineId } : { message } },
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
  /**
   * THE SLICES, largest first.
   *
   * Negative entitlements are left out of the BAR rather than drawn as a negative
   * width: on a night that lost money the operator's slice is below zero, and a
   * proportion bar has nothing honest to say about that. They still appear in the
   * list beneath it with their real figure — the card's job is to show who took
   * what, and "less than nothing" is an answer the list can carry and the bar
   * cannot.
   */
  const shares = useMemo<EntitlementShare[]>(() => {
    const entitled = parties.filter((party) => party.entitlementMinor != null);
    /*
     * A PERCENTAGE OF ONE ROW IS NOT A PERCENTAGE.
     *
     * These are shares of the entitlements THIS READER CAN SEE, which is the only
     * honest denominator — but a performer sees exactly their own line, so the column
     * read "100.0%" always, on every settlement, whatever their deal said. Measured
     * 2026-09-26: Marlo Vance on a 60/40 bill, paid SEK 33,600 of a SEK 53,500
     * adjusted net, with "100.0%" beside it. A figure that cannot vary carries no
     * information and reads as a claim about the deal.
     *
     * So it is withheld below two rows. The rule beside each name still says what the
     * deal takes, which is the fact a single-row reader actually wants.
     */
    const percentsAreMeaningful = entitled.length > 1;
    const positiveTotal = entitled.reduce((running, party) => {
      const amount = BigInt(party.entitlementMinor ?? "0");
      return amount > 0n ? running + amount : running;
    }, 0n);
    return entitled
      .map((party) => {
        const minor = BigInt(party.entitlementMinor ?? "0");
        const fraction =
          positiveTotal > 0n && minor > 0n ? Number((minor * 10_000n) / positiveTotal) / 10_000 : 0;
        return {
          key: party.settlementId,
          name: party.isYours ? `${party.name} (you)` : party.name,
          role: party.role,
          initials: party.initials,
          amount: party.entitlement as string,
          percent:
            percentsAreMeaningful && positiveTotal > 0n && minor > 0n
              ? (fraction * 100).toFixed(1)
              : null,
          fraction,
          /*
           * THE FIRST REASON IS NOT THE WHOLE REASON (QA sweep run 6, QA6-12).
           *
           * This took `rules[0]` and printed it beside the party's total, so the
           * operator's `SEK 25,000` was captioned *"Rental of SEK 5,000, settled off
           * the top"* — which explains 20% of it. The other SEK 20,000 is the
           * residual, itemised correctly one tab over on the same data.
           *
           * The Overview is a summary and should not grow into the Settlement tab's
           * itemised column, so a party whose figure has more than one reason says so
           * and sends the reader to the place that lists them.
           */
          rule:
            party.rules.length > 1
              ? `${party.rules[0]?.label ?? ""} — and ${party.rules.length - 1} more, itemised on the Settlement tab`
              : (party.rules[0]?.label ?? null),
          isYours: party.isYours,
          sortKey: minor,
        };
      })
      .sort((left, right) =>
        right.sortKey > left.sortKey ? 1 : right.sortKey < left.sortKey ? -1 : 0,
      )
      .map(({ sortKey: _sortKey, ...share }) => share);
  }, [parties]);

  const totalEntitlement = useMemo(() => {
    const total = parties.reduce(
      (running, party) => running + BigInt(party.entitlementMinor ?? "0"),
      0n,
    );
    return formatAmount(total.toString());
  }, [parties, formatAmount]);

  const ownParticipantId = useMemo(
    () => parties.find((party) => party.isYours)?.participantId ?? null,
    [parties],
  );

  /**
   * THE PARTIES THIS READER PAYS AND CANNOT READ (QA sweep run 5, QA5-1).
   *
   * A co-operator is party to no DEAL, so `partiesVisibleTo` withholds their
   * settlement row from the host — while the TRANSFER that pays them is scoped
   * separately and does arrive. Every total built from `parties` alone is therefore
   * short by exactly what this finds. The rule itself is pure and tested in
   * `settlementDocument.ts`; here it is only given names and formatting.
   */
  const withheld = useMemo(() => {
    const rule = withheldPayees(settlements.data?.transfers ?? [], {
      ownParticipantId,
      visibleParticipantIds: parties
        .map((party) => party.participantId)
        .filter((id): id is string => id != null),
    });
    return rule.map((payee) => ({
      ...payee,
      name: nameOf(payee.participantId),
    }));
  }, [settlements.data, ownParticipantId, parties, nameOf]);

  const withheldTotalMinor = useMemo(
    () => withheld.reduce((running, payee) => running + BigInt(payee.amountMinor), 0n),
    [withheld],
  );

  /**
   * WHY THE ENTITLEMENTS DO NOT SUM TO THE ADJUSTED NET.
   *
   * The band above the list states the adjusted net and used to be captioned
   * "Adjusted net divided", while the lines beneath it are ENTITLEMENTS — each one
   * a party's share of that pool plus the cash they collected and minus what was
   * deducted from them. Measured 2026-09-26: a header of SEK 53,500 over rows
   * summing to SEK 55,000, with percentages taken off the 55,000. Every figure was
   * individually right and the one check a reader can do by eye failed.
   *
   * So the difference is stated rather than left to be discovered. Null when the two
   * do agree, which is the ordinary case on a night with no collections or
   * deductions.
   */
  const entitlementReconciliation = useMemo(() => {
    const adjustedNetMinor = settlements.data?.ladder?.adjustedNet ?? null;
    if (adjustedNetMinor == null) return null;
    const entitlements = parties.reduce(
      (running, party) => running + BigInt(party.entitlementMinor ?? "0"),
      0n,
    );
    // The wording is `entitlementGapSentence` — pure, per-branch tested, and there
    // rather than here because this sentence has been wrong twice by asserting a
    // cause the same screen's own data contradicts (QA5-1, then QA6-4).
    const visible = rows.map((row) => row.computed).filter((computed) => computed != null);
    return entitlementGapSentence({
      /*
       * The parties on the night this reader has no settlement for — from the `approvals`
       * roster the same response already serves, which is every party (QA11-2). Without it a
       * co-operator's missing row fell through to the cash-and-deductions branch, and the host
       * read a cause its own figures do not support.
       */
      withheldPartyCount: withheldPartyCount(
        settlements.data?.approvals ?? [],
        rows.map((row) => row.participantId),
      ),
      entitlementsMinor: entitlements,
      adjustedNetMinor: BigInt(adjustedNetMinor),
      withheldMinor: withheldTotalMinor,
      offTheTopMinor: BigInt(settlements.data?.ladder?.offTheTop ?? "0"),
      collectedMinor: visible.reduce(
        (running, computed) => running + BigInt(computed.collected),
        0n,
      ),
      deductiblesMinor: visible.reduce(
        (running, computed) => running + BigInt(computed.deductibles ?? "0"),
        0n,
      ),
      format: formatAmount,
    });
  }, [parties, rows, settlements.data, formatAmount, withheldTotalMinor]);

  const payable = useMemo(() => parties.filter((party) => party.netTone === "positive"), [parties]);
  /**
   * AN AGENT'S OWN MONEY ON THIS NIGHT IS A COMMISSION, NOT A SETTLEMENT NET.
   *
   * A commission is paid out of the act's entitlement by a representation
   * transfer, which this screen deliberately keeps out of the who-owes-whom list
   * (#14, see `transfers`). The consequence nobody had followed through: the agent
   * has no positive net of their own, so `payable` held only their CLIENT's payout
   * and the card above it said "What is payable to you on this event". Measured
   * 2026-09-26: an agent owed SEK 3,581 read SEK 0 on every screen, and the event
   * workspace showed them the act's figure under their own heading.
   *
   * `commissions` is empty for an operator and carries only the reader's own side
   * otherwise, so summing the rows that name this reader as the agent is the whole
   * of "what this night owes me".
   */
  const ownCommissionMinor = useMemo(() => {
    if (!ownParticipantId) return 0n;
    return (settlements.data?.commissions ?? [])
      .filter((commission) => commission.agentParticipantId === ownParticipantId)
      .reduce((running, commission) => running + BigInt(commission.commission), 0n);
  }, [settlements.data, ownParticipantId]);
  /*
   * WHO IS HOLDING THE NIGHT'S MONEY — and the comment this replaces stated the rule right and
   * tested its converse (QA sweep run 11).
   *
   * It read: *"Whoever is HOLDING the night's money has a negative net — they are the one who
   * pays everybody else, and their own share is retained rather than transferred."* True. The
   * code asked `isYours && netTone === "negative"`, which is the other direction: a co-operator
   * who collected nothing and simply owes money IN also has a negative net, and read the host's
   * sentence *"As operator your share is retained"* while holding nothing and paying nobody.
   *
   * `collected > 0` is the fact the sentence is about. An operator who FRONTED the costs and
   * collected nothing is out of pocket rather than retaining anything, and lands in the fallback
   * rather than on a specific claim that is wrong about them.
   *
   * READ OFF `rows`, NOT `parties`. A `SettlementParty` carries `collected` already FORMATTED —
   * "SEK 0" — and the first draft of this handed that to `BigInt` and took the whole settlement
   * screen down with *"Cannot convert SEK 0 to a BigInt"*. Caught in the browser, which is the
   * only place it could have been: every suite was green. `docs/money.md`'s rule, one layer
   * along — the browser never does arithmetic on formatted text.
   */
  const ownHoldsCash = useMemo(
    () =>
      rows.some(
        (row) => row.isYours && row.computed != null && BigInt(row.computed.collected) > 0n,
      ),
    [rows],
  );
  const ownOwesOut = useMemo(
    () => parties.some((party) => party.isYours && party.netTone === "negative"),
    [parties],
  );
  const totalPayable = useMemo(() => {
    const total = payable.reduce(
      (running, party) => running + BigInt(party.netMinor ?? "0"),
      ownCommissionMinor + withheldTotalMinor,
    );
    return formatAmount(total.toString());
  }, [payable, ownCommissionMinor, withheldTotalMinor, formatAmount]);

  /**
   * AND ON THE CARD, NOT ONLY IN THE HEADLINE (QA sweep run 9, QA9-8).
   *
   * QA8-4 moved the headline to net + commission and stopped there, so an agent read
   * **SEK 3,000 · Your payout** over their own card printing **SEK 0** with no rows at all —
   * the one place on the screen telling them they earned nothing, two cards above a
   * commission card saying otherwise. That is the same one-line-apart contradiction QA7-28
   * was filed for, reintroduced by its own fix.
   *
   * The card's headline is the ENTITLEMENT and an agent's is genuinely zero — their money is
   * a representation-scoped settlement with no participant — so the commission belongs where
   * the cash and the advance already are: under the divider, as the thing that explains the
   * distance between the entitlement above it and what actually moves. Which is exactly what
   * that divider is for (QA8-5).
   *
   * Decorated here rather than inside `toParty` because `ownParticipantId` is derived FROM
   * `parties`, so the commission cannot be known while they are being built.
   */
  const partiesWithOwnCommission = useMemo(() => {
    if (ownCommissionMinor === 0n) return parties;
    return parties.map((party) =>
      party.isYours
        ? {
            ...party,
            adjustments: [
              ...party.adjustments,
              {
                key: "own-commission",
                label: "Your commission on this night",
                value: formatAmount(ownCommissionMinor.toString()),
                // It is money coming TO the agent: the entitlement above is zero and this is
                // the whole of what moves.
                reducesPayout: false,
              },
            ],
          }
        : party,
    );
  }, [parties, ownCommissionMinor, formatAmount]);

  const ownParty = useMemo(
    () => partiesWithOwnCommission.find((party) => party.isYours) ?? null,
    [partiesWithOwnCommission],
  );
  /**
   * The reader's own position, commission included — see `ownFigure` on the interface for
   * why the commission has to be in it (QA8-4).
   *
   * The MAGNITUDE is formatted, because the label beside it names the direction in words
   * ("You owe SEK 45,000", never "You owe −SEK 45,000"), and the tone is taken from the
   * combined total rather than from `netTone`: an agent whose net is 0 and whose commission
   * is positive is owed money, and the sign has to follow the figure actually shown.
   */
  const ownFigure = useMemo(() => {
    if (!ownParty) return null;
    if (ownParty.netMinor == null) return null;
    const total = BigInt(ownParty.netMinor) + ownCommissionMinor;
    return {
      amount: formatAmount(absoluteMinor(total.toString())),
      tone: netToneOf(total.toString()),
    };
  }, [ownParty, ownCommissionMinor, formatAmount]);

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
    () => toDealRows(rows, deals.data?.deals ?? [], currency, nameOf, formatAmount),
    [rows, deals.data, currency, nameOf, formatAmount],
  );

  const agreementRows = useMemo(
    () => toAgreementRows(deals.data?.deals ?? [], currency),
    [deals.data, currency],
  );

  /**
   * The same three questions the server's `assertEveryAgreementSigned` asks, in
   * the same order: is it withdrawn (nothing to wait for), has anybody actually
   * got to sign it (an all-`observer` deal can never be confirmed), and is it
   * signed. Kept literally parallel so a reader can check the two against each
   * other; the server is the enforcement and this is only the affordance.
   */
  const unsignedAgreementsNotice = useMemo(() => {
    const waiting = (deals.data?.deals ?? []).filter(
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
    parties: partiesWithOwnCommission,
    transfers,
    commissions: (settlements.data?.commissions ?? []).map((commission) => ({
      id: commission.id,
      // NAMED FOR WHAT IT IS (r2:603). The row used to be labelled "<act>
      // entitlement" beside a figure that is not their entitlement — the act's own
      // settlement says SEK 33,600 where this said 32,100, and the two were 1,500
      // apart under one word. The commission is charged on commissionable income.
      performerLabel: `${nameOf(commission.performerParticipantId)} commissionable income`,
      commissionableIncome: formatAmount(commission.commissionableIncome),
      commissionLabel: `Commission to ${nameOf(commission.agentParticipantId)}`,
      commission: formatAmount(commission.commission),
      /*
       * Names the OTHER party, whichever side is reading (QA8-13). The agent sees the act
       * they represent; the act sees "your agent", which is the sentence that was always
       * there and was always right for them. A commission is private to exactly these two
       * (#14), so naming one of them is the whole of what the eyebrow has to say.
       */
      privacyNote:
        commission.agentParticipantId === ownParticipantId
          ? `Private to you and ${nameOf(commission.performerParticipantId)}`
          : "Private to you and your agent",
    })),
    ladder: ladder ? ladderRows(ladder, currency, formatAmount) : null,
    adjustedNet: ladder ? formatAmount(ladder.adjustedNet) : null,
    shares,
    totalEntitlement,
    entitlementReconciliation,
    formatMoney: formatAmount,
    hiddenDealCount: deals.data?.hiddenCount ?? 0,
    formatMoneyUnit: formatAmountExact ?? formatAmount,
    approvals,
    approvedCount: approvals.filter((approval) => approval.approved).length,
    delivery: (settlements.data?.delivery ?? []).map((row) => ({
      participantId: row.participantId,
      name: nameOf(row.participantId),
      role: roleOf(row.participantId),
      onPlatform: row.onPlatform,
      invitedEmail: row.invitedEmail,
      fullAccess: row.fullAccess === true,
      invitedAt: row.invitedAt,
      lastSeenAt: row.lastSeenAt,
    })),
    sendInvitation,
    isInviting: inviteToSettlement.isPending,
    deals: dealRows,
    agreements: agreementRows,
    ownParty: ownParty,
    ownFigure: ownFigure,
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
    payouts: [
      ...payable.map((party) => ({
        key: party.settlementId,
        label: `${party.name} payout`,
        value: party.net as string,
      })),
      // A party paid by transfer whose settlement row is withheld. Named, because
      // the board two inches below already names them and a total that drops them
      // is the defect this fixes.
      ...withheld.map((payee) => ({
        key: `withheld-${payee.participantId}`,
        label: `${payee.name} payout`,
        value: formatAmount(payee.amountMinor),
      })),
      // The reader's own commission, where they have one — see `ownCommissionMinor`.
      ...(ownCommissionMinor > 0n
        ? [
            {
              key: "own-commission",
              label: "Your commission",
              value: formatAmount(ownCommissionMinor.toString()),
            },
          ]
        : []),
    ],
    totalPayable,
    /**
     * WHAT THE PANEL SAYS IT IS SHOWING — one sentence, decided in `settlementDocument.ts`.
     *
     * It was a nested ternary in the component over `retainsOwnShare` and
     * `payoutsIncludeOthers`, and it hid two sentences that were untrue of a co-operator at
     * once. Both flags are folded into the rule rather than exported, because neither was ever
     * read for anything else.
     */
    payoutsCaptionText: payoutsCaption({
      readerCollected: ownHoldsCash,
      readerOwesOut: ownOwesOut,
      includesOthers: payable.some((party) => !party.isYours) || withheld.length > 0,
      includesYours: payable.some((party) => party.isYours) || ownCommissionMinor > 0n,
    }),
    // The review conversation is over once the figures freeze — after that the
    // only honest objection is a dispute, which stays available.
    canReview: partyRows.length > 0 && !partyRows.some((row) => FROZEN_STATUSES.has(row.status)),
    sendForReview: (options) =>
      moveTo(
        "pending_review",
        options?.participantIds?.length === 1 ? "Sent for review." : "Sent for review.",
        options?.participantIds,
        options?.fullAccess,
      ),
    sendForReviewTo: (participantId: string, name: string) =>
      moveTo("pending_review", `Sent to ${name}.`, [participantId]),
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
      settlementLineId: row.settlementLineId ?? null,
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
    // Still read by the who-owes-whom board, which renders the advance as its own row.
    prepaidLabel: prepaidLabelOf(computed, nameOf),
    net: computed ? formatAmount(computed.net) : null,
    netAbsolute: computed ? formatAmount(absoluteMinor(computed.net)) : null,
    // The raw minor units alongside the formatted figure, ONLY so totals can be
    // summed as integers. Nothing renders this — `docs/money.md`: never do money
    // arithmetic on formatted text, and never through a float.
    netMinor: computed?.net ?? null,
    entitlementMinor: computed?.entitlement ?? null,
    netTone: computed ? netToneOf(computed.net) : "neutral",
    // WHOSE card this is, so a caption on another party's card stops saying "you"
    // about them (QA6-9). `name` is already resolved above.
    rules: computed
      ? entitlementRules(computed, currency, formatAmount, { isYours: row.isYours, name })
      : [],
    // The same `owner` and the same formatter as the rules above it, so a card previewed
    // in another currency converts both halves or neither.
    adjustments: computed
      ? payoutAdjustments(
          computed,
          currency,
          formatAmount,
          { isYours: row.isYours, name },
          prepaidLabelOf(computed, nameOf),
        )
      : [],
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
/**
 * The agreements' TERMS, in the composer's own vocabulary.
 *
 * `dealKindLabel` rather than a second mapping: a deal written as "Guarantee vs
 * door" must not read back as "guarantee_vs_door", and the one place that decides
 * how a kind is spelled is `@showme/shared`. A local map here would drift from the
 * composer the first time either changed.
 *
 * Each deal's OWN currency where it has one — a fee agreed in EUR on a SEK night
 * is a EUR fee, and restating it in the base currency here would be inventing a
 * conversion that the settlement does not make until it locks a rate at finalize
 * (`docs/money.md`).
 */
function toAgreementRows(
  deals: Awaited<ReturnType<typeof getApiV1EventsIdDeals>>["deals"],
  displayCurrency: string,
): SettlementAgreementRow[] {
  return deals.map((deal) => {
    const currency = deal.currency ?? displayCurrency;
    return {
      dealId: deal.id,
      name: deal.name,
      kind: dealKindLabel(deal.type, deal.structure ?? null),
      fee: deal.guaranteeAmount ? formatMoney(deal.guaranteeAmount, currency) : null,
      share:
        deal.splitBasisPoints != null
          ? `${(deal.splitBasisPoints / 100).toFixed(0)}% of the adjusted net`
          : null,
      splitBasisPoints: deal.splitBasisPoints ?? null,
      paidInAdvance: deal.advanceAmount ? formatMoney(deal.advanceAmount, currency) : null,
    };
  });
}

function toDealRows(
  rows: Settlements["settlements"],
  deals: Awaited<ReturnType<typeof getApiV1EventsIdDeals>>["deals"],
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
