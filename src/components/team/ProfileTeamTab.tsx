import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useUser, type TeamMember, type OperatorRole } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import { upsertProfileTeamMember } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Mail, Phone, Plus, Trash2, Users } from "lucide-react";

// Profiles that can share team members
const VENUE_SIDE = new Set<OperatorRole>(["venue", "promoter", "organizer", "festival"]);
const ARTIST_SIDE = new Set<OperatorRole>(["performer"]);

function sameTypeGroup(a: OperatorRole, b: OperatorRole): boolean {
  return (VENUE_SIDE.has(a) && VENUE_SIDE.has(b)) || (ARTIST_SIDE.has(a) && ARTIST_SIDE.has(b));
}

const PRESET_ROLES: Record<string, string[]> = {
  venue: ["Sound Engineer", "Light Engineer", "Stage Manager", "Security", "Production", "Bar Staff", "Catering"],
  promoter: ["Marketing", "Logistics", "Production", "Artist Liaison"],
  organizer: ["Production", "Logistics", "Stage Manager", "Artist Liaison"],
  festival: ["Stage Manager", "Production", "Security", "Logistics", "Artist Liaison"],
  artist: ["Tour Manager", "Agent", "Manager", "Sound Engineer", "Light Engineer", "Road Manager"],
};

type FormState = {
  name: string; email: string; phone: string;
  role: string; status: "active" | "inactive"; notes: string;
};
const emptyForm: FormState = { name: "", email: "", phone: "", role: "Member", status: "active", notes: "" };

