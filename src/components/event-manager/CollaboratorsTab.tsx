import { useMemo, useState } from "react";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { deleteDoc, doc, getDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove } from "firebase/firestore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type Event as AppEvent,
  type EventCollaborator,
  type EventCollaboratorRole,
  type CollaboratorPermission,
  DEFAULT_COLLABORATOR_PERMISSION,
  eventCollaboratorRoleLabels,
  collaboratorPermissionLabels,
  collaboratorIsActive,
} from "@/lib/models";
import { formatLocation, getPrimaryLocation, type SharedProfile } from "@/lib/user-context";
import { Users, Link as LinkIcon, Mail, Clock, Check, X, Shield, Copy, XCircle } from "lucide-react";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";
import { useMyInvitationCodes, useRevokeInvitationCode } from "@/lib/queries/useInvitationCodes";
import { toast, copyToast } from "@/hooks/use-toast";
import { useChildEvents } from "@/lib/queries";
import { getFirestoreDb } from "@/integrations/firebase/app";
import { useProfilePlan, isPaidPlan } from "@/lib/plans";

const statusConfig: Record<string, { label: string; color: string; icon: typeof Check }> = {
  active: { label: "Connected", color: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400", icon: Check },
  accepted: { label: "Connected", color: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400", icon: Check },
  pending: { label: "Invite pending", color: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400", icon: Clock },
  invited: { label: "Invite pending", color: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400", icon: Clock },
  declined: { label: "Declined", color: "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-400", icon: X },
  revoked: { label: "Revoked", color: "border-muted-foreground/30 bg-muted text-muted-foreground", icon: X },
};

interface CollaboratorsTabProps {
  event: AppEvent;
  collaborators: EventCollaborator[];
  profiles: Record<string, SharedProfile>;
  onRefresh?: () => void;
  /** When true, render permission editors and allow changing tiers inline. */
  canManagePermissions?: boolean;
}

const permissionBadgeStyles: Record<CollaboratorPermission, string> = {
  admin: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  editor: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
  view_only: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

export function CollaboratorsTab({ event, collaborators, profiles, onRefresh, canManagePermissions }: CollaboratorsTabProps) {
  const { data: invitationCodes } = useMyInvitationCodes();
  const revokeMutation = useRevokeInvitationCode();
  const childEvents = useChildEvents(event.id);
  // Disable both selects belonging to a row while its update is in flight, so
  // a fast second click on the same row doesn't fire a duplicate write before
  // the cache refresh lands.
  const [pendingPermissionWrite, setPendingPermissionWrite] = useState<string | null>(null);

  // Permission management (granting "admin" tier) is a Pro-only feature
  // (PDF Gate 3: "Admin and team management on Pro"). Free hosts can still
  // toggle between view_only and editor for collaborators on their events.
  const { plan: hostPlan } = useProfilePlan(event.hostProfileId ?? null);
  const canGrantAdminTier = !!hostPlan && isPaidPlan(hostPlan.type);

  /**
   * Update a collaborator's permission tier. Writes both the collaborator
   * subdoc and maintains the denormalized event.editorUids array (the field
   * Firestore rules consult for edit gating). Only invoked when the caller is
   * an admin — the rules layer is the real backstop.
   */
  const updatePermission = async (c: EventCollaborator, next: CollaboratorPermission) => {
    const current = c.permission ?? DEFAULT_COLLABORATOR_PERMISSION;
    if (next === current) return;
    if (c.id.startsWith("child-performer-") || c.id.startsWith("single-performer-")) {
      // Synthesized rows (from child event performerProfileId) have no real
      // collaborator doc — their permission lives on the child event itself.
      toast({ title: "Cannot change", description: "This collaborator is auto-derived from a performer slot.", variant: "destructive" });
      return;
    }
    setPendingPermissionWrite(c.id);
    try {
      const db = getFirestoreDb();
      await updateDoc(doc(db, "events", event.id, "collaborators", c.id), {
        permission: next,
        updatedAt: serverTimestamp(),
      });
      // Maintain the denormalized editorUids array on the event so Firestore
      // rules see the new tier on the next subcollection write.
      //
      // First-population bootstrap: legacy events have no editorUids field;
      // the rule fallback grants edits to anyone in accessUids while the
      // field is absent. The moment we create editorUids — even with just one
      // entry — every other accessUids member would lose write access. So if
      // we're populating for the first time, we seed from accessUids so
      // existing collaborators keep their edits.
      if (c.userUid) {
        const eventRef = doc(db, "events", event.id);
        const snap = await getDoc(eventRef);
        const data = snap.data() ?? {};
        const accessUids: string[] = Array.isArray(data.accessUids) ? data.accessUids : [];
        const hasEditorUids = Array.isArray(data.editorUids);
        const hasAdminUids = Array.isArray(data.adminUids);
        const eventUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };

        // editorUids — gates non-financial edit writes via Firestore rules.
        if (next === "view_only") {
          if (hasEditorUids) {
            eventUpdates.editorUids = arrayRemove(c.userUid);
          } else {
            // Field doesn't exist — bootstrap with current accessUids minus
            // this collaborator. Pre-existing legacy editors stay; this one
            // drops out.
            eventUpdates.editorUids = Array.from(new Set(accessUids.filter((u) => u !== c.userUid)));
          }
        } else if (hasEditorUids) {
          eventUpdates.editorUids = arrayUnion(c.userUid);
        } else {
          eventUpdates.editorUids = Array.from(new Set([...accessUids, c.userUid]));
        }

        // adminUids — gates collaborator-management writes. Host members are
        // implicit; this array only tracks non-host collab-admins, so we
        // never bootstrap from accessUids here.
        if (next === "admin") {
          eventUpdates.adminUids = hasAdminUids ? arrayUnion(c.userUid) : [c.userUid];
        } else if (hasAdminUids) {
          // Demoting from admin (or moving to view_only) — drop from the array.
          eventUpdates.adminUids = arrayRemove(c.userUid);
        }

        await updateDoc(eventRef, eventUpdates);
      }
      onRefresh?.();
      toast({ title: "Permission updated", description: `${c.name} is now ${collaboratorPermissionLabels[next]}.` });
    } catch (err) {
      console.error("Failed to update collaborator permission:", err);
      toast({ title: "Could not update permission", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setPendingPermissionWrite(null);
    }
  };

  // Revoking an invitation code alone leaves the EventCollaborator + stub
  // profile docs in place, which made the row stick around in the UI. Pair the
  // revoke with a delete of those paired docs so the row disappears.
  // Note: collaboratorInvites/{token} has no client delete rule (only update),
  // so we leave it — it's not what drives the list.
  const revokeAndCleanup = async (codeStr: string, collaboratorToken: string, stubProfileId?: string | null) => {
    try {
      await revokeMutation.mutateAsync(codeStr);
      const db = getFirestoreDb();
      await deleteDoc(doc(db, "events", event.id, "collaborators", collaboratorToken));
      if (stubProfileId) {
        // Best-effort: stub profile delete may fail if it was already claimed
        // (claimInvitationCode deletes the stub on transfer), so swallow errors.
        try { await deleteDoc(doc(db, "profiles", stubProfileId)); } catch { /* ignore */ }
      }
      onRefresh?.();
    } catch (err) {
      console.error("Failed to revoke and cleanup invitation:", err);
      toast({ title: "Failed to revoke invitation", variant: "destructive" });
    }
  };

  // Build a map from profileId → profile for quick lookup
  const profileById = useMemo(() => {
    const map = new Map<string, SharedProfile>();
    for (const p of Object.values(profiles)) {
      if (p.id) map.set(p.id, p);
    }
    return map;
  }, [profiles]);

  // Host profile info
  const hostProfile = event.hostProfileId ? profileById.get(event.hostProfileId) : undefined;

  // Synthesize performer collaborator entries from child events
  const performerCollaborators = useMemo<EventCollaborator[]>(() => {
    if (!event.isMultiPerformer || childEvents.length === 0) return [];
    const existingPerformerProfileIds = new Set(
      collaborators.filter(c => c.eventRole === "performer" && c.profileId).map(c => c.profileId),
    );
    return childEvents
      .filter(child => child.performerProfileId && !existingPerformerProfileIds.has(child.performerProfileId))
      .map(child => {
        const profile = child.performerProfileId ? profileById.get(child.performerProfileId) : undefined;
        const status = child.performerResponse === "accepted" ? "active" : child.performerResponse === "declined" ? "declined" : "pending";
        return {
          id: `child-performer-${child.id}`,
          email: "",
          eventRole: "performer" as EventCollaboratorRole,
          name: profile?.name || child.artist || "Performer",
          status,
          invitedAt: "",
          profileId: child.performerProfileId!,
        };
      });
  }, [event.isMultiPerformer, event.id, childEvents, collaborators, profileById]);

  // Synthesize single-performer entry when not multi-performer
  const singlePerformerCollaborator = useMemo<EventCollaborator | null>(() => {
    if (event.isMultiPerformer) return null;
    if (!event.performerProfileId) return null;
    if (collaborators.some(c => c.eventRole === "performer" && c.profileId === event.performerProfileId)) return null;
    const profile = profileById.get(event.performerProfileId);
    return {
      id: `single-performer-${event.id}`,
      email: "",
      eventRole: "performer" as EventCollaboratorRole,
      name: profile?.name || event.artist || "Performer",
      status: event.performerResponse === "accepted" ? "active" : event.performerResponse === "declined" ? "declined" : "pending",
      invitedAt: "",
      profileId: event.performerProfileId,
    };
  }, [event, collaborators, profileById]);

  const allCollaborators = useMemo(
    () => [...collaborators, ...performerCollaborators, ...(singlePerformerCollaborator ? [singlePerformerCollaborator] : [])],
    [collaborators, performerCollaborators, singlePerformerCollaborator],
  );

  // Group collaborators by role
  const roleOrder: EventCollaboratorRole[] = ["venue", "promoter", "organizer", "festival", "performer", "agent", "admin", "staff"];
  const grouped = new Map<EventCollaboratorRole, EventCollaborator[]>();
  for (const c of allCollaborators) {
    const list = grouped.get(c.eventRole) || [];
    list.push(c);
    grouped.set(c.eventRole, list);
  }

  // Scroll target for the collaborator_invited / collaborator_joined
  // notifications (#collaborators).
  const collaboratorsRef = useScrollToHash<HTMLDivElement>("collaborators");

  return (
    <div id="collaborators" ref={collaboratorsRef} className="space-y-6 scroll-mt-24">
      <div>
        <h3 className="font-display text-lg font-semibold">Collaborators</h3>
        <p className="text-sm text-muted-foreground">Profiles and parties connected to this event</p>
      </div>

      {/* Host profile card */}
      {hostProfile && event.hostProfileId && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Event Host</h4>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-4">
              {hostProfile.avatarUrl ? (
                <img src={hostProfile.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  {hostProfile.name.charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium"><ProfilePreviewPopover name={hostProfile.name} profileId={event.hostProfileId} /></p>
                <p className="text-xs text-muted-foreground">
                  {formatLocation(getPrimaryLocation(hostProfile.locations))}
                  {hostProfile.role && ` \u00b7 ${hostProfile.role.charAt(0).toUpperCase() + hostProfile.role.slice(1)}`}
                </p>
              </div>
              <Badge variant="outline" className={`text-xs ${permissionBadgeStyles.admin}`}>Admin</Badge>
              <Badge variant="secondary" className="text-xs">Host</Badge>
            </div>
          </div>
        </div>
      )}

      {/* Collaborator groups */}
      {allCollaborators.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No collaborators added yet.</p>
          <p className="text-sm text-muted-foreground mt-1">Invite performers, venues, agents, or other parties to collaborate on this event.</p>
        </div>
      ) : (
        roleOrder
          .filter((role) => grouped.has(role))
          .map((role) => {
            const members = grouped.get(role)!;
            return (
              <div key={role} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-muted/30 border-b">
                  <h4 className="text-sm font-semibold">{eventCollaboratorRoleLabels[role]}</h4>
                </div>
                <div className="divide-y">
                  {members.map((c) => {
                    const linkedProfile = c.profileId ? profileById.get(c.profileId) : undefined;
                    const status = statusConfig[c.status] || statusConfig.pending;
                    const StatusIcon = status.icon;

                    const permission: CollaboratorPermission = c.permission ?? DEFAULT_COLLABORATOR_PERMISSION;
                    const isSynthetic = c.id.startsWith("child-performer-") || c.id.startsWith("single-performer-");
                    const showPermissionEditor = !!canManagePermissions && !isSynthetic;
                    return (
                      <div key={c.id} className="px-5 py-4">
                        <div className="flex items-center gap-4">
                          {linkedProfile?.avatarUrl ? (
                            <img src={linkedProfile.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                              {c.name.charAt(0)}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium"><ProfilePreviewPopover name={c.name} profileId={c.profileId} /></p>
                              {c.profileId && (
                                <Badge variant="outline" className="text-[10px] gap-1 py-0">
                                  <LinkIcon className="h-2.5 w-2.5" /> Profile linked
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                              {c.email && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Mail className="h-3 w-3" /> {c.email}
                                </span>
                              )}
                              {getPrimaryLocation(linkedProfile?.locations) && (
                                <span className="text-xs text-muted-foreground">{formatLocation(getPrimaryLocation(linkedProfile?.locations))}</span>
                              )}
                            </div>
                          </div>
                          {showPermissionEditor ? (
                            <Select
                              value={permission}
                              onValueChange={(v) => void updatePermission(c, v as CollaboratorPermission)}
                              disabled={pendingPermissionWrite === c.id}
                            >
                              <SelectTrigger className="h-7 w-[110px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(collaboratorPermissionLabels) as CollaboratorPermission[]).map((p) => {
                                  // "admin" tier is Pro-only — Free hosts only see view_only/editor.
                                  // Already-admin rows still render their badge fine; the select
                                  // option itself is gated.
                                  if (p === "admin" && !canGrantAdminTier && permission !== "admin") {
                                    return null;
                                  }
                                  return (
                                    <SelectItem key={p} value={p} className="text-xs">
                                      {collaboratorPermissionLabels[p]}
                                      {p === "admin" && !canGrantAdminTier && (
                                        <span className="ml-1 text-muted-foreground">(Pro)</span>
                                      )}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className={`text-xs ${permissionBadgeStyles[permission]}`}>
                              {collaboratorPermissionLabels[permission]}
                            </Badge>
                          )}
                          <Badge variant="outline" className={`text-xs gap-1 ${status.color}`}>
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </Badge>
                        </div>

                        {/* Invitation code info for pending collaborators */}
                        {!collaboratorIsActive(c.status) && (() => {
                          const matchingCode = invitationCodes?.find(
                            (ic) =>
                              ic.linkedEventId === event.id &&
                              ic.recipientEmail === c.email &&
                              ic.status === "active",
                          );
                          if (!matchingCode) return null;
                          const inviteUrl = `${window.location.origin}/invite?code=${matchingCode.code}`;
                          return (
                            <div className="mt-3 ml-14 flex items-center gap-2">
                              <Badge variant="outline" className="text-xs font-mono">
                                {matchingCode.code}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Copy invitation code"
                                onClick={() => {
                                  navigator.clipboard.writeText(matchingCode.code);
                                  copyToast("Code copied to clipboard");
                                }}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="Copy invitation link"
                                onClick={() => {
                                  navigator.clipboard.writeText(inviteUrl);
                                  copyToast("Link copied", "Invitation link copied to clipboard.");
                                }}
                              >
                                <LinkIcon className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title="Revoke invitation"
                                disabled={revokeMutation.isPending}
                                onClick={() => revokeAndCleanup(matchingCode.code, c.id, matchingCode.linkedProfileId)}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })()}

                        {/* Profile details when linked — only render if at
                            least one field has content, otherwise the outer
                            container draws an empty box for role types like
                            Promoter that have no bio/genres/capacity/setup. */}
                        {(() => {
                          if (!linkedProfile || !collaboratorIsActive(c.status)) return null;
                          const hasBio = Boolean(linkedProfile.bio);
                          const hasGenres = (linkedProfile.genres?.length ?? 0) > 0;
                          const hasCapacity = Boolean(linkedProfile.capacity);
                          const hasSetup = Boolean(linkedProfile.setupType);
                          if (!hasBio && !hasGenres && !hasCapacity && !hasSetup) return null;
                          return (
                            <div className="mt-3 ml-14 rounded-lg border bg-muted/20 p-3 space-y-1.5">
                              {hasBio && (
                                <p className="text-xs text-muted-foreground line-clamp-2">{linkedProfile.bio}</p>
                              )}
                              {hasGenres && (
                                <div className="flex flex-wrap gap-1">
                                  {linkedProfile.genres!.slice(0, 6).map((g) => (
                                    <Badge key={g} variant="secondary" className="text-[10px] py-0 px-1.5">{g}</Badge>
                                  ))}
                                  {linkedProfile.genres!.length > 6 && (
                                    <span className="text-[10px] text-muted-foreground">+{linkedProfile.genres!.length - 6} more</span>
                                  )}
                                </div>
                              )}
                              {(hasCapacity || hasSetup) && (
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  {hasCapacity && <span>Capacity: {linkedProfile.capacity!.toLocaleString()}</span>}
                                  {hasSetup && <span>Setup: {linkedProfile.setupType}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
      )}
    </div>
  );
}
