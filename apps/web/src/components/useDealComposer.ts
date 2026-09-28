import {
  type DealDraft,
  type DealKind,
  type DealPartyDraft,
  type DealPartyRole,
  type PaymentTiming,
  type StoredDealTerms,
  dealDraftFrom,
  dealDraftNotices,
  dealDraftProblems,
  dealKindOf,
  dealTypeForKind,
  emptyDealDraft,
  emptyDealEscalator,
  emptyDealParty,
  structureForKind,
} from "@showme/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The composing state behind the agreement form. Every rule lives in
 * `@showme/shared/deal-terms` (plain TS, unit-tested); this holds the draft, the
 * party rows and the "am I allowed to submit yet" question, so the modal itself
 * decides nothing.
 */
export interface DealComposer {
  /**
   * The draft as the form holds it, with `structure` and `type` DERIVED from the
   * chosen kind — the two used to be two questions and are now one (`deal-terms`
   * `DEAL_KIND_OPTIONS`). Never assembled by hand: reading them off the kind in
   * one place is what stops the pair from disagreeing.
   */
  draft: DealDraft;
  /** The single menu's current choice. */
  kind: DealKind;
  setName: (value: string) => void;
  setKind: (value: DealKind) => void;
  setGuaranteeAmount: (value: string) => void;
  setSplitPercent: (value: string) => void;
  setAdvanceAmount: (value: string) => void;
  setPaymentTiming: (value: PaymentTiming) => void;
  setPartyParticipant: (key: string, participantId: string) => void;
  setPartyRole: (key: string, roleInDeal: DealPartyRole) => void;
  setPartySharePercent: (key: string, percent: string) => void;
  addParty: () => void;
  removeParty: (key: string) => void;
  /**
   * THE LADDER (ClickUp `123qy9rnwud` / `123qy9rp8k3`). The engine has settled escalator
   * bands since it was written and `deals.terms` has stored them since the schema was
   * written; no screen could enter one, which is the whole of the `high` ticket.
   */
  addEscalator: () => void;
  removeEscalator: (key: string) => void;
  setEscalatorThreshold: (key: string, tickets: string) => void;
  setEscalatorSplitPercent: (key: string, percent: string) => void;
  setBonusThreshold: (value: string) => void;
  setBonusAmount: (value: string) => void;
  /** Everything wrong with the draft right now, in plain sentences. */
  problems: string[];
  /**
   * What the draft will DO that is not obvious and is not an error — today, only
   * that a deal paying nobody records terms and computes nothing. Shown from the
   * first keystroke rather than on submit, because it describes what the operator
   * is about to save, not a reason they cannot.
   */
  notices: string[];
  /** True once the composer has been asked to submit — problems show only then. */
  submitAttempted: boolean;
  markSubmitAttempted: () => void;
  reset: () => void;
}

/** How a participant is named on this event, for the auto-naming below. */
export interface DealPartyName {
  id: string;
  label: string;
}

/** The roles the agreement PAYS — the ones whose name the agreement takes. */
const ENTITLED_ROLES: readonly DealPartyRole[] = ["payee", "split_member"];

/**
 * The name an agreement takes from its parties.
 *
 * 2026-08 settlements meeting: **"Deal naming uses the name of the person or
 * entity on the agreement."** The entitled parties are the ones it is *with* —
 * a rental is named for the room, a booking for the act — so those are the names
 * used, in the order they were added. Two are enough to identify it; beyond that
 * a count reads better than a list that overflows the field.
 */
export function suggestedDealName(
  parties: readonly DealPartyDraft[],
  names: readonly DealPartyName[],
): string {
  const entitled = parties
    .filter((party) => party.participantId !== "" && ENTITLED_ROLES.includes(party.roleInDeal))
    .map((party) => names.find((name) => name.id === party.participantId)?.label)
    .filter((label): label is string => Boolean(label));
  if (entitled.length === 0) return "";
  if (entitled.length <= 2) return entitled.join(" & ");
  return `${entitled[0]} & ${entitled.length - 1} others`;
}

