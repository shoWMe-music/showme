import { format } from "date-fns";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { upsertRider, fetchProfileOwnerUid, searchArtistProfiles, createUnacquiredProfile } from "@/lib/db";
import { toast } from "@/hooks/use-toast";
import { useUser, type OperatorRole } from "@/lib/user-context";
import { isOwnProfileName, contactExists } from "@/lib/contacts";
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
import type { SharedProfile } from "@/lib/user-context";
import type { PartyState, PerformerEntry, PrefillData } from "./types";

/**
 * Decide whether to actually invite (notify) the attached collaborators for an
 * event being created.
 *
 * Per spec (C1): adding an existing-role collaborator should NOT auto-invite.
 * The user must explicitly opt in. Until they do, the event lives as a draft
 * with collaborator profile IDs attached but their owner UIDs not added to
 * `accessUids` (so the performer/venue doesn't see it on their dashboard yet).
 */
function shouldInviteCollaborators(
  inviteCollaborators: boolean | undefined,
  defaultStatus: string | undefined,
): boolean {
  if (inviteCollaborators === true) return true;
  if (inviteCollaborators === false) return false;
  // Undefined → preserve legacy behavior for non-draft creates so the existing
  // "create from booking request" / "create on hold" flows keep working,
  // but draft creates default to no-invite per spec.
  return defaultStatus !== "draft";
}

/**
 * Resolve the host profile ID strictly by the selected role.
 * Only accepts a profile when its stored `role` matches `selectedRole` —
 * this prevents picking up an unrelated profile (e.g. a venue operator who
 * also owns a performer profile) when the slot key happens to collide.
 */
export function resolveHostProfileId(
  profiles: Record<string, SharedProfile>,
  selectedRole: OperatorRole | null,
): string | undefined {
  if (!selectedRole) return undefined;
  const candidate = profiles[selectedRole];
  if (candidate?.created && candidate.role === selectedRole) return candidate.id;
  // Fallback: find the first created profile whose role matches.
  const fallback = Object.values(profiles).find(
    (p) => p.created && p.role === selectedRole,
  );
  return fallback?.id;
}

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
  /**
   * Whether to invite the attached collaborators (add their owner UIDs to
   * accessUids so they can see the event on their dashboards). When false
   * or undefined-with-draft-status, the event saves with collaborators
   * attached but no invite issued — see shouldInviteCollaborators().
   */
  inviteCollaborators?: boolean;
}

