import { useState, useEffect } from "react";
import { format } from "date-fns";
import { CalendarItem, CalendarItemType, calendarItemTypeLabels } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface ProfileOption {
  id: string;
  name: string;
}

export interface MemberOption {
  uid: string;
  name: string;
}

export function CalendarItemFormDialog({ type, defaultDate, defaultStartTime, onAdd, open, onOpenChange, profiles, members, currentUserUid, currentUserName, editingItem }: {
  type: CalendarItemType;
  defaultDate: Date;
  defaultStartTime?: string;
  onAdd: (item: CalendarItem) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profiles?: ProfileOption[];
  members?: MemberOption[];
  currentUserUid?: string;
  currentUserName?: string;
  /** When set, pre-fills the form for editing an existing item. */
  editingItem?: CalendarItem;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(format(defaultDate, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(defaultStartTime || "");
  const [endTime, setEndTime] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [assigneeUid, setAssigneeUid] = useState<string>(currentUserUid || "");

  useEffect(() => {
    if (open) {
      if (editingItem) {
        setTitle(editingItem.title);
        setDescription(editingItem.description || "");
        setDate(editingItem.date);
        setStartTime(editingItem.startTime || "");
        setEndTime(editingItem.endTime || "");
        setSelectedProfileId(editingItem.profileId || "");
        setAssigneeUid(editingItem.assigneeUid || currentUserUid || "");
      } else {
        setDate(format(defaultDate, "yyyy-MM-dd"));
        setTitle(""); setDescription("");
        setStartTime(defaultStartTime || "");
        setEndTime("");
        setSelectedProfileId("");
        setAssigneeUid(currentUserUid || "");
      }
    }
  }, [open, defaultDate, defaultStartTime, currentUserUid, editingItem]);

  const assigneeName = selectedProfileId
    ? (members?.find(m => m.uid === assigneeUid)?.name || currentUserName || "")
    : undefined;

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd({
      id: editingItem?.id || `CI-${Date.now()}`,
      type,
      title: title.trim(),
      date,
      description: description.trim() || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      profileId: selectedProfileId || undefined,
      assigneeUid: selectedProfileId ? (assigneeUid || currentUserUid) : undefined,
      assigneeName: selectedProfileId ? assigneeName : undefined,
    });
    onOpenChange(false);
  };

  const hasProfiles = profiles && profiles.length > 0;
  const isEdit = !!editingItem;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "Edit" : "New"} {calendarItemTypeLabels[type]}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${calendarItemTypeLabels[type]} title...`} className="mt-1" /></div>
          <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start Time</Label><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1" /></div>
            <div><Label>End Time</Label><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1" /></div>
          </div>
          <div><Label>Description (optional)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add details..." className="mt-1" rows={3} /></div>

          {hasProfiles && (
            <div>
              <Label>Profile (optional)</Label>
              <Select value={selectedProfileId || "_personal"} onValueChange={(v) => { setSelectedProfileId(v === "_personal" ? "" : v); setAssigneeUid(currentUserUid || ""); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Personal (only you)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_personal">Personal (only you)</SelectItem>
                  {profiles!.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedProfileId ? "Visible to all members of this profile" : "Only visible to you"}
              </p>
            </div>
          )}

          {selectedProfileId && members && members.length > 0 && (
            <div>
              <Label>Assignee</Label>
              <Select value={assigneeUid} onValueChange={setAssigneeUid}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select assignee" /></SelectTrigger>
                <SelectContent>
                  {members.map(m => (
                    <SelectItem key={m.uid} value={m.uid}>{m.name}{m.uid === currentUserUid ? " (you)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>{isEdit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
