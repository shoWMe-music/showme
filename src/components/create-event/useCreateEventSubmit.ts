import { format } from "date-fns";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { insertCollaboratorInvite, upsertRider, fetchProfileOwnerUid, searchArtistProfiles } from "@/lib/db";
import { buildProfileDocId } from "@/lib/profiles";
import { toast } from "@/hooks/use-toast";
import { useUser, type OperatorRole } from "@/lib/user-context";
import {
  useAddEvent,
  useAddMultiPerformerEvent,
  useHoldRankMutations,
} from "@/lib/queries/useEventMutations";
import {
  useContacts,
  useAddContact,
} from "@/lib/queries";
import type { DealType, ContactType, Rider, Event } from "@/lib/models";
import type { PartyState, PerformerEntry, PrefillData } from "./types";

interface SubmitParams {
  selectedRole: OperatorRole | null;
  eventName: string;
  date: Date | undefined;
  venueName: string;
  artistName: string;
  performerProfileId: string;
  capacity: string;
  ticketingProvider: string;
  roomStage: string;
  holdRank: number;
  defaultStatus?: string;
  isMultiPerformer: boolean;
  multiVenueType: "festival" | "venue" | null;
  festivalName: string;
  performers: PerformerEntry[];
  promoterCostSplit: string;
  venueCostSplit: string;
  venueRental: string;
  venueRentalPaymentMode: "request_now" | "deduct_at_settlement";
  dealType: DealType;
  artistGuarantee: string;
  artistSplit: string;
  promoterSplit: string;
  venueSplit: string;
  artistCostSplit: string;
  organizerSplit?: number;
  organizerCostSplit?: number;
  parties: PartyState[];
  prefillData?: PrefillData;
  onEventCreated?: (eventId: string) => void;
  setOpen: (v: boolean) => void;
  resetForm: () => void;
}