export function useDealComposer(
  /** The event's base currency — a deal's payout currency defaults to it. */
  currency: string,
  /** Participants on this event whose role is `agent` (never an entitled party). */
  agentParticipantIds: readonly string[],
  /** Resets the draft whenever the form is (re)opened. */
  open: boolean,
  /** Everyone on the event, by name — what an unnamed agreement is named after. */
  partyNames: readonly DealPartyName[] = [],
  /**
   * AN EXISTING DEAL TO EDIT, or undefined to compose a new one (QA sweep run 8, QA8-1).
   *
   * The whole of "editing" is which draft the form opens on: `dealDraftFrom` is the inverse of
   * `createDealPayload`, so a stored deal comes back in the units it was typed in and every
   * rule, problem and notice below applies unchanged. Nothing else about the composer knows
   * whether it is creating or revising.
   */
  seed?: StoredDealTerms | null,
): DealComposer {
  const [held, setDraft] = useState<DealDraft>(() => emptyDealDraft(currency));
  const [kind, setKind] = useState<DealKind>("guarantee");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [nextKey, setNextKey] = useState(3);
  /**
   * Whether the person has typed a name of their own. Until they have, the field
   * follows the parties; the moment they touch it, it is theirs and nothing
   * overwrites it — a name that keeps changing under the cursor is worse than no
   * suggestion at all.
   */
  const [nameEdited, setNameEdited] = useState(false);

  /**
   * The draft the rest of the app sees. `structure` is whatever the chosen kind
   * settles as, and `type` is derived from the kind and the party lines
   * (`dealTypeForKind`) — computed HERE, once, rather than written by each of the
   * six mutators that can change a party, which is how the two would drift.
   */
  const draft = useMemo<DealDraft>(
    () => ({
      ...held,
      structure: structureForKind(kind),
      type: dealTypeForKind(kind, held.parties),
    }),
    [held, kind],
  );

  const reset = useCallback(() => {
    /*
     * An existing deal opens on ITS terms; a new one on a blank form (QA8-1). `nameEdited` is
     * true for a seeded deal because it already HAS a name somebody chose — leaving it false
     * would let the party-name suggestion overwrite it on the first keystroke elsewhere.
     */
    if (seed) {
      setDraft(dealDraftFrom(seed, currency));
      setKind(dealKindOf(seed.type, seed.structure));
      setNameEdited(true);
    } else {
      setDraft(emptyDealDraft(currency));
      setKind("guarantee");
      setNameEdited(false);
    }
    setSubmitAttempted(false);
    setNextKey(3);
  }, [currency, seed]);

  // A form left half-filled from last time is a form that submits somebody else's
  // terms by accident.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  /** One band, changed in place — the same shape `editParty` has, for the same reason. */
  const editEscalator = useCallback(
    (
      key: string,
      change: (band: DealDraft["escalators"][number]) => DealDraft["escalators"][number],
    ) => {
      setDraft((current) => ({
        ...current,
        escalators: current.escalators.map((band) => (band.key === key ? change(band) : band)),
      }));
    },
    [],
  );

  const editParty = useCallback(
    (
      key: string,
      change: (party: DealDraft["parties"][number]) => DealDraft["parties"][number],
    ) => {
      setDraft((current) => ({
        ...current,
        parties: current.parties.map((party) => (party.key === key ? change(party) : party)),
      }));
    },
    [],
  );

  const problems = useMemo(
    () => dealDraftProblems(draft, agentParticipantIds),
    [draft, agentParticipantIds],
  );
  const notices = useMemo(() => dealDraftNotices(draft), [draft]);

  // The agreement names itself after the parties it pays, until somebody names it
  // themselves. Done as an effect off the parties rather than inside
  // `setPartyParticipant`, so choosing a party, changing its role, or removing a
  // line all keep the suggestion honest.
  const suggestion = suggestedDealName(draft.parties, partyNames);
  useEffect(() => {
    if (nameEdited || suggestion === "") return;
    setDraft((current) =>
      current.name === suggestion ? current : { ...current, name: suggestion },
    );
  }, [suggestion, nameEdited]);

  return {
    draft,
    kind,
    setName: (value) => {
      setNameEdited(true);
      setDraft((current) => ({ ...current, name: value }));
    },
    setKind,
    setGuaranteeAmount: (value) => setDraft((current) => ({ ...current, guaranteeAmount: value })),
    setSplitPercent: (value) => setDraft((current) => ({ ...current, splitPercent: value })),
    setAdvanceAmount: (value) => setDraft((current) => ({ ...current, advanceAmount: value })),
    setPaymentTiming: (value) => setDraft((current) => ({ ...current, paymentTiming: value })),
    setPartyParticipant: (key, participantId) =>
      editParty(key, (party) => ({ ...party, participantId })),
    setPartyRole: (key, roleInDeal) => editParty(key, (party) => ({ ...party, roleInDeal })),
    setPartySharePercent: (key, sharePercent) =>
      editParty(key, (party) => ({ ...party, sharePercent })),
    addParty: () => {
      setDraft((current) => ({
        ...current,
        parties: [...current.parties, emptyDealParty(`party-${nextKey}`)],
      }));
      setNextKey((key) => key + 1);
    },
    removeParty: (key) =>
      setDraft((current) => ({
        ...current,
        parties: current.parties.filter((party) => party.key !== key),
      })),
    addEscalator: () => {
      setDraft((current) => ({
        ...current,
        escalators: [...current.escalators, emptyDealEscalator(`band-${nextKey}`)],
      }));
      setNextKey((key) => key + 1);
    },
    removeEscalator: (key) =>
      setDraft((current) => ({
        ...current,
        escalators: current.escalators.filter((band) => band.key !== key),
      })),
    setEscalatorThreshold: (key, thresholdSold) =>
      editEscalator(key, (band) => ({ ...band, thresholdSold })),
    setEscalatorSplitPercent: (key, splitPercent) =>
      editEscalator(key, (band) => ({ ...band, splitPercent })),
    setBonusThreshold: (bonusThreshold) => setDraft((current) => ({ ...current, bonusThreshold })),
    setBonusAmount: (bonusAmount) => setDraft((current) => ({ ...current, bonusAmount })),
    problems,
    notices,
    submitAttempted,
    markSubmitAttempted: () => setSubmitAttempted(true),
    reset,
  };
}
