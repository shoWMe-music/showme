import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useUser, getBaseRole } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import {
  fetchProfileMembers,
  fetchProfileInvites,
  setProfileMemberRole,
  removeProfileMember,
  inviteProfileAdmin,
  cancelProfileInvite,
  deleteProfile,
  fetchPendingProfileInvitesForEmail,
  acceptProfileInvite,
  declineProfileInvite,
  type ProfileMemberInfo,
} from "@/lib/db";
import type { ProfileInviteRecord } from "@/lib/profiles";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys, useAllProfiles } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockingProgressDialog } from "@/components/BlockingProgressDialog";
import { toast } from "@/hooks/use-toast";
import { Check, Crown, Edit2, Mail, Plus, Trash2, UserCheck, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS = { owner: "Owner", admin: "Admin", editor: "Editor" } as const;
const ROLE_COLORS = {
  owner: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  editor: "bg-muted text-muted-foreground",
} as const;

interface ProfileState {
  members: ProfileMemberInfo[];
  invites: ProfileInviteRecord[];
  loading: boolean;
}

interface ProfileMembersAndInvites {
  members: ProfileMemberInfo[];
  invites: ProfileInviteRecord[];
}

interface InviteForm {
  email: string;
  role: "admin" | "editor";
}

export function ProfileAdminsTab() {
  const { profiles, setProfiles, currentUser } = useUser();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [actingInviteId, setActingInviteId] = useState<string | null>(null);
  const [blockingLabel, setBlockingLabel] = useState<string | null>(null);

  // Pending invites for this user's email — surfaced as accept/decline banners
  // at the top of the tab. Invalidated by useNotificationInvalidator on
  // `profile_invite` so a fresh invite shows up without a manual refresh.
  const myEmail = (user?.email || "").toLowerCase().trim();
  const pendingInvitesQuery = useQuery({
    queryKey: queryKeys.pendingProfileInvites(myEmail),
    queryFn: () => fetchPendingProfileInvitesForEmail(myEmail),
    enabled: !!myEmail,
    staleTime: 30_000,
  });
  const pendingInvites = pendingInvitesQuery.data ?? [];

  // Owned profiles include legacy "artist" slot entries left over from the
  // artist -> performer rename, so the user can delete the phantom record.
  const ownedProfiles = Object.entries(profiles).filter(([, p]) => {
    if (!p.created) return false;
    return p.owner_uid === user?.uid || !!p.id?.startsWith(`${user?.uid}__`);
  });

  // Profiles where the user is a member but not the owner (invited admin/editor).
  // Source from the flat `all` array, not the slotted dict — two profiles of
  // the same role-type collapse on slot, which would silently hide a shared
  // venue if the invitee already owned a venue. Synthesize a stable display
  // key (`profile.slot ?? profile.role`) used only for the role label render.
  const allProfiles = useAllProfiles();
  const sharedProfiles: Array<[string, typeof allProfiles[number]]> = allProfiles
    .filter((p) => {
      if (!p.created) return false;
      if (p.owner_uid === user?.uid || p.id?.startsWith(`${user?.uid}__`)) return false;
      return true;
    })
    .map((p) => {
      const displaySlot =
        (typeof (p as { slot?: unknown }).slot === "string" && (p as { slot: string }).slot) ||
        (p.role as string) ||
        "shared";
      return [displaySlot, p];
    });

  const [inviteOpen, setInviteOpen] = useState<string | null>(null); // profileId
  const [inviteForm, setInviteForm] = useState<InviteForm>({ email: "", role: "admin" });
  const [inviting, setSaving] = useState(false);
  // Synchronous double-click guard: setSaving(true) doesn't take effect until
  // the next render, so a fast double-click can fire two inviteProfileAdmin calls.
  const invitingRef = useRef(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  // Double-confirm flow: which profile slot is in stage-1 (warning) vs stage-2 (type-name) of deletion
  const [deleteStage, setDeleteStage] = useState<{ slot: string; stage: 1 | 2 } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  // Members + invites for every profile this user can see, keyed by profileId.
  // useNotificationInvalidator flushes ["profileMembers"] on profile_member_*
  // notifications to refresh these without a manual refetch.
  const allProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [slot] of ownedProfiles) {
      const id = profiles[slot]?.id;
      if (id) ids.add(id);
    }
    for (const [, profile] of sharedProfiles) {
      if (profile.id) ids.add(profile.id);
    }
    return Array.from(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(profiles).join(","), sharedProfiles.length]);

  const profileQueries = useQueries({
    queries: allProfileIds.map((profileId) => ({
      queryKey: queryKeys.profileMembers(profileId),
      queryFn: async (): Promise<ProfileMembersAndInvites> => {
        const [members, invites] = await Promise.all([
          fetchProfileMembers(profileId),
          fetchProfileInvites(profileId),
        ]);
        return { members, invites };
      },
      staleTime: 30_000,
    })),
  });

  const profileState: Record<string, ProfileState> = {};
  allProfileIds.forEach((profileId, i) => {
    const q = profileQueries[i];
    profileState[profileId] = {
      members: q?.data?.members ?? [],
      invites: q?.data?.invites ?? [],
      loading: q?.isLoading ?? false,
    };
  });

  const refreshProfile = useCallback(
    (profileId: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profileMembers(profileId) });
    },
    [queryClient],
  );

  const handleChangeRole = async (profileId: string, memberUid: string, role: "admin" | "editor") => {
    setBlockingLabel("Updating profile member…");
    try {
      await setProfileMemberRole(profileId, memberUid, role);
      toast({ title: "Role updated" });
      refreshProfile(profileId);
    } catch (err) {
      toast({
        title: "Could not update role",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBlockingLabel(null);
    }
  };

  const handleRemove = async (profileId: string, memberUid: string) => {
    setBlockingLabel("Removing member…");
    try {
      await removeProfileMember(profileId, memberUid);
      if (user?.uid) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.events(user.uid) });
      }
      toast({ title: "Member removed" });
      refreshProfile(profileId);
    } catch (err) {
      toast({
        title: "Could not remove member",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBlockingLabel(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteOpen || !inviteForm.email.trim()) return;
    if (invitingRef.current) return;
    // Owners and admins can both invite — look up the target profile across
    // owned + shared via the flat `all` array.
    const target = allProfiles.find((p) => p.id === inviteOpen);
    if (!target) return;
    const targetName = target.name ?? "the profile";
    invitingRef.current = true;
    setSaving(true);
    try {
      await inviteProfileAdmin(inviteOpen, targetName, inviteForm.email, inviteForm.role);
      toast({ title: "Invite sent", description: `${inviteForm.email} will get access when they next log in.` });
      setInviteOpen(null);
      setInviteForm({ email: "", role: "admin" });
      refreshProfile(inviteOpen);
    } catch (err) {
      toast({ title: "Could not send invite", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
      invitingRef.current = false;
    }
  };

  const handleCancelInvite = async (profileId: string, email: string) => {
    await cancelProfileInvite(profileId, email);
    toast({ title: "Invite cancelled" });
    refreshProfile(profileId);
  };

  const handleAcceptInvite = async (invite: ProfileInviteRecord) => {
    if (!invite.id) return;
    setActingInviteId(invite.id);
    setBlockingLabel("Loading new profile data…");
    try {
      await acceptProfileInvite(invite, currentUser.name || myEmail);
      toast({ title: "Invite accepted", description: `You're now a${invite.role === "admin" ? "n admin" : "n editor"} of ${invite.profileName}.` });
      // Refresh both: pending invites disappears, profiles picks up the new membership.
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingProfileInvites(myEmail) });
      if (user?.uid) {
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles(user.uid) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.events(user.uid) });
      }
    } catch (err) {
      toast({
        title: "Could not accept invite",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActingInviteId(null);
      setBlockingLabel(null);
    }
  };

  const handleDeclineInvite = async (invite: ProfileInviteRecord) => {
    if (!invite.id) return;
    setActingInviteId(invite.id);
    try {
      await declineProfileInvite(invite);
      toast({ title: "Invite declined" });
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingProfileInvites(myEmail) });
    } catch (err) {
      toast({
        title: "Could not decline invite",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActingInviteId(null);
    }
  };

  const handleDeleteProfile = useCallback(
    async (slot: string, profileId: string | undefined) => {
      setDeletingProfileId(profileId ?? slot);
      // Optimistic local removal
      setProfiles((prev) => {
        const updated = { ...prev };
        delete updated[slot];
        return updated;
      });
      try {
        if (profileId) await deleteProfile(profileId);
        toast({ title: "Profile deleted", description: "The profile has been removed." });
      } catch (err) {
        toast({
          title: "Could not delete profile",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setDeletingProfileId(null);
      }
    },
    [setProfiles],
  );

  const hasAnything =
    ownedProfiles.length > 0 || sharedProfiles.length > 0 || pendingInvites.length > 0;

  if (!hasAnything) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No profiles yet. Create a profile to manage administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pendingInvitesQuery.error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive">
          Could not load pending invites: {pendingInvitesQuery.error instanceof Error ? pendingInvitesQuery.error.message : "Unknown error"}
        </div>
      )}
      {pendingInvites.length > 0 && (
        <div className="space-y-3">
          {pendingInvites.map((inv) => {
            const isActing = actingInviteId === inv.id;
            return (
              <div
                key={inv.id}
                className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 flex items-center gap-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Mail className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    You've been invited to manage <span className="font-semibold">{inv.profileName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Role: <span className="capitalize">{inv.role}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={isActing}
                    onClick={() => handleDeclineInvite(inv)}
                  >
                    <X className="h-3.5 w-3.5" /> Decline
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={isActing}
                    onClick={() => handleAcceptInvite(inv)}
                  >
                    <Check className="h-3.5 w-3.5" /> Accept
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(ownedProfiles.length > 0 || sharedProfiles.length > 0) && (
        <p className="text-sm text-muted-foreground">
          Admins and editors can manage your profiles and events. Owners cannot be removed.
        </p>
      )}

      {ownedProfiles.length > 0 && sharedProfiles.length > 0 && (
        <h3 className="text-sm font-semibold text-muted-foreground">Profiles you own</h3>
      )}

      {ownedProfiles.map(([slot, profile]) => {
        const profileId = profile.id || "";
        const state = profileState[profileId];
        // Phantom entries left over from the artist -> performer rename:
        // these have slot === "artist" or role === "artist" and should not
        // route to the editor (no /profiles/artist/edit route exists).
        const isPhantom = slot === "artist" || slot.startsWith("artist") || (profile.role as string) === "artist";
        const editRole = isPhantom ? null : getBaseRole(slot);
        const deletingThis = deletingProfileId === (profileId || slot);

        return (
          <div key={profileId || slot} className="rounded-xl border bg-card shadow-sm overflow-hidden">
            {/* Profile header */}
            <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
              <div>
                <p className="font-semibold">{profile.name ?? slot}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {slot}{isPhantom && <span className="ml-1 text-amber-600">(legacy — please delete)</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!isPhantom && (
                  <Button size="sm" variant="outline" className="gap-1.5"
                    onClick={() => { setInviteOpen(profileId); setInviteForm({ email: "", role: "admin" }); }}>
                    <Plus className="h-3.5 w-3.5" /> Invite
                  </Button>
                )}
                {editRole && (
                  <Link to="/profiles/$role/edit" params={{ role: editRole }}>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <Edit2 className="h-3.5 w-3.5" /> Edit Profile
                    </Button>
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  disabled={deletingThis}
                  onClick={() => { setDeleteStage({ slot, stage: 1 }); setDeleteConfirmName(""); }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>

            {/* Members */}
            {state?.loading ? (
              <div className="px-5 py-4 space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="divide-y">
                {state?.members.map((m) => (
                  <li key={m.uid} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                      {m.displayName ? m.displayName.slice(0, 2).toUpperCase() : m.uid.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.displayName ?? (m.email ? m.email.split("@")[0] : `User ${m.uid.slice(0, 6)}`)}
                        {m.uid === user?.uid && <span className="text-xs text-muted-foreground ml-1">(you)</span>}
                      </p>
                      {m.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{m.email}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {m.role === "owner" ? (
                        <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", ROLE_COLORS.owner)}>
                          <Crown className="h-3 w-3" /> {ROLE_LABELS.owner}
                        </span>
                      ) : (
                        <>
                          <Select value={m.role} onValueChange={(v) => handleChangeRole(profileId, m.uid, v as "admin" | "editor")}>
                            <SelectTrigger className={cn("h-7 w-24 text-xs border-0 rounded-full", ROLE_COLORS[m.role])}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="editor">Editor</SelectItem>
                            </SelectContent>
                          </Select>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove access?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Remove this person's access to {profile.name ?? slot}? They will no longer be able to manage this profile.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleRemove(profileId, m.uid)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  </li>
                ))}

                {/* Pending invites */}
                {state?.invites.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 px-5 py-3 bg-muted/20">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">Pending invite</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs capitalize">{inv.role}</Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => handleCancelInvite(profileId, inv.email)}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </li>
                ))}

                {state?.members.length === 0 && state?.invites.length === 0 && (
                  <li className="px-5 py-4 text-sm text-muted-foreground text-center">No members found.</li>
                )}
              </ul>
            )}
          </div>
        );
      })}

      {sharedProfiles.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted-foreground pt-2">
            Profiles you have access to
          </h3>
          {sharedProfiles.map(([slot, profile]) => {
            const profileId = profile.id || "";
            const state = profileState[profileId];
            const myMember = state?.members.find((m) => m.uid === user?.uid);
            const myRole = myMember?.role;
            // Admins on a shared profile can manage members (invite, remove,
            // change roles) — same surface as the owner, minus profile delete
            // and minus any control over the owner row. Server side enforces
            // the same rules; this gate is purely UX.
            const canManage = myRole === "admin";
            return (
              <div key={profileId || slot} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
                  <div>
                    <p className="font-semibold">{profile.name ?? slot}</p>
                    <p className="text-xs text-muted-foreground capitalize">{slot}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && (
                      <Button size="sm" variant="outline" className="gap-1.5"
                        onClick={() => { setInviteOpen(profileId); setInviteForm({ email: "", role: "admin" }); }}>
                        <Plus className="h-3.5 w-3.5" /> Invite
                      </Button>
                    )}
                    {myRole && (
                      <span className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                        ROLE_COLORS[myRole],
                      )}>
                        You are {myRole === "editor" ? "an" : myRole === "admin" ? "an" : "the"} {ROLE_LABELS[myRole]}
                      </span>
                    )}
                  </div>
                </div>
                {state?.loading ? (
                  <div className="px-5 py-4 space-y-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-32" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {state?.members.map((m) => (
                      <li key={m.uid} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {m.displayName ? m.displayName.slice(0, 2).toUpperCase() : m.uid.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {m.displayName ?? (m.email ? m.email.split("@")[0] : `User ${m.uid.slice(0, 6)}`)}
                            {m.uid === user?.uid && <span className="text-xs text-muted-foreground ml-1">(you)</span>}
                          </p>
                          {m.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{m.email}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canManage && m.role !== "owner" && m.uid !== user?.uid ? (
                            <>
                              <Select value={m.role} onValueChange={(v) => handleChangeRole(profileId, m.uid, v as "admin" | "editor")}>
                                <SelectTrigger className={cn("h-7 w-24 text-xs border-0 rounded-full", ROLE_COLORS[m.role])}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="editor">Editor</SelectItem>
                                </SelectContent>
                              </Select>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove access?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Remove this person's access to {profile.name ?? slot}? They will no longer be able to manage this profile.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleRemove(profileId, m.uid)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          ) : (
                            <span className={cn(
                              "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                              ROLE_COLORS[m.role],
                            )}>
                              {m.role === "owner" && <Crown className="h-3 w-3" />}
                              {ROLE_LABELS[m.role]}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}

                    {canManage && state?.invites.map((inv) => (
                      <li key={inv.id} className="flex items-center gap-3 px-5 py-3 bg-muted/20">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">Pending invite</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-xs capitalize">{inv.role}</Badge>
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => handleCancelInvite(profileId, inv.email)}>
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Two-step Delete Confirmation */}
      {deleteStage && (() => {
        const targetSlot = deleteStage.slot;
        const targetProfile = profiles[targetSlot];
        const targetName = targetProfile?.name ?? targetSlot;
        const targetId = targetProfile?.id;
        const closeDialog = () => { setDeleteStage(null); setDeleteConfirmName(""); };
        const confirmsMatch = deleteConfirmName.trim() === targetName.trim();
        return (
          <>
            {/* Stage 1: warning */}
            <AlertDialog
              open={deleteStage.stage === 1}
              onOpenChange={(o) => { if (!o) closeDialog(); }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete profile "{targetName}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    By deleting your profile, all your data associated with it will be lost. This includes the public page, team members, and access for collaborators. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={closeDialog}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      setDeleteStage({ slot: targetSlot, stage: 2 });
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {/* Stage 2: type-name confirmation */}
            <Dialog
              open={deleteStage.stage === 2}
              onOpenChange={(o) => { if (!o) closeDialog(); }}
            >
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Confirm deletion</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-1">
                  <p className="text-sm text-muted-foreground">
                    To confirm, type the profile name <span className="font-semibold text-foreground">{targetName}</span> below.
                  </p>
                  <Input
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={targetName}
                    autoFocus
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                  <Button
                    variant="destructive"
                    disabled={!confirmsMatch}
                    onClick={async () => {
                      closeDialog();
                      await handleDeleteProfile(targetSlot, targetId);
                    }}
                  >
                    Delete Profile
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        );
      })()}

      {/* Invite Dialog */}
      <Dialog open={!!inviteOpen} onOpenChange={(o) => { if (!o) setInviteOpen(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-4 w-4" /> Invite Profile Admin
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div>
              <Label>Email address</Label>
              <Input
                value={inviteForm.email}
                onChange={(e) => setInviteForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="colleague@example.com"
                type="email"
                className="mt-1"
                onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={inviteForm.role} onValueChange={(v) => setInviteForm((p) => ({ ...p, role: v as "admin" | "editor" }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access, can manage members</SelectItem>
                  <SelectItem value="editor">Editor — can edit profile and events</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              The invite is claimed automatically when they next log in with this email address.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(null)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!inviteForm.email.trim() || inviting}>
              {inviting ? "Sending…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BlockingProgressDialog
        open={blockingLabel !== null}
        title={blockingLabel ?? ""}
        description="Please don't close this tab — we're updating your access across all events."
      />
    </div>
  );
}
