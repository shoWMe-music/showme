import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import DocumentPreviewDialog from "@/components/DocumentPreviewDialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn, generateSignatureHash } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useUser } from "@/lib/user-context";
import { FileUploadButton } from "./EditableSection";
import {
  formatCurrency, type Event as AppEvent, type EventCollaborator, type DealStructure, type TicketRevenue,
  type Agreement, type Rider, type ScheduleItem, type CommissionParty, type TicketType,
  type AgreementType, type RiderType,
  amenityLabels, riderTypeLabels, agreementTypeLabels,
  type AmenityKey,
} from "@/lib/models";
import {
  fetchAgreements, upsertAgreement, deleteAgreement,
  fetchRiders, fetchSchedule, appendEventActivity, type EventMeta,
} from "@/lib/db";
import { deleteStorageFile } from "@/lib/firebaseStorageUpload";
import { getAuthClient } from "@/lib/firebaseAuth";
import {
  FileText, Plus, Download, CheckCircle2, Trash2, Check, Lock, LockOpen,
} from "lucide-react";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";

/* ─── Agreement Tab ─── */
export function AgreementTab({ event, deal, revenue, eventMeta, onSave, currency, actingProfile, collaborators = [], readOnly, onConfirmed }: { event: AppEvent; deal: DealStructure | null | undefined; revenue?: TicketRevenue; eventMeta: EventMeta; onSave?: (d: Partial<EventMeta>) => void; currency?: string; actingProfile?: string; collaborators?: EventCollaborator[]; readOnly?: boolean; onConfirmed?: () => void }) {
  // agreements are stored in a Firestore subcollection, not on eventMeta
  const legacyAgreements = ((eventMeta as unknown as { agreements?: Agreement[] }).agreements) || [];
  const [agreements, setAgreements] = useState<Agreement[]>([...legacyAgreements]);
  const [terms, setTerms] = useState(eventMeta.dealDescription || "");
  const [addOpen, setAddOpen] = useState(false);
  const [newAg, setNewAg] = useState({ name: "", type: "custom" as AgreementType });
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [selfConfirmParty, setSelfConfirmParty] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ fileName: string; fileUrl: string } | null>(null);

  const { currentUser, profiles } = useUser();

  // Agreement confirmation tracking
  const [confirmations, setConfirmations] = useState<Array<{ party: string; confirmedAt: string; confirmedBy: string; method: "manual" | "self"; signature: string }>>(
    eventMeta.agreementConfirmations || []
  );
  const [lastChangedAt, setLastChangedAt] = useState<string>(
    eventMeta.agreementLastChangedAt || new Date().toISOString()
  );

  // Sync confirmations when eventMeta loads/changes (e.g. after query resolves)
  const prevConfirmationsRef = useRef(eventMeta.agreementConfirmations);
  useEffect(() => {
    if (eventMeta.agreementConfirmations !== prevConfirmationsRef.current) {
      prevConfirmationsRef.current = eventMeta.agreementConfirmations;
      setConfirmations(eventMeta.agreementConfirmations || []);
    }
    if (eventMeta.agreementLastChangedAt) {
      setLastChangedAt(eventMeta.agreementLastChangedAt);
    }
  }, [eventMeta.agreementConfirmations, eventMeta.agreementLastChangedAt]);

  // ── Agreements subcollection sync ──────────────────────────────────────────
  const agreementsLoaded = useRef<string | null>(null);
  const prevAgreementIds = useRef(new Set<string>(legacyAgreements.map((a: Agreement) => a.id)));
  const prevAgreementMap = useRef(new Map<string, Agreement>(legacyAgreements.map((a: Agreement) => [a.id, a])));

  useEffect(() => {
    agreementsLoaded.current = null;
    fetchAgreements(event.id).then(fetched => {
      if (fetched.length > 0) {
        prevAgreementIds.current = new Set(fetched.map(a => a.id));
        prevAgreementMap.current = new Map(fetched.map(a => [a.id, a]));
        setAgreements(fetched);
      }
      agreementsLoaded.current = event.id;
    });
  }, [event.id]);

  useEffect(() => {
    if (agreementsLoaded.current !== event.id) return;
    const currentIds = new Set(agreements.map(a => a.id));
    const removed = [...prevAgreementIds.current].filter(aid => !currentIds.has(aid));
    const added = agreements.filter(a => !prevAgreementIds.current.has(a.id));
    removed.forEach(aid => {
      const old = prevAgreementMap.current.get(aid);
      if (old?.fileUrl) deleteStorageFile(old.fileUrl);
      deleteAgreement(event.id, aid);
    });
    agreements.forEach(a => upsertAgreement(event.id, a));
    if (removed.length > 0 || added.length > 0) {
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      const details: Record<string, string> = {};
      if (added.length > 0) details.added = added.map(a => `${agreementTypeLabels[a.type] ?? a.type}${a.name ? ` "${a.name}"` : ""}`).join(", ");
      if (removed.length > 0) details.removed = `${removed.length} agreement(s)`;
      appendEventActivity(event.id, "agreement_updated", by, details, undefined, actingProfile);
      toast({ title: (<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Agreements saved</span>), duration: 1000 });
    }
    prevAgreementIds.current = currentIds;
    prevAgreementMap.current = new Map(agreements.map(a => [a.id, a]));
  }, [event.id, agreements, actingProfile]);

  // ── Riders & schedule for preview (read-only, loaded from subcollection) ───
  const [previewRiders, setPreviewRiders] = useState<Rider[]>([]);
  const [previewSchedule, setPreviewSchedule] = useState<ScheduleItem[]>([]);

  useEffect(() => {
    fetchRiders(event.id).then(fetched => { if (fetched.length > 0) setPreviewRiders(fetched); });
    fetchSchedule(event.id).then(fetched => { if (fetched.length > 0) setPreviewSchedule(fetched); });
  }, [event.id]);

  // Derive parties from the deal
  const dealParties = useMemo(() => {
    const parties: string[] = [];
    if (event.artist) parties.push("Performer");
    if (event.operator) parties.push(event.operatorType === "venue" ? "Venue" : event.operatorType === "organizer" ? "Organizer" : "Promoter");
    if (event.venue && event.operatorType !== "venue") parties.push("Venue");
    return parties;
  }, [event]);

  const allConfirmed = dealParties.length > 0 && dealParties.every(p => confirmations.some(c => c.party === p));

  // When all parties confirm, update event status to confirmed
  const prevAllConfirmed = useRef(allConfirmed);
  useEffect(() => {
    if (allConfirmed && !prevAllConfirmed.current) {
      onConfirmed?.();
    }
    prevAllConfirmed.current = allConfirmed;
  }, [allConfirmed, onConfirmed]);

  // Determine which parties must confirm themselves (no "confirm on behalf of" allowed)
  const partyMustSelfConfirm = (party: string): boolean => {
    // Performers always confirm themselves — whether connected, invited by email, or just named
    if (party === "Performer") return true;
    if (party === "Venue") {
      if (event.operatorType === "venue") return true; // venue is the host, always on platform
      return collaborators.some(c => c.eventRole === "venue" && (c.profileId || c.email));
    }
    return false;
  };

  // Which parties can the current user self-confirm, and what profile name do they represent?
  const { myConfirmableParties, partyProfileName } = useMemo(() => {
    const parties = new Set<string>();
    const names: Record<string, string> = {};
    const allProfiles = Object.values(profiles);
    const myProfileIds = allProfiles.map(p => p.id).filter(Boolean) as string[];
    // Performer: user owns the performer profile on this event
    if (event.performerProfileId) {
      const myArtistProfiles = allProfiles.filter(p => p.role === "performer" && p.id);
      const match = myArtistProfiles.find(p => p.id === event.performerProfileId);
      if (match) { parties.add("Performer"); names["Performer"] = match.name; }
    }
    // Venue: user owns a venue profile linked as host or as a collaborator
    const myVenueProfiles = allProfiles.filter(p => p.role === "venue" && p.id);
    if (myVenueProfiles.length > 0) {
      if (event.operatorType === "venue" && event.hostProfileId) {
        const match = myVenueProfiles.find(p => p.id === event.hostProfileId);
        if (match) { parties.add("Venue"); names["Venue"] = match.name; }
      }
      const venueCollab = collaborators.find(c => c.eventRole === "venue" && c.profileId && myVenueProfiles.some(p => p.id === c.profileId));
      if (venueCollab) {
        const match = myVenueProfiles.find(p => p.id === venueCollab.profileId);
        if (match) { parties.add("Venue"); names["Venue"] = names["Venue"] || match.name; }
      }
    }
    // Host (Promoter/Organizer): user owns the host profile
    if (event.hostProfileId && myProfileIds.includes(event.hostProfileId)) {
      const hostParty = event.operatorType === "venue" ? "Venue" : event.operatorType === "organizer" ? "Organizer" : "Promoter";
      const match = allProfiles.find(p => p.id === event.hostProfileId);
      parties.add(hostParty);
      if (match) names[hostParty] = names[hostParty] || match.name;
    }
    return { myConfirmableParties: parties, partyProfileName: names };
  }, [event, profiles, collaborators]);

  const [savedTerms, setSavedTerms] = useState(terms);

  // Helper: reset all confirmations and log to change log
  const resetAllApprovals = (reason: string) => {
    const now = new Date().toISOString();
    metaDirty.current = true;
    setConfirmations([]);
    setLastChangedAt(now);
    const u = getAuthClient().currentUser;
    const by = u?.displayName || u?.email || "Unknown";
    appendEventActivity(event.id, "approvals_reset", by, { reason }, undefined, actingProfile);
    toast({ title: "Deal terms changed — all approvals have been reset" });
  };

  // Detect external deal prop changes (e.g. deal structure edited in another tab)
  const prevDealRef = useRef(deal);
  useEffect(() => {
    const prev = prevDealRef.current;
    prevDealRef.current = deal;
    // Skip first render and null/undefined transitions
    if (!prev || !deal) return;
    // Shallow compare key deal fields
    const changed =
      prev.dealType !== deal.dealType ||
      prev.artistGuarantee !== deal.artistGuarantee ||
      prev.venueRental !== deal.venueRental ||
      prev.artistSplit !== deal.artistSplit ||
      prev.promoterSplit !== deal.promoterSplit ||
      prev.venueSplit !== deal.venueSplit ||
      prev.organizerSplit !== deal.organizerSplit ||
      prev.promoterCostSplit !== deal.promoterCostSplit ||
      prev.venueCostSplit !== deal.venueCostSplit ||
      prev.artistCostSplit !== deal.artistCostSplit ||
      prev.organizerCostSplit !== deal.organizerCostSplit ||
      JSON.stringify(prev.commissions) !== JSON.stringify(deal.commissions);
    if (changed && confirmations.length > 0) {
      resetAllApprovals("Deal structure changed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to deal prop changes
  }, [deal]);

  // Track changes to agreements — reset confirmations if any party has confirmed
  const handleAgreementChange = (newAgreements: Agreement[]) => {
    if (confirmations.length > 0) {
      resetAllApprovals("Agreement documents changed");
    } else {
      const now = new Date().toISOString();
      metaDirty.current = true;
      setLastChangedAt(now);
    }
    setAgreements(newAgreements);
  };

  const handleTermsSave = () => {
    if (terms === savedTerms) return;
    if (confirmations.length > 0) {
      resetAllApprovals("Terms and conditions updated");
    } else {
      const now = new Date().toISOString();
      metaDirty.current = true;
      setLastChangedAt(now);
    }
    setSavedTerms(terms);
  };

  // Re-open a fully approved agreement for editing
  const handleReopen = () => {
    const now = new Date().toISOString();
    metaDirty.current = true;
    setConfirmations([]);
    setLastChangedAt(now);
    const u = getAuthClient().currentUser;
    const by = u?.displayName || u?.email || "Unknown";
    appendEventActivity(event.id, "approvals_reset", by, { reason: "Agreement re-opened for editing" }, undefined, actingProfile);
    toast({ title: "Agreement re-opened for editing" });
  };

  // agreements now synced via subcollection; only persist confirmation metadata via eventMeta
  // Only save when a user-driven change occurs (not on mount or query sync).
  const metaDirty = useRef(false);
  useEffect(() => {
    if (!metaDirty.current) return;
    metaDirty.current = false;
    onSave?.({ dealDescription: terms, agreementConfirmations: confirmations, agreementLastChangedAt: lastChangedAt });
  }, [terms, confirmations, lastChangedAt]);

  const handleConfirm = async (party: string, method: "manual" | "self" = "manual") => {
    const now = new Date().toISOString();
    const confirmedBy = currentUser?.name || "Event Operator";
    const signature = await generateSignatureHash(party, now, confirmedBy);
    metaDirty.current = true;
    setConfirmations(prev => {
      const filtered = prev.filter(c => c.party !== party);
      return [...filtered, { party, confirmedAt: now, confirmedBy, method, signature }];
    });

    // Log activity
    const profileName = partyProfileName[party] || party;
    appendEventActivity(event.id, "agreement_confirmed", confirmedBy, {
      party,
      profileName,
      method,
    }, undefined, actingProfile);
  };

  const handleAddAgreement = () => {
    if (!newAg.name.trim()) return;
    const updated: Agreement[] = [...agreements, { id: `AG-${Date.now()}`, name: newAg.name, type: newAg.type, status: "draft" as const }];
    handleAgreementChange(updated);
    setNewAg({ name: "", type: "custom" });
    setAddOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Event Summary</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Event:</span> <span className="font-medium ml-2">{event.name}</span></div>
          <div><span className="text-muted-foreground">Date:</span> <span className="font-medium ml-2">{event.date}</span></div>
          <div><span className="text-muted-foreground">Performer:</span> <span className="font-medium ml-2"><ProfilePreviewPopover name={event.artist} profileId={event.performerProfileId} /></span></div>
          <div><span className="text-muted-foreground">Venue:</span> <span className="font-medium ml-2"><ProfilePreviewPopover name={event.venue} /></span></div>
          {event.capacity > 0 && <div><span className="text-muted-foreground">Capacity:</span> <span className="font-medium ml-2">{event.capacity.toLocaleString()}</span></div>}
          {event.operator && <div><span className="text-muted-foreground">Operator:</span> <span className="font-medium ml-2">{event.operator}</span></div>}
          {event.ticketingProvider && <div><span className="text-muted-foreground">Ticketing:</span> <span className="font-medium ml-2">{event.ticketingProvider}</span></div>}
          {event.eventStatus && <div><span className="text-muted-foreground">Status:</span> <span className="font-medium ml-2 capitalize">{event.eventStatus.replace(/_/g, " ")}</span></div>}
        </div>

        {/* Deal Structure */}
        {deal && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Deal Structure</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Deal Type:</span> <span className="font-medium ml-2 capitalize">{deal.dealType.replace(/_/g, " ")}</span></div>
              {deal.artistGuarantee > 0 && <div><span className="text-muted-foreground">Performer Guarantee:</span> <span className="font-medium ml-2">{formatCurrency(deal.artistGuarantee, currency)}</span></div>}
              {deal.venueRental > 0 && <div><span className="text-muted-foreground">Venue Rental:</span> <span className="font-medium ml-2">{formatCurrency(deal.venueRental, currency)}</span></div>}
              {deal.dealType !== "guarantee" && deal.dealType !== "rental" && (deal.artistSplit > 0 || deal.promoterSplit > 0 || deal.venueSplit > 0) && (
                <div className="col-span-2"><span className="text-muted-foreground">Revenue Split:</span> <span className="font-medium ml-2">Performer {deal.artistSplit}% / Promoter {deal.promoterSplit}% / Venue {deal.venueSplit}%{(deal.organizerSplit || 0) > 0 ? ` / Organizer ${deal.organizerSplit}%` : ""}</span></div>
              )}
              {(deal.promoterCostSplit > 0 || deal.venueCostSplit > 0 || (deal.organizerCostSplit || 0) > 0) && (
                <div className="col-span-2"><span className="text-muted-foreground">Cost Split:</span> <span className="font-medium ml-2">{(deal.artistCostSplit || 0) > 0 ? `Performer ${deal.artistCostSplit}% / ` : ""}Promoter {deal.promoterCostSplit}% / Venue {deal.venueCostSplit}%{(deal.organizerCostSplit || 0) > 0 ? ` / Organizer ${deal.organizerCostSplit}%` : ""}</span></div>
              )}
              {deal.commissions?.length > 0 && deal.commissions.map((c: CommissionParty) => (
                <div key={c.key}><span className="text-muted-foreground">{c.label}:</span> <span className="font-medium ml-2">{c.name} ({c.percentage}%)</span></div>
              ))}
            </div>
          </div>
        )}

        {/* Ticket Types */}
        {revenue?.ticketTypes?.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Ticket Types</h4>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/30 border-b"><th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">Type</th><th className="px-3 py-1.5 text-right text-xs font-semibold text-muted-foreground">Price</th><th className="px-3 py-1.5 text-right text-xs font-semibold text-muted-foreground">Expected</th></tr></thead>
                <tbody className="divide-y">
                  {revenue.ticketTypes.map((tt: TicketType) => (
                    <tr key={tt.name}><td className="px-3 py-1.5">{tt.name}</td><td className="px-3 py-1.5 text-right">{formatCurrency(tt.price, currency)}</td><td className="px-3 py-1.5 text-right">{tt.sold.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Schedule */}
        {previewSchedule.length > 0 && previewSchedule.some((s) => s.time) && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Production Schedule</h4>
            <div className="space-y-1 text-sm">
              {previewSchedule.filter((s) => s.time).map((s) => (
                <div key={s.id} className="flex gap-3"><span className="text-muted-foreground w-14">{s.time}</span><span className="font-medium">{s.label}</span></div>
              ))}
            </div>
          </div>
        )}

        {/* Riders */}
        {previewRiders.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Riders</h4>
            <div className="space-y-1 text-sm">
              {previewRiders.map((r) => (
                <div key={r.id} className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{riderTypeLabels[r.type as RiderType] || r.type}</Badge><span>{r.name}</span></div>
              ))}
            </div>
          </div>
        )}

        {/* Amenities */}
        {eventMeta.amenities?.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-semibold mb-2">Amenities</h4>
            <div className="flex flex-wrap gap-1.5">
              {eventMeta.amenities.map((a: AmenityKey) => (
                <Badge key={a} variant="secondary" className="text-xs">{amenityLabels[a] || a}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold">Agreements & Documents</h3>
          {!readOnly && !allConfirmed && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Document
            </Button>
          )}
        </div>
        {agreements.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No agreements uploaded yet.</p>
        ) : (
          <div className="space-y-3">
            {agreements.map((ag, i) => (
              <div key={ag.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{ag.name}</p>
                    <p className="text-xs text-muted-foreground">{agreementTypeLabels[ag.type]}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ag.fileName ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { if (ag.fileUrl && ag.fileName) setPreviewDoc({ fileName: ag.fileName, fileUrl: ag.fileUrl }); }}>
                      <Download className="h-3 w-3" /> {ag.fileName}
                    </Button>
                  ) : !readOnly && !allConfirmed ? (
                    <FileUploadButton onFile={(name, url) => {
                      const updated = [...agreements];
                      updated[i] = { ...updated[i], fileName: name, fileUrl: url };
                      handleAgreementChange(updated);
                    }} />
                  ) : null}
                  <Badge variant="outline" className={cn("text-xs",
                    ag.status === "signed" && "text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]",
                    ag.status === "sent" && "text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]",
                    ag.status === "draft" && "text-muted-foreground"
                  )}>
                    {ag.status === "signed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {ag.status.charAt(0).toUpperCase() + ag.status.slice(1)}
                  </Badge>
                  {!readOnly && !allConfirmed && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteIndex(i)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-4">Terms & Conditions</h3>
        {readOnly || allConfirmed ? (
          terms ? (
            <p className="text-sm whitespace-pre-wrap">{terms}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No terms and conditions specified.</p>
          )
        ) : (
          <>
            <Textarea placeholder="Add terms and conditions..." className="min-h-[200px] text-sm" value={terms} onChange={(e) => setTerms(e.target.value)} />
            <div className="mt-3 flex justify-end">
              <Button variant="outline" size="sm" disabled={terms === savedTerms} onClick={handleTermsSave}>Save Terms</Button>
            </div>
          </>
        )}
      </div>

      {/* Agreement Confirmation Card */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold">Agreement Confirmation</h3>
          <span className="text-xs text-muted-foreground">
            Last modified: {new Date(lastChangedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {allConfirmed && (
          <div className="rounded-lg bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.2)] p-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[hsl(var(--success))]" />
              <span className="text-sm font-medium text-[hsl(var(--success))]">All parties have confirmed the agreement</span>
            </div>
            {!readOnly && (
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleReopen}>
                <LockOpen className="h-3.5 w-3.5" /> Request to Re-open
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-4">Parties on the platform must confirm themselves. You can confirm on behalf of parties not yet invited.</p>

        <div className="space-y-3">
          {dealParties.map(party => {
            const confirmation = confirmations.find(c => c.party === party);
            return (
              <div key={party} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold",
                    confirmation ? "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]" : "bg-muted text-muted-foreground"
                  )}>
                    {confirmation ? <Check className="h-4 w-4" /> : party.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{party}</p>
                    {confirmation ? (
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0",
                            confirmation.method === "self"
                              ? "text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]"
                              : "text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]"
                          )}>
                            {confirmation.method === "self" ? "Approved" : "Manual"}
                          </Badge>
                          <span className="text-xs text-[hsl(var(--success))]">
                            {confirmation.method === "manual"
                              ? `Confirmed manually by ${confirmation.confirmedBy}`
                              : `Confirmed by ${confirmation.confirmedBy}`}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(confirmation.confirmedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {confirmation.signature && <span className="ml-2 font-mono" title={`Signature: ${confirmation.signature}`}>ID: {confirmation.signature.slice(0, 8)}…</span>}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not yet confirmed</p>
                    )}
                  </div>
                </div>
                {!confirmation && (
                  myConfirmableParties.has(party) ? (
                    <Button size="sm" className="gap-1.5" onClick={() => setSelfConfirmParty(party)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
                    </Button>
                  ) : readOnly || partyMustSelfConfirm(party) ? (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Awaiting their confirmation</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleConfirm(party)}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Confirm on behalf of {party}
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Agreement / Document</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Document Name</Label><Input value={newAg.name} onChange={(e) => setNewAg(p => ({...p, name: e.target.value}))} placeholder="e.g. Performance Agreement" className="mt-1" /></div>
            <div><Label>Type</Label>
              <Select value={newAg.type} onValueChange={(v) => setNewAg(p => ({...p, type: v as AgreementType}))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(agreementTypeLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAgreement} disabled={!newAg.name.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => { if (!open) setDeleteIndex(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteIndex !== null ? agreements[deleteIndex]?.name : ""}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (deleteIndex !== null) {
                handleAgreementChange(agreements.filter((_, j) => j !== deleteIndex));
                setDeleteIndex(null);
              }
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!selfConfirmParty} onOpenChange={(open) => { if (!open) setSelfConfirmParty(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm agreement as {selfConfirmParty}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  By confirming, you acknowledge that you have reviewed the agreement terms, documents, and deal structure. This confirmation will be recorded on behalf of {selfConfirmParty ? (partyProfileName[selfConfirmParty] || selfConfirmParty) : ""}.
                </p>
                <p>
                  You confirm that you have the authority to approve on behalf of <span className="font-medium text-foreground">{selfConfirmParty ? (partyProfileName[selfConfirmParty] || selfConfirmParty) : ""}</span>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (selfConfirmParty) handleConfirm(selfConfirmParty, "self");
              setSelfConfirmParty(null);
            }}>
              Confirm Agreement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DocumentPreviewDialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)} fileName={previewDoc?.fileName} fileUrl={previewDoc?.fileUrl} />
    </div>
  );
}