export function ProfileTeamTab() {
  const { profiles, teamMembers, addTeamMember, updateTeamMember, removeTeamMember, loaded } = useUser();
  const { user } = useAuth();

  const ownedProfiles = Object.entries(profiles).filter(
    ([, p]) => p.created && (p.owner_uid === user?.uid || p.id?.startsWith(`${user?.uid}__`)),
  );

  const upsertTeamMemberMutation = useMutation({
    mutationFn: ({ profileId, member }: { profileId: string; member: Parameters<typeof upsertProfileTeamMember>[1] }) =>
      upsertProfileTeamMember(profileId, member),
    onError: () => {
      toast({ title: "Failed to save team member", description: "Could not save to one or more profiles.", variant: "destructive" });
    },
  });

  const [addOpen, setAddOpen] = useState<string | null>(null); // profileId
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; profileId: string; name: string } | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [extraProfiles, setExtraProfiles] = useState<string[]>([]);

  const primaryProfile = addOpen ? ownedProfiles.find(([s]) => profiles[s]?.id === addOpen) : null;
  const primaryRole = primaryProfile ? primaryProfile[1].role : null;

  const compatibleProfiles = primaryRole
    ? ownedProfiles.filter(([s]) => {
        const pid = profiles[s]?.id;
        if (pid === addOpen) return false;
        const role = profiles[s]?.role;
        return role && sameTypeGroup(primaryRole, role);
      })
    : [];

  const presetRoles = primaryRole ? PRESET_ROLES[primaryRole] ?? [] : [];

  const handleAdd = () => {
    if (!addOpen || !form.name.trim() || !user) return;
    const member: TeamMember = {
      id: `TM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      roles: [form.role],
      status: form.status,
      notes: form.notes.trim(),
      profileId: addOpen,
    };
    addTeamMember(member, addOpen);
    // Also add to any extra selected profiles of the same type
    const mutations = extraProfiles.map(pid =>
      upsertTeamMemberMutation.mutateAsync({ profileId: pid, member: { ...member, profileId: pid } })
    );
    Promise.all(mutations).then(() => {
      toast({ title: "Team member added", description: extraProfiles.length > 0 ? `Added to ${1 + extraProfiles.length} profiles.` : undefined });
    });
    setAddOpen(null);
    setForm({ ...emptyForm });
    setExtraProfiles([]);
  };

  const handleSaveEdit = () => {
    if (!editing) return;
    updateTeamMember(editing);
    setEditOpen(false);
    setEditing(null);
    toast({ title: "Team member updated" });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    removeTeamMember(deleteTarget.id, deleteTarget.profileId);
    toast({ title: "Team member removed", description: `${deleteTarget.name} has been removed.` });
    setDeleteTarget(null);
  };

  if (!loaded) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  if (ownedProfiles.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-12 text-center">
        <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No profiles yet. Create a profile to manage its team.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Each profile has its own crew. Venue-side profiles (venue, promoter, organizer, festival) can share team members. Artist profiles have their own separate team.
      </p>

      {ownedProfiles.map(([slot, profile]) => {
        const profileId = profile.id || "";
        const members = teamMembers.filter((m) => m.profileId === profileId);

        return (
          <div key={profileId} className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
              <div>
                <p className="font-semibold">{profile.name ?? slot}</p>
                <p className="text-xs text-muted-foreground capitalize">{slot}</p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => { setAddOpen(profileId); setForm({ ...emptyForm }); setExtraProfiles([]); }}>
                <Plus className="h-3.5 w-3.5" /> Add Member
              </Button>
            </div>

            {members.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                No team members yet for this profile.
              </div>
            ) : (
              <ul className="divide-y">
                {members.map((m) => (
                  <li key={m.id}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => { setEditing({ ...m }); setEditOpen(true); }}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                      {m.name.charAt(0)}{m.name.split(" ")[1]?.charAt(0) ?? ""}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {m.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{m.email}</span>}
                        {m.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{m.phone}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {m.roles.map((r) => <Badge key={r} variant="outline" className="text-xs">{r}</Badge>)}
                      <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-xs">{m.status}</Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setDeleteTarget({ id: m.id, profileId: profileId, name: m.name })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Add Dialog */}
      <Dialog open={!!addOpen} onOpenChange={(o) => { if (!o) setAddOpen(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto pr-1">
            <div><Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Full name" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com" type="email" className="mt-1" />
              </div>
              <div><Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+1 555..." className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presetRoles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  <SelectItem value="Member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Any notes..." className="mt-1 min-h-[70px]" />
            </div>
            {compatibleProfiles.length > 0 && (
              <div>
                <Label className="mb-2 block">Also add to</Label>
                <p className="text-xs text-muted-foreground mb-2">Other {primaryRole && VENUE_SIDE.has(primaryRole) ? "venue-side" : "performer"} profiles you own</p>
                <div className="space-y-2">
                  {compatibleProfiles.map(([s, p]) => {
                    const pid = profiles[s]?.id;
                    return (
                      <label key={pid} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={extraProfiles.includes(pid)}
                          onCheckedChange={(checked) =>
                            setExtraProfiles((prev) => checked ? [...prev, pid] : prev.filter((id) => id !== pid))
                          }
                        />
                        <span className="text-sm">{p.name ?? s}</span>
                        <span className="text-xs text-muted-foreground capitalize">({s})</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(null)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!form.name.trim()}>Add Member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Team Member</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto pr-1">
              <div><Label>Name</Label>
                <Input value={editing.name} onChange={(e) => setEditing((p) => p ? { ...p, name: e.target.value } : p)} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Email</Label>
                  <Input value={editing.email} onChange={(e) => setEditing((p) => p ? { ...p, email: e.target.value } : p)} type="email" className="mt-1" />
                </div>
                <div><Label>Phone</Label>
                  <Input value={editing.phone ?? ""} onChange={(e) => setEditing((p) => p ? { ...p, phone: e.target.value } : p)} className="mt-1" />
                </div>
              </div>
              <div><Label>Status</Label>
                <Select value={editing.status} onValueChange={(v) => setEditing((p) => p ? { ...p, status: v as "active" | "inactive" } : p)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notes</Label>
                <Textarea value={editing.notes ?? ""} onChange={(e) => setEditing((p) => p ? { ...p, notes: e.target.value } : p)} className="mt-1 min-h-[70px]" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {deleteTarget?.name} from this profile's team? They can be re-added later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
