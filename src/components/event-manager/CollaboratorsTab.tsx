import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type Event as AppEvent,
  type EventCollaborator,
  type EventCollaboratorRole,
  eventCollaboratorRoleLabels,
  collaboratorIsActive,
} from "@/lib/models";
import { formatLocation, getPrimaryLocation, type SharedProfile } from "@/lib/user-context";
import { Users, UserPlus, Link as LinkIcon, Mail, Clock, Check, X, Shield, Copy, XCircle } from "lucide-react";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";
import { useMyInvitationCodes, useRevokeInvitationCode } from "@/lib/queries/useInvitationCodes";
import { toast, copyToast } from "@/hooks/use-toast";
import { useChildEvents } from "@/lib/queries";

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
  onInviteOpen: () => void;
}

export function CollaboratorsTab({ event, collaborators, profiles, onInviteOpen }: CollaboratorsTabProps) {
  const { data: invitationCodes } = useMyInvitationCodes();
  const revokeMutation = useRevokeInvitationCode();
  const childEvents = useChildEvents(event.id);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Collaborators</h3>
          <p className="text-sm text-muted-foreground">Profiles and parties connected to this event</p>
        </div>
        {event.eventStatus !== "draft" && event.eventStatus !== "suggested" && (
          <Button className="gap-2" onClick={onInviteOpen}>
            <UserPlus className="h-4 w-4" /> Invite Collaborator
          </Button>
        )}
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
                          return (
                            <div className="mt-3 ml-14 flex items-center gap-2">
                              <Badge variant="outline" className="text-xs font-mono">
                                {matchingCode.code}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
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
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                disabled={revokeMutation.isPending}
                                onClick={() => revokeMutation.mutate(matchingCode.code)}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })()}

                        {/* Profile details when linked */}
                        {linkedProfile && collaboratorIsActive(c.status) && (
                          <div className="mt-3 ml-14 rounded-lg border bg-muted/20 p-3 space-y-1.5">
                            {linkedProfile.bio && (
                              <p className="text-xs text-muted-foreground line-clamp-2">{linkedProfile.bio}</p>
                            )}
                            {linkedProfile.genres && linkedProfile.genres.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {linkedProfile.genres.slice(0, 6).map((g) => (
                                  <Badge key={g} variant="secondary" className="text-[10px] py-0 px-1.5">{g}</Badge>
                                ))}
                                {linkedProfile.genres.length > 6 && (
                                  <span className="text-[10px] text-muted-foreground">+{linkedProfile.genres.length - 6} more</span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              {linkedProfile.capacity && <span>Capacity: {linkedProfile.capacity.toLocaleString()}</span>}
                              {linkedProfile.setupType && <span>Setup: {linkedProfile.setupType}</span>}
                            </div>
                          </div>
                        )}
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
