import { useCallback, useEffect, useState } from "react";
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
  type ProfileMemberInfo,
} from "@/lib/db";
import type { ProfileInviteRecord } from "@/lib/profiles";
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
import { toast } from "@/hooks/use-toast";
import { Crown, Edit2, Mail, Plus, Trash2, UserCheck, Users, X } from "lucide-react";
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

interface InviteForm {
  email: string;
  role: "admin" | "editor";
}

export function ProfileAdminsTab() {
  const { profiles, setProfiles } = useUser();
  const { user } = useAuth();

  // Show all profiles the current user owns — including legacy "artist" slot
  // entries left over from the artist -> performer rename, so the user can
  // delete the phantom record from this page.
  const ownedProfiles = Object.entries(profiles).filter(
    ([, p]) => {
      if (!p.created) return false;
      if (!(p.owner_uid === user?.uid || p.id?.startsWith(`${user?.uid}__`))) return false;
      return true;
    },
  );

  const [profileState, setProfileState] = useState<Record<string, ProfileState>>({});
  const [inviteOpen, setInviteOpen] = useState<string | null>(null); // profileId
  const [inviteForm, setInviteForm] = useState<InviteForm>({ email: "", role: "admin" });
  const [inviting, setSaving] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  // Double-confirm flow: which profile slot is in stage-1 (warning) vs stage-2 (type-name) of deletion
  const [deleteStage, setDeleteStage] = useState<{ slot: string; stage: 1 | 2 } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const loadProfile = useCallback(async (profileId: string) => {
    setProfileState((p) => ({ ...p, [profileId]: { members: [], invites: [], loading: true } }));
    try {
      const [members, invites] = await Promise.all([
        fetchProfileMembers(profileId),
        fetchProfileInvites(profileId),
      ]);
      setProfileState((p) => ({ ...p, [profileId]: { members, invites, loading: false } }));
    } catch {
      setProfileState((p) => ({ ...p, [profileId]: { members: [], invites: [], loading: false } }));
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    for (const [slot] of ownedProfiles) {
      const profileId = profiles[slot]?.id;
      if (profileId) loadProfile(profileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, Object.keys(profiles).join(",")]);

  const handleChangeRole = async (profileId: string, memberUid: string, role: "admin" | "editor") => {
    await setProfileMemberRole(profileId, memberUid, role);
    toast({ title: "Role updated" });
    loadProfile(profileId);
  };

  const handleRemove = async (profileId: string, memberUid: string) => {
    await removeProfileMember(profileId, memberUid);
    toast({ title: "Member removed" });
    loadProfile(profileId);
  };

  const handleInvite = async () => {
    if (!inviteOpen || !inviteForm.email.trim()) return;
    const [slot, p] = ownedProfiles.find(([s]) => profiles[s]?.id === inviteOpen) ?? [];
    if (!slot || !p) return;
    setSaving(true);
    try {
      await inviteProfileAdmin(inviteOpen, p.name ?? slot, inviteForm.email, inviteForm.role);
      toast({ title: "Invite sent", description: `${inviteForm.email} will get access when they next log in.` });
      setInviteOpen(null);
      setInviteForm({ email: "", role: "admin" });
      loadProfile(inviteOpen);
    } catch (err) {
      toast({ title: "Could not send invite", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelInvite = async (profileId: string, email: string) => {
    await cancelProfileInvite(profileId, email);
    toast({ title: "Invite cancelled" });
    loadProfile(profileId);
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

  if (ownedProfiles.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No profiles yet. Create a profile to manage administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Admins and editors can manage your profiles and events. Owners cannot be removed.
      </p>

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
    </div>
  );
}
