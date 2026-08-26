import {
  type DealDraft,
  type DealPartyDraft,
  type DealPartyRole,
  type DealStructure,
  type DealType,
  type PaymentTiming,
  dealDraftProblems,
  emptyDealDraft,
  emptyDealParty,
} from "@showme/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The composing state behind the agreement form. Every rule lives in
 * `@showme/shared/deal-terms` (plain TS, unit-tested); this holds the draft, the
 * party rows and the "am I allowed to submit yet" question, so the modal itself
 * decides nothing.
 */
export interface DealComposer {
  draft: DealDraft;
  setName: (value: string) => void;
  setType: (value: DealType) => void;
  /** `null` chooses a paper-only agreement — recorded and signed, never computed. */
  setStructure: (value: DealStructure | null) => void;
  setGuaranteeAmount: (value: string) => void;
  setSplitPercent: (value: string) => void;
  setAdvanceAmount: (value: string) => void;
  setPaymentTiming: (value: PaymentTiming) => void;
  setPartyParticipant: (key: string, participantId: string) => void;
  setPartyRole: (key: string, roleInDeal: DealPartyRole) => void;
  setPartySharePercent: (key: string, percent: string) => void;
  addParty: () => void;
  removeParty: (key: string) => void;
  /** Everything wrong with the draft right now, in plain sentences. */
  problems: string[];
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
): DealComposer {
  const [draft, setDraft] = useState<DealDraft>(() => emptyDealDraft(currency));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [nextKey, setNextKey] = useState(3);
  /**
   * Whether the person has typed a name of their own. Until they have, the field
   * follows the parties; the moment they touch it, it is theirs and nothing
   * overwrites it — a name that keeps changing under the cursor is worse than no
   * suggestion at all.
   */
  const [nameEdited, setNameEdited] = useState(false);

  const reset = useCallback(() => {
    setDraft(emptyDealDraft(currency));
    setSubmitAttempted(false);
    setNextKey(3);
    setNameEdited(false);
  }, [currency]);

  // A form left half-filled from last time is a form that submits somebody else's
  // terms by accident.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

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
    setName: (value) => {
      setNameEdited(true);
      setDraft((current) => ({ ...current, name: value }));
    },
    setType: (value) => setDraft((current) => ({ ...current, type: value })),
    setStructure: (value) => setDraft((current) => ({ ...current, structure: value })),
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
    problems,
    submitAttempted,
    markSubmitAttempted: () => setSubmitAttempted(true),
    reset,
  };
}