export function useCreateEventSubmit() {
  const navigate = useNavigate();
  const { currentUser, profiles } = useUser();
  const { resolveHoldRankConflicts } = useHoldRankMutations();
  const addEventMutation = useAddEvent();
  const addMultiPerformerEventMutation = useAddMultiPerformerEvent();
  const existingContacts = useContacts();
  const addContactMutation = useAddContact();

  const upsertRidersMutation = useMutation({
    mutationFn: ({ eventId, riders }: { eventId: string; riders: Parameters<typeof upsertRider>[1][] }) =>
      Promise.all(riders.map(r => upsertRider(eventId, r))),
  });

  const ensureContact = (name: string, type: ContactType) => {
    if (!name.trim()) return;
    // Skip if the name matches the current user's own display name
    if (currentUser.name && name.trim().toLowerCase() === currentUser.name.trim().toLowerCase()) return;
    // Skip if the name matches ANY of the user's own profile names — contacts are external only.
    // Filter out empty/missing names so an unnamed profile slot doesn't break the check.
    const ownProfileNames = Object.values(profiles)
      .map(p => p?.name)
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    if (isOwnProfileName(name, ownProfileNames)) return;
    if (contactExists(existingContacts, name, type)) return;
    addContactMutation.mutate({ contact: { id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), type, contacts: [], iban: "", bankName: "", vatId: "", address: "", notes: "" } });
  };

  const handleSubmit = async (params: SubmitParams) => {
    const {
      selectedRole, eventName, date, venueName, artistName, performerProfileId, capacity,
      ticketingProvider, roomStage, holdRank, defaultStatus,
      isMultiPerformer, multiVenueType, festivalName, performers,
      promoterCostSplit, venueCostSplit, venueRental, venueRentalPaymentMode,
      dealType, artistGuarantee, artistSplit, promoterSplit, venueSplit, artistCostSplit,
      parties, prefillData, onEventCreated, setOpen, resetForm,
      inviteCollaborators,
    } = params;
    const willInvite = shouldInviteCollaborators(inviteCollaborators, defaultStatus);

    const operatorType = selectedRole === "venue" ? "venue" as const : selectedRole === "organizer" ? "organizer" as const : "promoter" as const;
    const hostProfileId = resolveHostProfileId(profiles, selectedRole);
    const accessUids = currentUser.id ? [currentUser.id] : [];
    const resolvedVenue = isMultiPerformer && multiVenueType === "festival" ? festivalName : venueName;
    const partyTypeMap: Record<string, ContactType> = { bookerAgent: "agent", promoter: "promoter", management: "manager" };

    if (resolvedVenue) ensureContact(resolvedVenue, "venue");
    if (ticketingProvider) ensureContact(ticketingProvider, "ticketing");
    parties.forEach(p => { if (p.name.trim()) ensureContact(p.name, partyTypeMap[p.key] || "agent"); });

    const commissions = parties.map(p => ({ key: p.key, label: p.label, name: p.name, percentage: parseFloat(p.percentage) || 0 }));

    if (isMultiPerformer && performers.length > 0) {
      const parentId = `EVT-${String(Date.now()).slice(-6)}`;

      // Resolve all performer profiles — look up by name if not captured from
      // dropdown. If still no match, create an un-acquired placeholder profile
      // (C2) so the event has a profile-shaped target the performer can later
      // claim when they sign up.
      const resolvedPerformers = await Promise.all(performers.map(async (perf) => {
        let next = perf;
        const trimmedName = perf.artistName.trim();
        if (!perf.performerProfileId && trimmedName) {
          try {
            const { profiles: matches } = await searchArtistProfiles(trimmedName, 1, null);
            const exact = matches.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
            if (exact) {
              next = { ...perf, performerProfileId: exact.id };
            } else {
              try {
                const placeholderId = await createUnacquiredProfile({ name: trimmedName, role: "performer" });
                next = { ...perf, performerProfileId: placeholderId };
              } catch { /* non-critical — event still saves with name only */ }
            }
          } catch { /* non-critical */ }
        }
        // Guard: a performer profile must never equal the host profile ID.
        if (next.performerProfileId && next.performerProfileId === hostProfileId) {
          next = { ...next, performerProfileId: "" };
        }
        return next;
      }));

      const allPerformerProfileIds = resolvedPerformers.map(p => p.performerProfileId).filter(Boolean);
      const multiAccessProfileIds = [hostProfileId, ...allPerformerProfileIds].filter(Boolean) as string[];
      const multiAccessUids = [...accessUids];
      // C1 — only push performer owner UIDs into accessUids when the user
      // opted in to inviting. Otherwise the event stays a draft with
      // collaborators attached via accessProfileIds but invisible to the
      // performer's dashboard until "Suggest to performer" is clicked.
      if (willInvite) {
        for (const pid of allPerformerProfileIds) {
          try {
            const ownerUid = await fetchProfileOwnerUid(pid);
            if (ownerUid && !multiAccessUids.includes(ownerUid)) multiAccessUids.push(ownerUid);
          } catch { /* non-critical */ }
        }
      }

      const childEvents = resolvedPerformers.map((perf, i) => {
        const childId = `${parentId}-P${i + 1}`;
        ensureContact(perf.artistName, "performer");
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
            performerRoleTag: perf.performerRoleTag || undefined,
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

      // Autofill riders from performer/venue profiles for each child event
      const docTypeToRiderType: Record<string, "technical" | "hospitality" | "custom"> = {
        tech_rider: "technical", hospitality_rider: "hospitality", other: "custom",
      };
      for (const child of childEvents) {
        const childRiders: Rider[] = [];
        for (const key of Object.keys(profiles)) {
          const profile = profiles[key];
          if (!profile?.documents || profile.documents.length === 0) continue;
          const isChildPerformer = (key === "performer" || key.startsWith("performer-")) && profile.name === child.event.artist;
          const isVenue = (key === "venue" || key.startsWith("venue-")) && profile.name === resolvedVenue;
          if (isChildPerformer || isVenue) {
            for (const doc of profile.documents) {
              childRiders.push({ id: `R-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: doc.name, type: docTypeToRiderType[doc.type] || "custom", description: `From ${profile.name} profile`, fileUrl: doc.url, fileName: doc.name });
            }
          }
        }
        if (childRiders.length > 0) await upsertRidersMutation.mutateAsync({ eventId: child.event.id, riders: childRiders });
      }

      onEventCreated?.(parentId);
      setOpen(false); resetForm();
      if (!onEventCreated) navigate({ to: "/events/$id", params: { id: parentId } });
    } else {
      const id = `EVT-${String(Date.now()).slice(-6)}`;
      ensureContact(artistName, "performer");

      // Resolve performer profile — look up by name if not captured from the
      // dropdown. If still no match, create an un-acquired placeholder profile
      // (C2) so the event has a profile-shaped target the performer can later
      // claim when they sign up.
      let resolvedPerformerProfileId = performerProfileId;
      const trimmedArtist = artistName.trim();
      if (!resolvedPerformerProfileId && trimmedArtist) {
        try {
          const { profiles: matches } = await searchArtistProfiles(trimmedArtist, 1, null);
          const exact = matches.find(p => p.name.toLowerCase() === trimmedArtist.toLowerCase());
          if (exact) {
            resolvedPerformerProfileId = exact.id;
          } else {
            try {
              resolvedPerformerProfileId = await createUnacquiredProfile({ name: trimmedArtist, role: "performer" });
            } catch { /* non-critical — event still saves with name only */ }
          }
        } catch { /* non-critical */ }
      }
      // Guard: never let the performer profile ID equal the host profile ID.
      // This protects against profile-keying mix-ups when the operator has
      // multiple profile types (e.g. venue + performer on the same account).
      if (resolvedPerformerProfileId && resolvedPerformerProfileId === hostProfileId) {
        resolvedPerformerProfileId = "";
      }

      const accessProfileIds = [hostProfileId, resolvedPerformerProfileId].filter(Boolean) as string[];
      const finalAccessUids = [...accessUids];
      // C1 — only push performer owner UID into accessUids when the user opted
      // in to inviting. Otherwise the event stays a draft with the performer
      // attached via accessProfileIds but not pushed to their dashboard.
      if (willInvite && resolvedPerformerProfileId) {
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
          organizerSplit: params.organizerSplit ?? 0,
          artistCostSplit: parseFloat(artistCostSplit) || 0,
          promoterCostSplit: parseFloat(promoterCostSplit) || 0,
          venueCostSplit: parseFloat(venueCostSplit) || 0,
          organizerCostSplit: params.organizerCostSplit ?? 0,
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
          const isRelevantArtist = (key === "performer" || key.startsWith("performer-")) && profile.name === artistName;
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

      onEventCreated?.(id);
      setOpen(false); resetForm();
      if (!onEventCreated) navigate({ to: "/events/$id", params: { id } });
    }
  };

  return { handleSubmit };
}
