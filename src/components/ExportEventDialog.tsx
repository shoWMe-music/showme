import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Share2, AlertTriangle, Globe, Lock } from "lucide-react";
import { toast, copyToast } from "@/hooks/use-toast";
import { createPublicEventShare, fetchSchedule, fetchCrew, fetchRiders, fetchAgreements, fetchEventCollaborators, fetchEventBudgetCalculator } from "@/lib/db";
import { useEvent, useEventEconomics } from "@/lib/queries";
import { useUser } from "@/lib/user-context";
import { newShareToken } from "@/lib/shareToken";
import type { TeamMember } from "@/lib/user-context";
import { TAB_SECTIONS, type SelectionLevel, type EventExportData } from "./export-event/types";
import { buildCSVContent } from "./export-event/buildCSVContent";
import { buildPrintHTML } from "./export-event/buildPrintHTML";
import { SectionSelector } from "./export-event/SectionSelector";
import { RecipientsInput } from "./export-event/RecipientsInput";
import { ExportActions, type ShareAccess } from "./export-event/ExportActions";
import { PublicShareWarningModal } from "./export-event/PublicShareWarningModal";
import { parseRecipientInput } from "./export-event/parseRecipientInput";
import type { DealStructure, TicketRevenue, Settlement } from "@/lib/models";

interface ShareExportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventName: string;
  eventId: string;
  eventStatus?: string;
  creatorName?: string;
  teamMembers?: TeamMember[];
  eventData?: EventExportData;
}