export function useCreateEventSubmit() {
  const navigate = useNavigate();
  const { currentUser, profiles } = useUser();
  const { resolveHoldRankConflicts } = useHoldRankMutations();
  const addEventMutation = useAddEvent();
  const addMultiPerformerEventMutation = useAddMultiPerformerEvent();
  const existingContacts = useContacts();
  const addContactMutation = useAddContact();

  const inviteMutation = useMutation({
    mutationFn: (data: Parameters<typeof insertCollaboratorInvite>[0]) => insertCollaboratorInvite(data),
    onSuccess: (_data, variables) => {
      toast({ title: "Collaborator invite sent", description: `${variables.email} was invited as a viewer.` });
    },
    onError: () => {
      toast({ title: "Invite failed", description: "Could not save collaborator invite.", variant: "destructive" });
    },
  });

  const upsertRidersMutation = useMutation({
    mutationFn: ({ eventId, riders }: { eventId: string; riders: Parameters<typeof upsertRider>[1][] }) =>
      Promise.all(riders.map(r => upsertRider(eventId, r))),
  });

  const ensureContact = (name: string, type: ContactType) => {
    if (!name.trim()) return;
    const exists = existingContacts.some(c => c.name.toLowerCase() === name.toLowerCase() && c.type === type);
    if (!exists) {
      addContactMutation.mutate({ contact: { id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), type, contacts: [], iban: "", bankName: "", vatId: "", address: "", notes: "" } });
    }
  };

  const handleSubmit = async (params: SubmitParams) => {
    const {
      selectedRole, eventName, date, venueName, artistName, performerProfileId, capacity,
      ticketingProvider, roomStage, holdRank, defaultStatus,
      isMultiPerformer, multiVenueType, festivalName, performers,
      promoterCostSplit, venueCostSplit, venueRental, venueRentalPaymentMode,
      dealType, artistGuarantee, artistSplit, promoterSplit, venueSplit, artistCostSplit,
      parties, prefillData, onEventCreated, setOpen, resetForm,
    } = params;

    const operatorType = selectedRole === "venue" ? "venue" as const : selectedRole === "organizer" ? "organizer" as const : "promoter" as const;
    const hostProfileId = selectedRole ? buildProfileDocId(currentUser.id, selectedRole) : undefined;
    const accessUids = currentUser.id ? [currentUser.id] : [];
    const resolvedVenue = isMultiPerformer && multiVenueType === "festival" ? festivalName : venueName;
    const partyTypeMap: Record<string, ContactType> = { bookerAgent: "agent", promoter: "promoter", management: "manager" };

    if (resolvedVenue) ensureContact(resolvedVenue, "venue");
    if (ticketingProvider) ensureContact(ticketingProvider, "ticketing");
    parties.forEach(p => { if (p.name.trim()) ensureContact(p.name, partyTypeMap[p.key] || "agent"); });

    const commissions = parties.map(p => ({ key: p.key, label: p.label, name: p.name, percentage: parseFloat(p.percentage) || 0 }));

    if (isMultiPerformer && performers.length > 0) {
      const parentId = `EVT-${String(Date.now()).slice(-6)}`;

      // Resolve all performer profiles — look up by name if not captured from dropdown
      const resolvedPerformers = await Promise.all(performers.map(async (perf) => {
        if (perf.performerProfileId || !perf.artistName.trim()) return perf;
        try {
          const { profiles: matches } = await searchArtistProfiles(perf.artistName.trim(), 1, null);
          const exact = matches.find(p => p.name.toLowerCase() === perf.artistName.trim().toLowerCase());
          if (exact) return { ...perf, performerProfileId: exact.id };
        } catch { /* non-critical */ }
        return perf;
      }));

      const allPerformerProfileIds = resolvedPerformers.map(p => p.performerProfileId).filter(Boolean);
      const multiAccessProfileIds = [hostProfileId, ...allPerformerProfileIds].filter(Boolean) as string[];
      const multiAccessUids = [...accessUids];
      for (const pid of allPerformerProfileIds) {
        try {
          const ownerUid = await fetchProfileOwnerUid(pid);
          if (ownerUid && !multiAccessUids.includes(ownerUid)) multiAccessUids.push(ownerUid);
        } catch { /* non-critical */ }
      }

      const childEvents = resolvedPerformers.map((perf, i) => {
        const childId = `${parentId}-P${i + 1}`;
        ensureContact(perf.artistName, "artist");
        const isChildSplitDisabled = perf.dealType === "guarantee" || perf.dealType === "rental";
        const childProfileIds = [hostProfileId, perf.performerProfileId].filter(Boolean) as string[];
        return {
          event: {
            id: childId, name: `${eventName} — ${perf.artistName}`,
            date: date ? format(date, "yyyy-MM-dd") : "",
            venue: perf.performerVenue || resolvedVenue, operator: currentUser.name, operatorType,
            ticketingProvider, capacity: parseInt(perf.stageCapacity) || 0,
            artist: perf.artistName, eventStatus: defaultStatus || "draft", status: defaultStatus || "draft",
            parentEventId: parentId, hostProfileId, accessUids: multiAccessUids, accessProfileIds: childProfileIds,
            performerProfileId: perf.performerProfileId || undefined,
            roomStage: (perf.stageRoom && perf.stageRoom !== "__new__") ? perf.stageRoom : undefined,
            stageCapacity: parseInt(perf.stageCapacity) || undefined,
          } as Event,
          deal: {
            eventId: childId, dealType: perf.dealType,
            artistGuarantee: parseFloat(perf.artistGuarantee) || 0,
            artistSplit: isChildSplitDisabled ? 0 : (parseFloat(perf.artistSplit) || 0),
            promoterSplit: isChildSplitDisabled ? 0 : (parseFloat(perf.promoterSplit) || 0),
            venueSplit: isChildSplitDisabled ? 0 : (parseFloat(perf.venueSplit) || 0),
            promoterCostSplit: parseFloat(promoterCostSplit) || 0,
            venueCostSplit: parseFloat(venueCostSplit) || 0,
            venueRental: parseFloat(venueRental) || 0,
            venueRentalPaymentMode: parseFloat(venueRental) > 0 ? venueRentalPaymentMode : "deduct_at_settlement",
            commissions,
          },
        };
      });

      const totalCapacity = performers.reduce((sum, p) => sum + (parseInt(p.stageCapacity) || 0), 0);
      const parentEvent: Event = {
        id: parentId, name: eventName,
        date: date ? format(date, "yyyy-MM-dd") : "",
        venue: resolvedVenue, operator: currentUser.name, operatorType,
        ticketingProvider, capacity: totalCapacity,
        artist: performers.map(p => p.artistName).filter(Boolean).join(", "),
        eventStatus: defaultStatus || "draft", status: defaultStatus || "draft",
        isMultiPerformer: true, childEventIds: childEvents.map(c => c.event.id),
        hostProfileId, accessUids: multiAccessUids, accessProfileIds: multiAccessProfileIds,
        ...(roomStage ? { roomStage } : {}),
      } as Event;

      await addMultiPerformerEventMutation.mutateAsync({ parent: parentEvent, children: childEvents });

      if (prefillData?.contactEmail) {
        const token = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        inviteMutation.mutate({
          event_id: parentId, token, email: prefillData.contactEmail,
          role: "Performer", permission: "view_only",
          message: `You've been invited to view the event "${eventName}"`,
        });
      }

      onEventCreated?.(parentId);
      setOpen(false); resetForm();
      if (!onEventCreated) navigate({ to: "/events/$id", params: { id: parentId } });
    } else {
      const id = `EVT-${String(Date.now()).slice(-6)}`;
      ensureContact(artistName, "artist");

      // Resolve performer profile — look up by name if not captured from the dropdown
      let resolvedPerformerProfileId = performerProfileId;
      if (!resolvedPerformerProfileId && artistName.trim()) {
        try {
          const { profiles: matches } = await searchArtistProfiles(artistName.trim(), 1, null);
          const exact = matches.find(p => p.name.toLowerCase() === artistName.trim().toLowerCase());
          if (exact) resolvedPerformerProfileId = exact.id;
        } catch { /* non-critical */ }
      }

      const accessProfileIds = [hostProfileId, resolvedPerformerProfileId].filter(Boolean) as string[];
      const finalAccessUids = [...accessUids];
      if (resolvedPerformerProfileId) {
        try {
          const ownerUid = await fetchProfileOwnerUid(resolvedPerformerProfileId);
          if (ownerUid && !finalAccessUids.includes(ownerUid)) finalAccessUids.push(ownerUid);
        } catch {
          // non-critical — performer can be added later via collaborator invite
        }
      }

      await addEventMutation.mutateAsync({
        event: {
          id, name: eventName, date: date ? format(date, "yyyy-MM-dd") : "",
          venue: venueName, operator: currentUser.name, operatorType,
          ticketingProvider, capacity: parseInt(capacity) || 0,
          artist: artistName, eventStatus: defaultStatus || "draft", status: defaultStatus || "draft",
          hostProfileId, accessUids: finalAccessUids, accessProfileIds,
          performerProfileId: resolvedPerformerProfileId || undefined,
          ...(defaultStatus === "on_hold" ? { holdRank } : {}),
          ...(roomStage ? { roomStage } : {}),
          ...(prefillData?.sourceRequestId ? { sourceRequestId: prefillData.sourceRequestId } : {}),
          ...(prefillData?.sourceRequestDate ? { sourceRequestDate: prefillData.sourceRequestDate } : {}),
        } as Event,
        deal: {
          eventId: id, dealType,
          artistGuarantee: parseFloat(artistGuarantee) || 0,
          artistSplit: parseFloat(artistSplit) || 0,
          promoterSplit: parseFloat(promoterSplit) || 0,
          venueSplit: parseFloat(venueSplit) || 0,
          organizerSplit: 0,
          artistCostSplit: parseFloat(artistCostSplit) || 0,
          promoterCostSplit: parseFloat(promoterCostSplit) || 0,
          venueCostSplit: parseFloat(venueCostSplit) || 0,
          organizerCostSplit: 0,
          venueRental: parseFloat(venueRental) || 0,
          venueRentalPaymentMode: parseFloat(venueRental) > 0 ? venueRentalPaymentMode : "deduct_at_settlement",
          commissions,
        },
      });

      const profileRiders: Rider[] = [];
      const docTypeToRiderType: Record<string, "technical" | "hospitality" | "custom"> = {
        tech_rider: "technical", hospitality_rider: "hospitality", other: "custom",
      };
      for (const key of Object.keys(profiles)) {
        const profile = profiles[key];
        if (profile?.documents && profile.documents.length > 0) {
          const isRelevantVenue = (key === "venue" || key.startsWith("venue-")) && profile.name === venueName;
          const isRelevantArtist = (key === "artist" || key.startsWith("artist-")) && profile.name === artistName;
          const isSelectedRole = key === selectedRole || key.startsWith(`${selectedRole}-`);
          if (isRelevantVenue || isRelevantArtist || isSelectedRole) {
            for (const doc of profile.documents) {
              profileRiders.push({
                id: `R-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: doc.name, type: docTypeToRiderType[doc.type] || "custom",
                description: `From ${profile.name} profile`, fileUrl: doc.url, fileName: doc.name,
              });
            }
          }
        }
      }
      if (profileRiders.length > 0) await upsertRidersMutation.mutateAsync({ eventId: id, riders: profileRiders });
      if (defaultStatus === "on_hold") {
        resolveHoldRankConflicts(id, date ? format(date, "yyyy-MM-dd") : "", venueName, roomStage || "", holdRank);
      }

      if (prefillData?.contactEmail) {
        const token = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        inviteMutation.mutate({
          event_id: id, token, email: prefillData.contactEmail,
          role: "Performer", permission: "view_only",
          message: `You've been invited to view the event "${eventName}"`,
        });
      }

      onEventCreated?.(id);
      setOpen(false); resetForm();
      if (!onEventCreated) navigate({ to: "/events/$id", params: { id } });
    }
  };

  return { handleSubmit };
}
