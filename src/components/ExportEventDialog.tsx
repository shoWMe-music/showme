import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Share2, AlertTriangle } from "lucide-react";
import { toast, copyToast } from "@/hooks/use-toast";
import { createPublicEventShare, fetchSchedule, fetchCrew, fetchRiders, fetchAgreements } from "@/lib/db";
import { useEvent, useEventEconomics } from "@/lib/queries";
import { useUser } from "@/lib/user-context";
import type { TeamMember } from "@/lib/user-context";
import { TAB_SECTIONS, type SelectionLevel, type EventExportData } from "./export-event/types";
import { buildCSVContent } from "./export-event/buildCSVContent";
import { buildPrintHTML } from "./export-event/buildPrintHTML";
import { SectionSelector } from "./export-event/SectionSelector";
import { RecipientsInput } from "./export-event/RecipientsInput";
import { ExportActions } from "./export-event/ExportActions";
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

  // Fetch subcollection data for export (schedule, crew, riders, agreements)
  const fetchSubcollections = open && !eventDataProp;
  const { data: schedule } = useQuery({ queryKey: ["export-schedule", eventId], queryFn: () => fetchSchedule(eventId), enabled: fetchSubcollections });
  const { data: crew } = useQuery({ queryKey: ["export-crew", eventId], queryFn: () => fetchCrew(eventId), enabled: fetchSubcollections });
  const { data: riders } = useQuery({ queryKey: ["export-riders", eventId], queryFn: () => fetchRiders(eventId), enabled: fetchSubcollections });
  const { data: agreements } = useQuery({ queryKey: ["export-agreements", eventId], queryFn: () => fetchAgreements(eventId), enabled: fetchSubcollections });

  const eventData = useMemo<EventExportData | undefined>(() => {
    if (eventDataProp) return eventDataProp;
    if (!event || !economicsLoaded) return undefined;
    return {
      event,
      deal: deal ?? { eventId: event.id, dealType: "guarantee" as const, artistGuarantee: 0, artistSplit: 80, promoterSplit: 10, venueSplit: 10, organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 50, venueCostSplit: 50, organizerCostSplit: 0, venueRental: 0, commissions: [] } satisfies DealStructure,
      revenue: revenue ?? { eventId: event.id, ticketsSold: 0, grossRevenue: 0, ticketFees: 0, tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0 } as TicketRevenue,
      settlement: settlement ?? { eventId: event.id, promoterPayout: 0, artistPayout: 0, venuePayout: 0, commissionPayouts: [], status: "open" as const, approvals: [{ party: "Operator", approved: false }, { party: "Performer", approved: false }, { party: "Venue", approved: false }], comments: [], revisions: [] } as Settlement,
      eventMeta: { ...eventMeta, schedule, crew, riders, agreements } as EventExportData["eventMeta"],
      currency: currentUser?.currency || "EUR",
    };
  }, [eventDataProp, event, economicsLoaded, deal, revenue, settlement, eventMeta, schedule, crew, riders, agreements, currentUser?.currency]);

  const [level, setLevel] = useState<SelectionLevel>("sections");
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [expandedTabs, setExpandedTabs] = useState<Set<string>>(new Set());
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

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
    const v = recipientInput.trim().toLowerCase();
    if (!v) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(v)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    if (!recipients.includes(v)) setRecipients(prev => [...prev, v]);
    setRecipientInput("");
  };

  const addTeamMemberRecipient = (member: TeamMember) => {
    const email = member.email.toLowerCase().trim();
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
        },
        deal: eventData.deal, revenue: eventData.revenue, eventMeta: eventData.eventMeta,
        settlement: eventData.settlement, currency: eventData.currency,
      } : {};
      const shareToken = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `share-${Date.now()}`;
      await createPublicEventShare(shareToken, {
        eventId, recipients, snapshotData,
        sections: Array.from(selectedSections), tabs: Array.from(selectedTabs),
        level, creatorName: creatorName || "Unknown",
      });
      return shareToken;
    },
    onSuccess: async (shareToken) => {
      const params = getUrlParams();
      const url = `${window.location.origin}/shared/event/${eventId}?token=${shareToken}${params ? `&${params}` : ""}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
        copyToast("Link copied", recipients.length > 0 ? `Only accessible by: ${recipients.join(", ")}` : "Anyone with the link can access this.");
      } catch {
        toast({ title: "Could not copy", variant: "destructive" });
      }
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
    shareMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
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
          <div className="flex gap-2">
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

        <RecipientsInput
          recipientInput={recipientInput}
          recipients={recipients}
          teamMembers={teamMembers}
          onChangeInput={setRecipientInput}
          onAdd={addRecipient}
          onRemove={(email) => setRecipients(prev => prev.filter(x => x !== email))}
          onAddTeamMember={addTeamMemberRecipient}
        />

        <Separator />

        <ExportActions
          hasSelection={hasSelection}
          recipients={recipients}
          sharing={shareMutation.isPending}
          copied={copied}
          onPrint={handlePrint}
          onCSV={handleCSV}
          onShareLink={handleShareLink}
        />
      </DialogContent>
    </Dialog>
  );
}
