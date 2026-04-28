import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast, copyToast } from "@/hooks/use-toast";
import { useUser } from "@/lib/user-context";
import TeamMemberSelect from "@/components/TeamMemberSelect";
import {
  type Event as AppEvent, type EventCollaborator, type CrewMember,
  collaboratorIsActive,
} from "@/lib/models";
import {
  fetchCrew, upsertCrewMember, deleteCrewMember,
  insertShareTokenRow, appendEventActivity, type EventMeta, type Todo,
} from "@/lib/db";
import { getAuthClient } from "@/lib/firebaseAuth";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Plus, Trash2, Users, Shield, Clock, CheckCircle2, PenLine,
  Download, Share2, Copy, Edit2, Check, X, ListTodo,
} from "lucide-react";

/* ─── Team/Crew Tab ─── */
export function CrewTab({ eventMeta, event, collaborators: propCollaborators, onSave, actingProfile, profileTodos, saveProfileTodos }: { eventMeta: EventMeta; event: AppEvent; collaborators: EventCollaborator[]; onSave?: (d: Partial<EventMeta>) => void; actingProfile?: string; profileTodos?: Todo[]; saveProfileTodos?: (todos: Todo[]) => void }) {
  const { teamMembers, addTeamMember } = useUser();

  const handleCreateTeamMember = (name: string) => {
    const newMember: import("@/lib/user-context").TeamMember = {
      id: `TM-${Date.now()}`,
      name,
      email: "",
      phone: "",
      roles: ["Member"],
      status: "active",
      notes: "",
    };
    addTeamMember(newMember, event.hostProfileId ?? "");
  };
  // crew is stored in a Firestore subcollection, not on eventMeta
  const legacyCrew = ((eventMeta as unknown as { crew?: CrewMember[] }).crew) || [];
  const [crew, setCrew] = useState<CrewMember[]>([...legacyCrew]);

  // ── Crew subcollection sync ────────────────────────────────────────────────
  const crewLoaded = useRef<string | null>(null);
  const prevCrewIds = useRef(new Set<string>(legacyCrew.map((m: CrewMember) => m.id)));

  useEffect(() => {
    crewLoaded.current = null;
    fetchCrew(event.id).then(fetched => {
      if (fetched.length > 0) {
        prevCrewIds.current = new Set(fetched.map(m => m.id));
        setCrew(fetched);
      }
      crewLoaded.current = event.id;
    });
  }, [event.id]);

  useEffect(() => {
    if (crewLoaded.current !== event.id) return;
    const currentIds = new Set(crew.map(m => m.id));
    const removed = [...prevCrewIds.current].filter(mid => !currentIds.has(mid));
    const added = crew.filter(m => !prevCrewIds.current.has(m.id));
    removed.forEach(mid => deleteCrewMember(event.id, mid));
    crew.forEach(m => upsertCrewMember(event.id, m));
    if (removed.length > 0 || added.length > 0) {
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      const details: Record<string, string> = {};
      if (added.length > 0) details.added = added.map(m => m.name || m.role).join(", ");
      if (removed.length > 0) details.removed = `${removed.length} member(s)`;
      appendEventActivity(event.id, "crew_updated", by, details, undefined, actingProfile);
      toast({ title: (<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Crew saved</span>), duration: 1000 });
    }
    prevCrewIds.current = currentIds;
  }, [event.id, crew, actingProfile]);

  const [addOpen, setAddOpen] = useState(false);
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", role: "", email: "", phone: "", collaborator: "" });
  const [collabSuggestions, setCollabSuggestions] = useState<string[]>([]);

  const [activeSection, setActiveSectionState] = useState<"shared" | "inhouse">(() => {
    const saved = localStorage.getItem("crew-section");
    return saved === "inhouse" ? "inhouse" : "shared";
  });
  const setActiveSection = (s: "shared" | "inhouse") => {
    localStorage.setItem("crew-section", s);
    setActiveSectionState(s);
  };
  const [privateNotes, setPrivateNotes] = useState<{ id: string; text: string; assignee: string }[]>(() => {
    return Array.isArray(eventMeta.privateNotes) ? [...eventMeta.privateNotes] : [];
  });
  const [newNote, setNewNote] = useState({ text: "", assignee: "" });
  const [scheduleItems, setScheduleItems] = useState<{ id: string; time: string; label: string; assignee: string }[]>(Array.isArray(eventMeta.crewScheduleItems) ? [...eventMeta.crewScheduleItems] : []);
  const [newScheduleItem, setNewScheduleItem] = useState({ time: "", label: "", assignee: "" });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Section sharing per member
  const [sharingOpen, setSharingOpen] = useState<string | null>(null);
  const [memberSections, setMemberSections] = useState<Record<string, string[]>>(eventMeta.memberSections && typeof eventMeta.memberSections === "object" ? { ...eventMeta.memberSections } : {});
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupNewName, setEditingGroupNewName] = useState("");
  const [addToGroup, setAddToGroup] = useState<string | null>(null);
  const [autofillToGroup, setAutofillToGroup] = useState<string | null>(null);
  const SHAREABLE_SECTIONS = [
    { id: "riders", label: "Riders & Documents" },
    { id: "schedule", label: "Event Schedule" },
    { id: "budget", label: "Budget Planner" },
    { id: "agreement", label: "Agreement" },
    { id: "details", label: "Event Details" },
  ];

  // crew now synced via subcollection; persist notes/schedule/sections via eventMeta
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    onSave?.({ privateNotes, crewScheduleItems: scheduleItems, memberSections });
  }, [privateNotes, scheduleItems, memberSections]);

  function exportInHousePDF(
    memberName: string,
    sItems: { id: string; time: string; label: string; assignee: string }[],
    tItems: { id: string; text: string; done: boolean; assignee: string }[],
    nItems: { id: string; text: string; assignee: string }[],
    eventName: string
  ) {
    const logoUrl = `${window.location.origin}/images/showme-logo.png`;
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>In-House Report - ${eventName}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;padding:40px;color:#1a1a1a;max-width:800px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px}h2{font-size:16px;margin-top:20px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;color:#444}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px}th,td{padding:6px 10px;text-align:left;border:1px solid #e0e0e0}
th{background:#f5f5f5;font-weight:600}.meta{color:#666;font-size:13px;margin-bottom:20px}
@media print{body{padding:20px}}</style></head><body>`;
    html += `<img src="${logoUrl}" style="height:50px;margin-bottom:12px" alt="shoWMe" />`;
    html += `<h1>${eventName} — In-House Report</h1>`;
    html += `<p class="meta">Member: ${memberName} · Generated: ${new Date().toLocaleDateString()}</p>`;
    if (sItems.length > 0) {
      html += `<h2>Team Schedule</h2><table><tr><th>Time</th><th>Activity</th><th>Assignee</th></tr>`;
      sItems.forEach(i => { html += `<tr><td>${i.time || "--:--"}</td><td>${i.label}</td><td>${i.assignee || "Unassigned"}</td></tr>`; });
      html += `</table>`;
    }
    if (tItems.length > 0) {
      html += `<h2>Tasks</h2><table><tr><th>Task</th><th>Status</th><th>Assignee</th></tr>`;
      tItems.forEach(t => { html += `<tr><td>${t.text}</td><td>${t.done ? "Done" : "Open"}</td><td>${t.assignee || "Unassigned"}</td></tr>`; });
      html += `</table>`;
    }
    if (nItems.length > 0) {
      html += `<h2>Private Notes</h2><table><tr><th>Note</th><th>Assignee</th></tr>`;
      nItems.forEach(n => { html += `<tr><td>${n.text}</td><td>${n.assignee || "Unassigned"}</td></tr>`; });
      html += `</table>`;
    }
    html += `<p style="margin-top:30px;font-size:11px;color:#999">Generated on ${new Date().toLocaleString()}</p></body></html>`;
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300); }
  }

  async function shareInHouseLink(
    memberName: string,
    sItems: { id: string; time: string; label: string; assignee: string }[],
    tItems: { id: string; text: string; done: boolean; assignee: string }[],
    nItems: { id: string; text: string; assignee: string }[],
    eventName: string
  ) {
    try {
      const token = crypto.randomUUID();
      const shareData = {
        type: "in-house",
        eventName,
        memberName,
        scheduleItems: sItems,
        tasks: tItems,
        privateNotes: nItems,
        generatedAt: new Date().toISOString(),
      };
      await insertShareTokenRow({
        token,
        event_id: event.id,
        parties: shareData as unknown,
      });
      const url = `${window.location.origin}/shared/budget/${token}`;
      await navigator.clipboard.writeText(url);
      copyToast("Share link copied!", url);
    } catch (err) {
      console.error("Share error:", err);
      toast({ title: "Failed to generate share link", variant: "destructive" });
    }
  }

  const acceptedCollaborators = useMemo(() =>
    propCollaborators.filter((c) => collaboratorIsActive(c.status)).map((c) => c.name),
    [propCollaborators]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, CrewMember[]>();
    crew.forEach((m) => {
      const key = m.collaborator || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    return map;
  }, [crew]);

  const handleAdd = () => {
    if (!newMember.name.trim()) return;
    setCrew(prev => [...prev, {
      id: `CR-${Date.now()}`,
      name: newMember.name.trim(),
      role: newMember.role.trim(),
      email: newMember.email.trim() || undefined,
      phone: newMember.phone.trim() || undefined,
      collaborator: newMember.collaborator.trim() || undefined,
    }]);
    setNewMember({ name: "", role: "", email: "", phone: "", collaborator: "" });
    setAddOpen(false);
  };

  const [autofillCollaborators, setAutofillCollaborators] = useState<Record<string, string>>({});

  const handleAutofill = (member: { id: string; name: string; email: string; roles: string[] }) => {
    const exists = crew.some(c =>
      (member.email && c.email) ? c.email === member.email : c.name === member.name
    );
    if (exists) {
      toast({ title: "Already added", description: `${member.name} is already in the crew.`, variant: "destructive" });
      return;
    }
    const collabName = autofillToGroup || autofillCollaborators[member.id] || "";
    setCrew(prev => [...prev, {
      id: `CR-${Date.now()}`,
      name: member.name,
      role: member.roles.join(", "),
      email: member.email,
      collaborator: collabName || undefined,
    }]);
    toast({ title: "Member added", description: `${member.name} added from your team directory.` });
  };

  const handleCollaboratorInput = (value: string) => {
    setNewMember(p => ({...p, collaborator: value}));
    if (value.length > 0) {
      const collabMatches = acceptedCollaborators.filter(c => c.toLowerCase().includes(value.toLowerCase()));
      const teamMatches = teamMembers.map(t => t.name).filter(n => n.toLowerCase().includes(value.toLowerCase()));
      setCollabSuggestions(Array.from(new Set([...collabMatches, ...teamMatches])));
    } else {
      setCollabSuggestions([]);
    }
  };

  const toggleSection = (memberId: string, sectionId: string) => {
    setMemberSections(prev => {
      const current = prev[memberId] || [];
      const updated = current.includes(sectionId) ? current.filter(s => s !== sectionId) : [...current, sectionId];
      return { ...prev, [memberId]: updated };
    });
  };

  const tasks = useMemo(() => {
    const allTodos: Array<{ id: string; title: string; completed: boolean; assignee?: string; dueDate?: string }> = eventMeta?.todos || [];
    return allTodos.filter(t => t.assignee && !t.completed).map(t => ({
      id: t.id, text: t.title, done: t.completed, assignee: t.assignee || "",
    }));
  }, [eventMeta?.todos]);

  // ── Create task for crew member ─────────────────────────────────────────────
  const [createTaskForMemberId, setCreateTaskForMemberId] = useState<string | null>(null);
  const [createTaskTitle, setCreateTaskTitle] = useState("");

  const handleCreateTaskForMember = (memberName: string) => {
    if (!createTaskTitle.trim() || !saveProfileTodos) return;
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      title: createTaskTitle.trim(),
      completed: false,
      reminders: [],
      createdAt: new Date().toISOString(),
      assignee: memberName,
    };
    saveProfileTodos([...(profileTodos || []), newTodo]);
    setCreateTaskTitle("");
    setCreateTaskForMemberId(null);
    toast({ title: (<span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Task created for {memberName}</span>), duration: 2000 });
  };

  const sortScheduleByTime = (items: typeof scheduleItems) =>
    [...items].sort((a, b) => a.time.localeCompare(b.time));

  const handleAddScheduleItem = () => {
    if (!newScheduleItem.label.trim()) return;
    setScheduleItems(prev => sortScheduleByTime([...prev, { id: `SI-${Date.now()}`, ...newScheduleItem }]));
    setNewScheduleItem({ time: "", label: "", assignee: "" });
  };

  const handleShareSections = (member: CrewMember) => {
    const sections = memberSections[member.id] || [];
    if (sections.length === 0) {
      toast({ title: "No sections selected", description: "Please select at least one section to share.", variant: "destructive" });
      return;
    }
    const sectionNames = sections.map(s => SHAREABLE_SECTIONS.find(ss => ss.id === s)?.label || s).join(", ");
    const url = `${window.location.origin}/events/${event.id}?tabs=${sections.join(",")}`;
    navigator.clipboard.writeText(url).then(() => {
      copyToast("Link copied!", `Shared ${sectionNames} with ${member.name}`);
    });
    setSharingOpen(null);
  };

  return (
    <div className="space-y-6">
      {/* Section tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveSection("shared")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
            activeSection === "shared" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="h-4 w-4 inline mr-1.5" /> Shared Team
        </button>
        <button
          onClick={() => setActiveSection("inhouse")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
            activeSection === "inhouse" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Shield className="h-4 w-4 inline mr-1.5" /> In-House Management
        </button>
      </div>

      {activeSection === "shared" && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-semibold">Team & Crew</h3>
              <p className="text-sm text-muted-foreground">Visible to all event collaborators</p>
            </div>
            <div className="flex gap-2">
              {teamMembers.length > 0 && (
                <Button variant="outline" className="gap-2" onClick={() => setAutofillOpen(true)}>
                  <Users className="h-4 w-4" /> From Team
                </Button>
              )}
              <Button className="gap-2" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add Member
              </Button>
            </div>
          </div>

          {crew.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No crew members added yet.</p>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([group, members]) => (
              <div key={group} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-muted/30 border-b flex items-center justify-between">
                  {editingGroupName === group ? (
                    <div className="flex items-center gap-1">
                      <Input value={editingGroupNewName} onChange={(e) => setEditingGroupNewName(e.target.value)} className="h-7 w-40 text-xs" placeholder="Group name" />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        const newName = editingGroupNewName.trim();
                        if (newName && newName !== group) {
                          setCrew(prev => prev.map(c => {
                            const currentGroup = c.collaborator || "Unassigned";
                            return currentGroup === group ? { ...c, collaborator: newName } : c;
                          }));
                        }
                        setEditingGroupName(null);
                      }}><Check className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingGroupName(null)}><X className="h-3 w-3" /></Button>
                    </div>
                  ) : (
                    <h4 className="text-sm font-semibold">{group}</h4>
                  )}
                  <div className="flex items-center gap-1">
                    {editingGroupName !== group && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingGroupName(group); setEditingGroupNewName(group === "Unassigned" ? "" : group); }} title="Rename group">
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setAddToGroup(group === "Unassigned" ? "" : group); setNewMember({ name: "", role: "", email: "", phone: "", collaborator: group === "Unassigned" ? "" : group }); setAddOpen(true); }}>
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                        {teamMembers.length > 0 && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setAutofillToGroup(group === "Unassigned" ? "" : group); setAutofillOpen(true); }}>
                            <Users className="h-3 w-3" /> From Team
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="divide-y">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {m.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right text-xs text-muted-foreground">
                          {m.email && <p>{m.email}</p>}
                          {m.phone && <p>{m.phone}</p>}
                        </div>
                        {/* Create task for member */}
                        {saveProfileTodos && (
                          <Popover open={createTaskForMemberId === m.id} onOpenChange={(open) => { if (!open) { setCreateTaskForMemberId(null); setCreateTaskTitle(""); } else { setCreateTaskForMemberId(m.id); } }}>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Create task">
                                <ListTodo className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-3" align="end">
                              <p className="text-xs font-medium mb-2">New task for {m.name}</p>
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="Task title..."
                                  value={createTaskTitle}
                                  onChange={(e) => setCreateTaskTitle(e.target.value)}
                                  className="h-8 text-xs flex-1"
                                  autoFocus
                                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateTaskForMember(m.name); if (e.key === "Escape") { setCreateTaskForMemberId(null); setCreateTaskTitle(""); } }}
                                />
                                <Button size="sm" className="h-8 px-2" disabled={!createTaskTitle.trim()} onClick={() => handleCreateTaskForMember(m.name)}>
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                        {/* Section sharing */}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSharingOpen(sharingOpen === m.id ? null : m.id)} title="Share sections">
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCrew(crew.filter(c => c.id !== m.id))}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {/* Section sharing dropdown for the member */}
                  {members.some(m => sharingOpen === m.id) && (() => {
                    const m = members.find(m => sharingOpen === m.id)!;
                    return (
                      <div className="px-5 py-3 bg-muted/20 border-t space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Share sections with {m.name}:</p>
                        <div className="flex flex-wrap gap-2">
                          {SHAREABLE_SECTIONS.map(s => (
                            <label key={s.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <Checkbox
                                checked={(memberSections[m.id] || []).includes(s.id)}
                                onCheckedChange={() => toggleSection(m.id, s.id)}
                              />
                              {s.label}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => handleShareSections(m)}>
                            <Copy className="h-3 w-3" /> Copy Share Link
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSharingOpen(null)}>Close</Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {activeSection === "inhouse" && (
        <div className="space-y-6">
          <div>
            <h3 className="font-display text-lg font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" /> Private Team Management
            </h3>
            <p className="text-sm text-muted-foreground">Only visible to you. Manage schedules, tasks, and notes for your team.</p>
          </div>

          {/* Team Schedule */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Team Schedule</h4>
              {scheduleItems.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Download className="h-3 w-3" /> Export</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                      const lines = ["Time,Activity,Assignee", ...scheduleItems.map(i => `"${i.time}","${i.label}","${i.assignee || "Unassigned"}"`)];
                      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "team_schedule.csv"; a.click(); URL.revokeObjectURL(url);
                    }}>All Members</DropdownMenuItem>
                    {Array.from(new Set(scheduleItems.filter(i => i.assignee).map(i => i.assignee))).map(name => (
                      <DropdownMenuItem key={name} onClick={() => {
                        const items = scheduleItems.filter(i => i.assignee === name);
                        const lines = ["Time,Activity,Assignee", ...items.map(i => `"${i.time}","${i.label}","${i.assignee}"`)];
                        const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `schedule_${name.replace(/\s/g, "_")}.csv`; a.click(); URL.revokeObjectURL(url);
                      }}>{name}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {scheduleItems.length > 0 && (
              <div className="space-y-2 mb-3">
                {scheduleItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border p-2.5">
                    {editingItemId === item.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input type="time" value={item.time} onChange={(e) => setScheduleItems(s => s.map(si => si.id === item.id ? {...si, time: e.target.value} : si))} onFocus={(e) => e.target.select()} className="w-24 text-xs h-7" />
                        <Input value={item.label} onChange={(e) => setScheduleItems(s => s.map(si => si.id === item.id ? {...si, label: e.target.value} : si))} className="flex-1 text-xs h-7" />
                        <TeamMemberSelect value={item.assignee || ""} onValueChange={(v) => setScheduleItems(s => s.map(si => si.id === item.id ? {...si, assignee: v} : si))} teamMembers={teamMembers} onCreateMember={handleCreateTeamMember} className="w-32 h-7" />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setScheduleItems(prev => sortScheduleByTime(prev)); setEditingItemId(null); }}><Check className="h-3 w-3" /></Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 flex-1">
                          <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{item.time || "--:--"}</span>
                          <span className="text-sm">{item.label}</span>
                          {item.assignee && <Badge variant="outline" className="text-xs">{item.assignee}</Badge>}
                        </div>
                        <div className="flex items-center">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingItemId(item.id)}>
                            <Edit2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScheduleItems(s => s.filter(si => si.id !== item.id))}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input type="time" placeholder="HH:MM" value={newScheduleItem.time} onChange={(e) => setNewScheduleItem(p => ({...p, time: e.target.value}))} onFocus={(e) => e.target.select()} className="w-24 text-xs" />
              <Input placeholder="Task / Activity" value={newScheduleItem.label} onChange={(e) => setNewScheduleItem(p => ({...p, label: e.target.value}))} className="flex-1 text-xs" />
              <TeamMemberSelect value={newScheduleItem.assignee || ""} onValueChange={(v) => setNewScheduleItem(p => ({...p, assignee: v}))} teamMembers={teamMembers} onCreateMember={handleCreateTeamMember} className="w-36" />
              <Button size="icon" onClick={handleAddScheduleItem} disabled={!newScheduleItem.label.trim()}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>

          {/* Tasks — sourced from unified Tasks tab */}
          {(() => {
            const allTodos: Array<{ id: string; title: string; completed: boolean; assignee?: string; dueDate?: string }> = eventMeta?.todos || [];
            const assigned = allTodos.filter(t => t.assignee && !t.completed);
            const byAssignee = assigned.reduce<Record<string, typeof assigned>>((acc, t) => {
              const key = t.assignee!;
              if (!acc[key]) acc[key] = [];
              acc[key].push(t);
              return acc;
            }, {});
            const today = new Date().toISOString().slice(0, 10);
            return (
              <div className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Assigned Tasks</h4>
                  <Link to="/events/$id" params={{ id: event.id }} search={{ tab: "todo" }} className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    Manage in Tasks tab <Plus className="h-3 w-3" />
                  </Link>
                </div>
                {Object.keys(byAssignee).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tasks assigned to team members yet. Add tasks with assignees in the Tasks tab.</p>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(byAssignee).map(([name, items]) => (
                      <div key={name}>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{name}</p>
                        <div className="space-y-1.5">
                          {items.map(t => {
                            const isOverdue = t.dueDate && t.dueDate < today;
                            return (
                              <div key={t.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                                <Checkbox
                                  checked={t.completed}
                                  onCheckedChange={() => {
                                    const updated = (eventMeta?.todos || []).map((todo: Todo) =>
                                      todo.id === t.id ? { ...todo, completed: true, completedAt: new Date().toISOString() } : todo
                                    );
                                    onSave?.({ todos: updated });
                                  }}
                                />
                                <span className="flex-1 text-sm">{t.title}</span>
                                {t.dueDate && (
                                  <span className={cn("text-xs", isOverdue ? "text-destructive" : "text-muted-foreground")}>
                                    {new Date(t.dueDate + "T00:00:00").toLocaleDateString()}
                                    {isOverdue && " · Overdue"}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Private Notes */}
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm flex items-center gap-2"><PenLine className="h-4 w-4" /> Private Notes</h4>
              {privateNotes.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Download className="h-3 w-3" /> Export</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                      const lines = ["Note,Assignee", ...privateNotes.map(n => `"${n.text.replace(/"/g, '""')}","${n.assignee || "Unassigned"}"`)];
                      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "private_notes.csv"; a.click(); URL.revokeObjectURL(url);
                    }}>All Members</DropdownMenuItem>
                    {Array.from(new Set(privateNotes.filter(n => n.assignee).map(n => n.assignee))).map(name => (
                      <DropdownMenuItem key={name} onClick={() => {
                        const items = privateNotes.filter(n => n.assignee === name);
                        const lines = ["Note,Assignee", ...items.map(n => `"${n.text.replace(/"/g, '""')}","${n.assignee}"`)];
                        const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `notes_${name.replace(/\s/g, "_")}.csv`; a.click(); URL.revokeObjectURL(url);
                      }}>{name}</DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {privateNotes.length > 0 && (
              <div className="space-y-2 mb-3">
                {privateNotes.map((note) => (
                  <div key={note.id} className="flex items-center justify-between rounded-lg border p-2.5">
                    {editingItemId === note.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input value={note.text} onChange={(e) => setPrivateNotes(n => n.map(nn => nn.id === note.id ? {...nn, text: e.target.value} : nn))} className="flex-1 text-xs h-7" />
                        <TeamMemberSelect value={note.assignee || ""} onValueChange={(v) => setPrivateNotes(n => n.map(nn => nn.id === note.id ? {...nn, assignee: v} : nn))} teamMembers={teamMembers} onCreateMember={handleCreateTeamMember} className="w-32 h-7" />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingItemId(null)}><Check className="h-3 w-3" /></Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 flex-1">
                          <span className="text-sm">{note.text}</span>
                          {note.assignee && <Badge variant="outline" className="text-xs">{note.assignee}</Badge>}
                        </div>
                        <div className="flex items-center">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingItemId(note.id)}>
                            <Edit2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrivateNotes(n => n.filter(nn => nn.id !== note.id))}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input placeholder="Add a note..." value={newNote.text} onChange={(e) => setNewNote(p => ({...p, text: e.target.value}))} className="flex-1 text-xs" />
              <TeamMemberSelect value={newNote.assignee || ""} onValueChange={(v) => setNewNote(p => ({...p, assignee: v}))} teamMembers={teamMembers} onCreateMember={handleCreateTeamMember} className="w-36" />
              <Button size="icon" onClick={() => {
                if (!newNote.text.trim()) return;
                setPrivateNotes(prev => [...prev, { id: `note-${Date.now()}`, text: newNote.text.trim(), assignee: newNote.assignee }]);
                setNewNote({ text: "", assignee: "" });
              }} disabled={!newNote.text.trim()}><Plus className="h-4 w-4" /></Button>
            </div>
          </div>

          {/* Export All In-House */}
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1"><Download className="h-3.5 w-3.5" /> Share & Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="text-xs font-semibold text-muted-foreground" disabled>PDF Export</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  exportInHousePDF("All Members", scheduleItems, tasks, privateNotes, event.name);
                }}>All Members (PDF)</DropdownMenuItem>
                {Array.from(new Set([
                  ...scheduleItems.filter(i => i.assignee).map(i => i.assignee),
                  ...tasks.filter(t => t.assignee).map(t => t.assignee),
                  ...privateNotes.filter(n => n.assignee).map(n => n.assignee),
                ])).map(name => (
                  <DropdownMenuItem key={`pdf-${name}`} onClick={() => {
                    exportInHousePDF(name,
                      scheduleItems.filter(i => i.assignee === name),
                      tasks.filter(t => t.assignee === name),
                      privateNotes.filter(n => n.assignee === name),
                      event.name);
                  }}>{name} (PDF)</DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-xs font-semibold text-muted-foreground" disabled>Share Link</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  shareInHouseLink("All Members", scheduleItems, tasks, privateNotes, event.name);
                }}><Share2 className="h-3.5 w-3.5 mr-1.5" /> All Members (Link)</DropdownMenuItem>
                {Array.from(new Set([
                  ...scheduleItems.filter(i => i.assignee).map(i => i.assignee),
                  ...tasks.filter(t => t.assignee).map(t => t.assignee),
                  ...privateNotes.filter(n => n.assignee).map(n => n.assignee),
                ])).map(name => (
                  <DropdownMenuItem key={`link-${name}`} onClick={() => {
                    shareInHouseLink(name,
                      scheduleItems.filter(i => i.assignee === name),
                      tasks.filter(t => t.assignee === name),
                      privateNotes.filter(n => n.assignee === name),
                      event.name);
                  }}><Share2 className="h-3.5 w-3.5 mr-1.5" /> {name} (Link)</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); setCollabSuggestions([]); if (!o) setAddToGroup(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Name</Label><Input value={newMember.name} onChange={(e) => setNewMember(p => ({...p, name: e.target.value}))} placeholder="Full name" className="mt-1" /></div>
            <div><Label>Role</Label><Input value={newMember.role} onChange={(e) => setNewMember(p => ({...p, role: e.target.value}))} placeholder="e.g. Sound Engineer, Tour Manager" className="mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={newMember.email} onChange={(e) => setNewMember(p => ({...p, email: e.target.value}))} placeholder="email@example.com" className="mt-1" /></div>
              <div><Label>Phone</Label><Input value={newMember.phone} onChange={(e) => setNewMember(p => ({...p, phone: e.target.value}))} placeholder="+31 ..." className="mt-1" /></div>
            </div>
            <div className="relative">
              <Label>Group / Collaborator Name</Label>
              <p className="text-xs text-muted-foreground mb-1">Type a new name to create a group, or select an existing one. You can rename groups later from the group header.</p>
              <Input value={newMember.collaborator} onChange={(e) => handleCollaboratorInput(e.target.value)} placeholder="Type or search group name..." />
              {collabSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 rounded-md border bg-popover shadow-md">
                  {collabSuggestions.map((s) => (
                    <button key={s} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors" onClick={() => { setNewMember(p => ({...p, collaborator: s})); setCollabSuggestions([]); }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!newMember.name.trim()}>Add Member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Autofill from Team Dialog */}
      <Dialog open={autofillOpen} onOpenChange={(open) => { setAutofillOpen(open); if (!open) setAutofillToGroup(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add from Team Directory{autofillToGroup ? ` → ${autofillToGroup}` : ""}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Select team members to add to this event{autofillToGroup ? ` under "${autofillToGroup}"` : ""}.</p>
          <div className="space-y-2 py-2 max-h-[300px] overflow-y-auto">
            {teamMembers.map(m => {
              const alreadyAdded = crew.some(c =>
                (m.email && c.email) ? c.email === m.email : c.name === m.name
              );
              return (
                <div key={m.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        {m.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.roles.join(", ")} · {m.email}</p>
                      </div>
                    </div>
                    <Button size="sm" variant={alreadyAdded ? "secondary" : "outline"} disabled={alreadyAdded} onClick={() => handleAutofill(m)}>
                      {alreadyAdded ? "Added" : "Add"}
                    </Button>
                  </div>
                  {!alreadyAdded && !autofillToGroup && (
                    <Input
                      value={autofillCollaborators[m.id] || ""}
                      onChange={(e) => setAutofillCollaborators(p => ({ ...p, [m.id]: e.target.value }))}
                      placeholder="Collaborator or Team name (optional)"
                      className="h-7 text-xs"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAutofillOpen(false); setAutofillToGroup(null); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
