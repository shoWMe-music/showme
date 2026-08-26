import {
  type DealDraft,
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

export function useDealComposer(
  /** The event's base currency — a deal's payout currency defaults to it. */
  currency: string,
  /** Participants on this event whose role is `agent` (never an entitled party). */
  agentParticipantIds: readonly string[],
  /** Resets the draft whenever the form is (re)opened. */
  open: boolean,
): DealComposer {
  const [draft, setDraft] = useState<DealDraft>(() => emptyDealDraft(currency));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [nextKey, setNextKey] = useState(3);

  const reset = useCallback(() => {
    setDraft(emptyDealDraft(currency));
    setSubmitAttempted(false);
    setNextKey(3);
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

  return {
    draft,
    setName: (value) => setDraft((current) => ({ ...current, name: value })),
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