export default function ExportEventDialog({ open, onOpenChange, eventName, eventId, eventStatus, creatorName, teamMembers = [], eventData: eventDataProp }: ShareExportDialogProps) {
  const { currentUser } = useUser();
  const event = useEvent(eventId);
  const { deal, revenue, settlement, meta: eventMeta, isLoaded: economicsLoaded } = useEventEconomics(eventId, open && !eventDataProp);

  // Fetch subcollection data for export (schedule, crew, riders, agreements).
  // Wave 2/3 moved this data from the legacy managerData bridge into proper
  // subcollections; the export pipeline must wait for ALL of them before the
  // print HTML is allowed to render, otherwise the resulting PDF has a logo
  // and header but no section content. These run even when eventDataProp is
  // supplied (EventManagerPage path), because the parent's eventMeta comes
  // from useEventEconomics which does NOT include subcollection data — so
  // without these fetches the snapshot would store an eventMeta with no
  // schedule/crew/riders/agreements.
  const scheduleQ = useQuery({ queryKey: ["export-schedule", eventId], queryFn: () => fetchSchedule(eventId), enabled: open });
  const crewQ = useQuery({ queryKey: ["export-crew", eventId], queryFn: () => fetchCrew(eventId), enabled: open });
  const ridersQ = useQuery({ queryKey: ["export-riders", eventId], queryFn: () => fetchRiders(eventId), enabled: open });
  const agreementsQ = useQuery({ queryKey: ["export-agreements", eventId], queryFn: () => fetchAgreements(eventId), enabled: open });
  const collaboratorsQ = useQuery({ queryKey: ["export-collaborators", eventId], queryFn: () => fetchEventCollaborators(eventId), enabled: open });
  const schedule = scheduleQ.data;
  const crew = crewQ.data;
  const riders = ridersQ.data;
  const agreements = agreementsQ.data;
  const collaborators = collaboratorsQ.data;

  // Budget snapshot lives in events/{id}/budgets/{profileDocId}; we need the
  // profile id from eventMeta to fetch it. The recipient renderer reads
  // eventMeta.budget.{revenue,cost,result}Fields, so without this the budget
  // sections render as empty placeholders.
  const sourceMeta = eventDataProp?.eventMeta ?? eventMeta;
  const budgetProfileId = typeof sourceMeta?.budgetProfileId === "string" && sourceMeta.budgetProfileId.trim()
    ? sourceMeta.budgetProfileId.trim()
    : null;
  const budgetQ = useQuery({
    queryKey: ["export-budget", eventId, budgetProfileId],
    queryFn: () => fetchEventBudgetCalculator(eventId, budgetProfileId!),
    enabled: open && !!budgetProfileId,
  });
  const budget = budgetQ.data;

  const subcollectionsLoaded = !open || (
    scheduleQ.isSuccess && crewQ.isSuccess && ridersQ.isSuccess && agreementsQ.isSuccess && collaboratorsQ.isSuccess
    && (!budgetProfileId || budgetQ.isSuccess)
  );

  const eventData = useMemo<EventExportData | undefined>(() => {
    if (eventDataProp) {
      if (!subcollectionsLoaded) return undefined;
      return {
        ...eventDataProp,
        eventMeta: { ...eventDataProp.eventMeta, schedule, crew, riders, agreements, collaborators, budget: budget ?? undefined } as EventExportData["eventMeta"],
      };
    }
    if (!event || !economicsLoaded || !subcollectionsLoaded) return undefined;
    return {
      event,
      deal: deal ?? { eventId: event.id, dealType: "guarantee" as const, artistGuarantee: 0, artistSplit: 80, promoterSplit: 10, venueSplit: 10, organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 50, venueCostSplit: 50, organizerCostSplit: 0, venueRental: 0, commissions: [] } satisfies DealStructure,
      revenue: revenue ?? { eventId: event.id, ticketsSold: 0, grossRevenue: 0, ticketFees: 0, tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0 } as TicketRevenue,
      settlement: settlement ?? { eventId: event.id, promoterPayout: 0, artistPayout: 0, venuePayout: 0, commissionPayouts: [], status: "open" as const, approvals: [{ party: "Operator", approved: false }, { party: "Performer", approved: false }, { party: "Venue", approved: false }], comments: [], revisions: [] } as Settlement,
      eventMeta: { ...eventMeta, schedule, crew, riders, agreements, collaborators, budget: budget ?? undefined } as EventExportData["eventMeta"],
      currency: currentUser?.currency || "EUR",
    };
  }, [eventDataProp, event, economicsLoaded, subcollectionsLoaded, deal, revenue, settlement, eventMeta, schedule, crew, riders, agreements, collaborators, budget, currentUser?.currency]);

  const [level, setLevel] = useState<SelectionLevel>("sections");
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [expandedTabs, setExpandedTabs] = useState<Set<string>>(new Set());
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  // Default to Protected — public links require explicit opt-in plus a legal
  // acknowledgement, so the safer mode is the default.
  const [access, setAccess] = useState<ShareAccess>("protected");
  const [publicWarningOpen, setPublicWarningOpen] = useState(false);

  const allSectionIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(TAB_SECTIONS).forEach(t => t.sections.forEach(s => ids.add(s.id)));
    return ids;
  }, []);
  void allSectionIds; // referenced for completeness

  const handleLevelChange = (newLevel: SelectionLevel) => {
    setLevel(newLevel);
    if (newLevel === "all") {
      const allTabs = new Set(Object.keys(TAB_SECTIONS));
      const allSecs = new Set<string>();
      allTabs.forEach(tabId => TAB_SECTIONS[tabId]?.sections.forEach(s => allSecs.add(s.id)));
      setSelectedTabs(allTabs);
      setSelectedSections(allSecs);
    } else {
      setSelectedTabs(new Set());
      setSelectedSections(new Set());
    }
  };

  const toggleTab = (tabId: string) => {
    setSelectedTabs(prev => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
        const secs = TAB_SECTIONS[tabId]?.sections || [];
        setSelectedSections(sp => { const n = new Set(sp); secs.forEach(s => n.delete(s.id)); return n; });
      } else {
        next.add(tabId);
        const secs = TAB_SECTIONS[tabId]?.sections || [];
        setSelectedSections(sp => { const n = new Set(sp); secs.forEach(s => n.add(s.id)); return n; });
      }
      return next;
    });
  };

  const toggleSection = (sectionId: string, tabId: string) => {
    setSelectedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
      const tabSecs = TAB_SECTIONS[tabId]?.sections || [];
      const allSelected = tabSecs.every(s => next.has(s.id));
      setSelectedTabs(tp => { const tn = new Set(tp); if (allSelected) tn.add(tabId); else tn.delete(tabId); return tn; });
      return next;
    });
  };

  const toggleExpandTab = (tabId: string) => {
    setExpandedTabs(prev => { const next = new Set(prev); if (next.has(tabId)) next.delete(tabId); else next.add(tabId); return next; });
  };

  const addRecipient = () => {
    const { valid, invalid } = parseRecipientInput(recipientInput);
    if (valid.length === 0 && invalid.length === 0) return;
    if (invalid.length > 0) {
      toast({
        title: invalid.length === 1 ? "Invalid email" : "Invalid email(s)",
        description: invalid.length === 1
          ? `"${invalid[0]}" is not a valid email address.`
          : `${invalid.length} entries are not valid: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "..." : ""}`,
        variant: "destructive",
      });
      // If everything was invalid, leave the user's input alone so they can fix it.
      if (valid.length === 0) return;
    }
    if (valid.length > 0) {
      setRecipients((prev) => {
        const next = [...prev];
        for (const v of valid) if (!next.includes(v)) next.push(v);
        return next;
      });
    }
    setRecipientInput("");
  };

  const addTeamMemberRecipient = (member: TeamMember) => {
    const email = member.email.toLowerCase().trim();
    if (!email) return;
    if (!recipients.includes(email)) setRecipients(prev => [...prev, email]);
  };

  const shareMutation = useMutation({
    mutationFn: async () => {
      const snapshotData = eventData ? {
        event: {
          id: eventData.event.id, name: eventData.event.name, date: eventData.event.date,
          venue: eventData.event.venue, artist: eventData.event.artist, operator: eventData.event.operator,
          operatorType: eventData.event.operatorType, capacity: eventData.event.capacity,
          ticketingProvider: eventData.event.ticketingProvider, eventStatus: eventData.event.eventStatus,
          notes: eventData.event.notes,
          amenities: eventData.event.amenities,
          cateringNotes: eventData.event.cateringNotes,
          accommodationNotes: eventData.event.accommodationNotes,
        },
        deal: eventData.deal, revenue: eventData.revenue, eventMeta: eventData.eventMeta,
        settlement: eventData.settlement, currency: eventData.currency,
      } : {};
      // Always mint a fresh random token — share docs are frozen by design,
      // so reusing a token would silently overwrite a previous snapshot.
      const shareToken = newShareToken();
      const recipientsForWrite = access === "public"
        ? []
        : recipients.map((email) => ({ email }));
      await createPublicEventShare(shareToken, {
        eventId,
        access,
        recipients: recipientsForWrite,
        snapshotData,
        sections: Array.from(selectedSections),
        tabs: Array.from(selectedTabs),
        level,
        creatorName: creatorName || "Unknown",
      });
      return shareToken;
    },
    onSuccess: async (shareToken) => {
      const params = getUrlParams();
      const url = `${window.location.origin}/shared/event/${eventId}?token=${shareToken}${params ? `&${params}` : ""}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
        copyToast(
          "Link copied",
          access === "protected" && recipients.length > 0
            ? `Only accessible by: ${recipients.join(", ")}`
            : "Public link — anyone with the URL can access this.",
        );
      } catch {
        toast({ title: "Could not copy", variant: "destructive" });
      }
      setPublicWarningOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create share link", description: err?.message || "Unknown error", variant: "destructive" });
    },
  });

  const hasSelection = level === "all" || selectedTabs.size > 0 || selectedSections.size > 0;

  const getUrlParams = () => {
    if (level === "all") return "";
    const tabs = Array.from(selectedTabs).join(",");
    const sections = level === "sections" ? Array.from(selectedSections).join(",") : "";
    let params = `tabs=${tabs}`;
    if (sections) params += `&sections=${sections}`;
    return params;
  };

  const handlePrint = () => {
    if (!eventData) { toast({ title: "Please wait for data to load", description: "Event data is still loading. Please try again in a moment.", variant: "destructive" }); return; }
    const html = buildPrintHTML(selectedTabs, selectedSections, level, eventData);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
    onOpenChange(false);
  };

  const handleCSV = () => {
    if (!eventData) {
      toast({ title: "Please wait for data to load", description: "Event data is still loading. Please try again in a moment.", variant: "destructive" });
      return;
    }
    const csvContent = buildCSVContent(Array.from(selectedTabs), selectedSections, level, eventData);
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${eventName.replace(/[^a-zA-Z0-9]/g, "_")}_report.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast({ title: "CSV downloaded", description: `Report for ${eventName} has been downloaded.` });
    onOpenChange(false);
  };

  const handleShareLink = () => {
    if (!eventData) {
      toast({ title: "Please wait for data to load", description: "Event data is still loading. Please try again in a moment.", variant: "destructive" });
      return;
    }
    if (access === "public") {
      setPublicWarningOpen(true);
      return;
    }
    shareMutation.mutate();
  };

  const handleConfirmPublic = () => {
    shareMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" /> Share & Export
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{eventName}</p>

        {eventStatus && eventStatus !== "confirmed" && (
          <Alert variant="destructive" className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-800 dark:text-yellow-200 [&>svg]:text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This event has not been confirmed yet. Sharing unconfirmed event details is not recommended.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 py-2">
          <p className="text-sm font-medium">What to share:</p>
          <div className="flex flex-wrap gap-2">
            {([["all", "All Event Details (Details, Agreement, Crew)"], ["tabs", "Specific Tab"], ["sections", "Specific Section"]] as const).map(([val, label]) => (
              <Button key={val} variant={level === val ? "default" : "outline"} size="sm" className="text-xs h-8"
                onClick={() => handleLevelChange(val)}>{label}</Button>
            ))}
          </div>
        </div>

        {level !== "all" && (
          <SectionSelector
            level={level}
            selectedTabs={selectedTabs}
            selectedSections={selectedSections}
            expandedTabs={expandedTabs}
            onToggleTab={toggleTab}
            onToggleSection={toggleSection}
            onToggleExpandTab={toggleExpandTab}
          />
        )}

        <Separator />

        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Link access</Label>
          <RadioGroup
            value={access}
            onValueChange={(v) => setAccess(v as ShareAccess)}
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            <label
              htmlFor="share-access-protected"
              className={`flex items-start gap-2 rounded-md border p-3 cursor-pointer transition-colors ${
                access === "protected" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              }`}
            >
              <RadioGroupItem id="share-access-protected" value="protected" className="mt-0.5" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="h-3.5 w-3.5" /> Protected
                </div>
                <p className="text-xs text-muted-foreground">
                  Only the recipients you list can open the link.
                </p>
              </div>
            </label>
            <label
              htmlFor="share-access-public"
              className={`flex items-start gap-2 rounded-md border p-3 cursor-pointer transition-colors ${
                access === "public" ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              }`}
            >
              <RadioGroupItem id="share-access-public" value="public" className="mt-0.5" />
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Globe className="h-3.5 w-3.5" /> Public
                </div>
                <p className="text-xs text-muted-foreground">
                  Anyone with the URL can open the link.
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {access === "protected" ? (
          <RecipientsInput
            recipientInput={recipientInput}
            recipients={recipients}
            teamMembers={teamMembers}
            onChangeInput={setRecipientInput}
            onAdd={addRecipient}
            onRemove={(email) => setRecipients(prev => prev.filter(x => x !== email))}
            onAddTeamMember={addTeamMemberRecipient}
          />
        ) : (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Public link — anyone with the URL can view this snapshot. No recipient list required.
          </div>
        )}

        <Separator />

        <ExportActions
          hasSelection={hasSelection}
          access={access}
          recipients={recipients}
          sharing={shareMutation.isPending}
          copied={copied}
          onPrint={handlePrint}
          onCSV={handleCSV}
          onShareLink={handleShareLink}
        />

        <PublicShareWarningModal
          open={publicWarningOpen}
          onOpenChange={(v) => {
            if (!shareMutation.isPending) setPublicWarningOpen(v);
          }}
          onConfirm={handleConfirmPublic}
          pending={shareMutation.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
