import {
  getGetApiV1EventsIdSettlementLinesQueryOptions,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdSettlementLines,
  usePutApiV1EventsIdSettlementCuration,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { eventParticipantRoleLabel } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * CURATING WHAT EACH COLLABORATOR SEES — the hook behind Ran's §5 card.
 *
 * The component chooses chips; everything about what a choice MEANS lives here.
 *
 * **The role tabs are this file's invention, and the participants are the truth.**
 * The design's card has a tab per role (Performer / Venue / Promoter) because its
 * prototype has exactly one of each. A real bill has two performers, so a rule
 * stored against "performer" would show the support act the headliner's fee. So
 * the tabs are kept — they are how an operator thinks about a bill — and each one
 * resolves to the participants holding that role, which is what the API stores
 * against. A tab with two acts under it curates both, and says so.
 */

export interface CuratedParty {
  participantId: string;
  name: string;
  role: string;
}

/** One line, as a chip in the included/withheld lists. */
export interface CurationChip {
  lineId: string;
  label: string;
  /** "revenue" | "cost" — the chip's tint, and nothing else. */
  kind: string;
  included: boolean;
}

export interface SettlementCuration {
  /** Every party who can be curated — the operators are excluded (see below). */
  parties: CuratedParty[];
  /** Whose view is being edited. */
  selected: CuratedParty | null;
  select: (participantId: string) => void;
  chips: CurationChip[];
  /** Move one line in or out of the selected party's settlement. */
  toggle: (lineId: string) => void;
  /** True while a choice is being saved. */
  isBusy: boolean;
  /** Nothing to curate — no settlement lines yet. */
  isEmpty: boolean;
}

/**
 * Roles that are ALREADY able to read every line, so curating them is meaningless.
 *
 * An operator holds `budget.view`, which is the ceiling itself: the route serves
 * them the whole list whatever this column says. Offering their name in the
 * curation card would be offering a control that changes nothing — worse than
 * absent, because it reads as a promise that it does.
 */
const READS_EVERYTHING = new Set(["host", "co_host"]);

export function useSettlementCuration(eventId: string): SettlementCuration {
  const queryClient = useQueryClient();
  const toast = useToast();
  const lines = useGetApiV1EventsIdSettlementLines(eventId);
  const participants = useGetApiV1EventsIdParticipants(eventId);
  const setCuration = usePutApiV1EventsIdSettlementCuration();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const parties = useMemo<CuratedParty[]>(
    () =>
      (participants.data ?? [])
        .filter((party) => !READS_EVERYTHING.has(party.role))
        .map((party) => ({
          participantId: party.id,
          name: party.name ?? "This party",
          role: eventParticipantRoleLabel(party.role),
        })),
    [participants.data],
  );

  const selected =
    parties.find((party) => party.participantId === selectedId) ?? parties[0] ?? null;

  const chips = useMemo<CurationChip[]>(() => {
    if (!selected) return [];
    return (lines.data ?? []).map((line) => ({
      lineId: line.id,
      label: line.label,
      kind: line.kind,
      included: (line.visibleTo ?? []).includes(selected.participantId),
    }));
  }, [lines.data, selected]);

  const toggle = useCallback(
    (lineId: string) => {
      if (!selected) return;
      // The route takes EXACTLY the lines this party may see, so a toggle sends
      // the whole resulting set rather than a delta. That is what makes a
      // half-applied curation impossible: there is one statement, and it is
      // complete.
      const next = chips
        .filter((chip) => (chip.lineId === lineId ? !chip.included : chip.included))
        .map((chip) => chip.lineId);
      setCuration.mutate(
        { id: eventId, data: { participantId: selected.participantId, lineIds: next } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getGetApiV1EventsIdSettlementLinesQueryOptions(eventId).queryKey,
            });
          },
          onError: (error) =>
            toast.error(errorMessage(error, "Couldn't change what that collaborator sees.")),
        },
      );
    },
    [chips, selected, eventId, setCuration, queryClient, toast],
  );

  return {
    parties,
    selected,
    select: setSelectedId,
    chips,
    toggle,
    isBusy: setCuration.isPending,
    isEmpty: (lines.data ?? []).length === 0,
  };
}
