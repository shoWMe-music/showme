import {
  getGetApiV1EventsIdSharesQueryKey,
  useDeleteApiV1EventsIdSharesShareId,
  useGetApiV1EventsId,
  useGetApiV1EventsIdBudgets,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdRiders,
  useGetApiV1EventsIdSchedule,
  useGetApiV1EventsIdSettlements,
  useGetApiV1EventsIdShares,
  usePostApiV1EventsIdShares,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { downloadTextFile } from "../lib/budgetExport";
import { errorMessage } from "../lib/errors";
import {
  type ShareExportInput,
  printShareExport,
  shareExportCsv,
  shareExportFileName,
} from "../lib/shareExport";
import { canShareScope, shareUrl, withRequiredScopes } from "../lib/shareScope";
import { useCopyToClipboard } from "../lib/useCopyToClipboard";

/**
 * Everything behind the Share & Export dialog: what is being shared, who it goes
 * to, and the three ways it leaves the app (print, file, link). The modal stays a
 * renderer over this.
 *
 * The dialog only ever offers what the operator can already see. `capabilities`
 * comes off the event the screen is already holding, and the API refuses a grant
 * the sharer does not hold — so the tick-boxes are the same rule drawn twice, on
 * purpose: the client so nobody is offered a button that 403s, the server because
 * a client-side list is not a permission.
 */

/** Which document section a shared capability puts in the CSV. */
const CAPABILITY_SECTION: Record<string, string> = {
  "event.view": "event",
  "schedule.view": "schedule",
  "rider.view": "riders",
  "budget.view": "budget",
  "deal.view.own": "deal",
  "settlement.view.own": "settlement",
};

export interface ShareRecipientDraft {
  email: string;
  name: string;
}

export function useShareExport(eventId: string, open: boolean) {
  const toast = useToast();
  const clipboard = useCopyToClipboard();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<string[]>(["event.view", "schedule.view"]);
  const [recipients, setRecipients] = useState<ShareRecipientDraft[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const enabled = { query: { enabled: open } };
  const event = useGetApiV1EventsId(eventId, enabled);
  const participants = useGetApiV1EventsIdParticipants(eventId, enabled);
  const schedule = useGetApiV1EventsIdSchedule(eventId, enabled);
  const riders = useGetApiV1EventsIdRiders(eventId, enabled);
  const deals = useGetApiV1EventsIdDeals(eventId, enabled);
  // The two the operator may not hold. A 403 here is an ANSWER, not an error —
  // the section simply is not theirs to export — so neither is retried and
  // neither failure reaches the screen.
  const budgets = useGetApiV1EventsIdBudgets(eventId, {
    query: {
      enabled: open && (event.data?.capabilities ?? []).includes("budget.view"),
      retry: false,
    },
  });
  const settlements = useGetApiV1EventsIdSettlements(eventId, {
    query: {
      enabled: open && (event.data?.capabilities ?? []).includes("settlement.view.own"),
      retry: false,
    },
  });
  const links = useGetApiV1EventsIdShares(eventId, enabled);

  const held = useMemo(() => new Set(event.data?.capabilities ?? []), [event.data?.capabilities]);
  const capabilities = useMemo(() => withRequiredScopes(selected), [selected]);
  const sections = useMemo(
    () =>
      capabilities
        .map((capability) => CAPABILITY_SECTION[capability])
        .filter((section): section is string => section !== undefined),
    [capabilities],
  );

  const invalidateLinks = () =>
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdSharesQueryKey(eventId) });

  const createShare = usePostApiV1EventsIdShares({
    mutation: {
      onSuccess: (created) => {
        setCreatedToken(created.token);
        invalidateLinks();
      },
      onError: (error) => toast.error(errorMessage(error)),
    },
  });

  const revokeShare = useDeleteApiV1EventsIdSharesShareId({
    mutation: {
      onSuccess: () => {
        invalidateLinks();
        toast.success("Link revoked");
      },
      onError: (error) => toast.error(errorMessage(error)),
    },
  });

  const participantNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const party of participants.data ?? []) {
      names[party.id] = party.name ?? party.performerTag ?? party.role;
    }
    return names;
  }, [participants.data]);

  /**
   * The one description of "the show, as far as this dialog can see it" — shared
   * by the CSV and by the print. Two builders reading two differently-assembled
   * objects is how the file and the printout start disagreeing about the same
   * event, and the whole point of this dialog is that its three doors say one thing.
   */
  const exportInput = useMemo<ShareExportInput>(
    () => ({
      eventTitle: event.data?.title ?? "Event",
      currency: event.data?.baseCurrency ?? "EUR",
      event: event.data
        ? {
            status: event.data.status,
            eventDate: event.data.eventDate ?? null,
            venueName: event.data.venueName ?? null,
            capacity: event.data.capacity ?? null,
          }
        : null,
      schedule: schedule.data ?? [],
      riders: riders.data ?? [],
      budgetLines: (budgets.data ?? []).flatMap((budget) => budget.lines),
      deals: deals.data ?? [],
      // `computed` is the breakdown blob; the export wants two of its fields,
      // named, so the file says "entitlement" and "net" rather than carrying a
      // nested object a spreadsheet cannot open.
      settlements: (settlements.data?.settlements ?? []).map((settlement) => ({
        participantId: settlement.participantId,
        status: settlement.status,
        entitlement: settlement.computed?.entitlement ?? null,
        net: settlement.computed?.net ?? null,
      })),
      participantNames,
    }),
    [
      event.data,
      schedule.data,
      riders.data,
      budgets.data,
      deals.data,
      settlements.data,
      participantNames,
    ],
  );

  const toggle = (capability: string) =>
    setSelected((current) =>
      current.includes(capability)
        ? current.filter((value) => value !== capability)
        : [...current, capability],
    );

  const addRecipient = () => {
    const email = emailDraft.trim().toLowerCase();
    if (!email.includes("@")) {
      toast.error("That does not look like an email address");
      return;
    }
    if (recipients.some((recipient) => recipient.email === email)) return;
    setRecipients((current) => [...current, { email, name: nameDraft.trim() }]);
    setEmailDraft("");
    setNameDraft("");
  };

  const removeRecipient = (email: string) =>
    setRecipients((current) => current.filter((recipient) => recipient.email !== email));

  return {
    isPending: event.isPending,
    isError: event.isError,
    error: event.error,
    eventTitle: event.data?.title ?? "",
    canShare: (capability: string) => canShareScope(capability, held),
    selected,
    capabilities,
    toggle,
    recipients,
    emailDraft,
    setEmailDraft,
    nameDraft,
    setNameDraft,
    addRecipient,
    removeRecipient,
    links: links.data ?? [],
    isCreating: createShare.isPending,
    createdToken,
    createdUrl: createdToken ? shareUrl(createdToken) : null,

    /**
     * PDF is still the browser's print dialog — that is where "Save as PDF" lives
     * and no PDF library exists anywhere in this repo — but it prints the SHARED
     * DOCUMENT, not the app. `window.print()` here used to hand the operator a
     * picture of their own screen: sidebar, tab strip and this very dialog, since
     * the app carries no print stylesheet at all. Same rows as the CSV, same
     * sections as the link.
     */
    print: () => printShareExport(exportInput, sections),

    downloadCsv: () => {
      const csv = shareExportCsv(exportInput, sections);
      downloadTextFile(shareExportFileName(event.data?.title ?? "event"), csv, "text/csv");
    },

    create: () => {
      setCreatedToken(null);
      createShare.mutate({
        id: eventId,
        data: {
          capabilities,
          // PROTECTED, always. The owner's ruling (Q17): a share goes to an email
          // address and is redeemed with a code, so there is no anonymous tier to
          // offer and no consent gate to write for one. The API enforces the same
          // rule for anything financial regardless of what a client asks for.
          access: "protected",
          recipients: recipients.map((recipient) => ({
            email: recipient.email,
            name: recipient.name || undefined,
          })),
        },
      });
    },

    revoke: (shareId: string) => revokeShare.mutate({ id: eventId, shareId }),

    // The shared copier, not a private one: `navigator.clipboard` is refused on an
    // insecure origin and by permission policy, and a share link someone believes
    // they copied and did not is a link that never reaches its recipient.
    copyLink: (url: string) => clipboard.copy(url, "Link"),

    reset: () => {
      setCreatedToken(null);
      setRecipients([]);
      setEmailDraft("");
      setNameDraft("");
    },
  };
}
