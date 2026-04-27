import { useState, useEffect } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { isPrimaryEventOwner } from "@/lib/eventPermissions";
import type { Event as AppEvent, EventStatus } from "@/lib/models";
import type { User } from "firebase/auth";
import { useNavigate } from "@tanstack/react-router";

// ── Mark as Active dialog ─────────────────────────────────────────────────────

interface MarkPendingDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: AppEvent;
  sourceRequestId: string | undefined;
  sourceRequestDate: string | undefined;
  updateEvent: (id: string, updates: Partial<AppEvent>) => void;
}

function resolveActivation(
  event: AppEvent,
  sourceRequestId: string | undefined,
  sourceRequestDate: string | undefined,
): { targetStatus: EventStatus; notifyLabel: string; description: string } {
  const performerInSystem = !!event.performerProfileId;
  const fromRequest = !!sourceRequestId;

  // Suggested → always advances to Pending
  if (event.eventStatus === "suggested") {
    return {
      targetStatus: "pending",
      notifyLabel: "Notify performer",
      description: "This will advance the event to Pending, indicating you're moving forward. The performer will be notified of the status change.",
    };
  }

  // Draft → pending only if from a request AND the date matches what was requested
  const dateChanged = fromRequest && sourceRequestDate && event.date !== sourceRequestDate;
  const targetStatus: EventStatus = fromRequest && !dateChanged ? "pending" : "suggested";

  let description: string;
  if (fromRequest && dateChanged) {
    description = `The date was changed from the original request (${sourceRequestDate}), so this will be sent as a counter-proposal. The performer can accept or decline the new date.`;
  } else if (fromRequest) {
    description = "This accepts the booking request as-is. The event will move to Pending.";
  } else {
    description = "This will suggest the event to the performer. They'll see it in their incoming requests and can accept or decline.";
  }

  return {
    targetStatus,
    notifyLabel: performerInSystem ? "Notify performer" : "Send email invitation",
    description,
  };
}

export function MarkPendingDialog({ open, onOpenChange, event, sourceRequestId, sourceRequestDate, updateEvent }: MarkPendingDialogProps) {
  const [notify, setNotify] = useState(true);
  const { targetStatus, notifyLabel, description } = resolveActivation(event, sourceRequestId, sourceRequestDate);

  const fromRequest = !!sourceRequestId;
  const dateChanged = fromRequest && sourceRequestDate && event.date !== sourceRequestDate;
  const isAcceptingRequest = fromRequest && !dateChanged && event.eventStatus === "draft";

  const title = event.eventStatus === "suggested"
    ? "Mark as Pending"
    : isAcceptingRequest
      ? "Accept Request"
      : dateChanged
        ? "Counter-Propose"
        : "Suggest to Performer";

  const buttonLabel = event.eventStatus === "suggested"
    ? "Mark as Pending"
    : isAcceptingRequest
      ? "Accept Request"
      : dateChanged
        ? "Send Counter-Proposal"
        : "Send Suggestion";

  const handleConfirm = () => {
    updateEvent(event.id, {
      eventStatus: targetStatus,
      ...(notify ? { notifyPerformerOnActivation: true } : {}),
    } as Partial<AppEvent>);
    const msg = notify
      ? (event.performerProfileId ? "The performer has been notified." : "An invitation will be sent.")
      : "No notification will be sent.";
    toast({ title: isAcceptingRequest ? "Request accepted" : `Event marked as ${targetStatus}`, description: msg });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setNotify(true); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>{description}</p>
              <p>You can still make changes after this.</p>
              <div className="flex items-center gap-3 pt-1">
                <Switch id="notify-toggle" checked={notify} onCheckedChange={setNotify} />
                <Label htmlFor="notify-toggle" className="cursor-pointer font-normal text-foreground">
                  {notifyLabel}
                </Label>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm}>{buttonLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Suggest to Performers dialog (multi-performer parent events) ─────────────

interface SuggestToPerformersDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parentEventId: string;
  childEvents: AppEvent[];
  updateEvent: (id: string, updates: Partial<AppEvent>) => void;
}

export function SuggestToPerformersDialog({ open, onOpenChange, parentEventId, childEvents, updateEvent }: SuggestToPerformersDialogProps) {
  const draftChildren = childEvents.filter(c => c.eventStatus === "draft");
  const alreadySuggested = childEvents.filter(c => c.eventStatus !== "draft");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(draftChildren.map(c => c.id)));
  const [notifyIds, setNotifyIds] = useState<Set<string>>(() => new Set(draftChildren.map(c => c.id)));

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setNotifyIds(n => { const nn = new Set(n); nn.delete(id); return nn; });
      } else {
        next.add(id);
        setNotifyIds(n => new Set(n).add(id));
      }
      return next;
    });
  };

  const toggleNotify = (id: string) => {
    setNotifyIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Reset selections when the dialog opens (draftChildren may have changed since last close)
  useEffect(() => {
    if (open) {
      const draftIds = new Set(draftChildren.map(c => c.id));
      setSelectedIds(draftIds);
      setNotifyIds(new Set(draftIds));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleConfirm = () => {
    for (const childId of selectedIds) {
      updateEvent(childId, {
        eventStatus: "suggested",
        ...(notifyIds.has(childId) ? { notifyPerformerOnActivation: true } : {}),
      } as Partial<AppEvent>);
    }
    // Also advance the parent event to "suggested" if it's still in draft
    updateEvent(parentEventId, { eventStatus: "suggested" });
    const notifiedCount = [...selectedIds].filter(id => notifyIds.has(id)).length;
    toast({
      title: "Suggestions sent",
      description: notifiedCount > 0
        ? `${selectedIds.size} performer${selectedIds.size === 1 ? "" : "s"} invited, ${notifiedCount} notified.`
        : `${selectedIds.size} performer${selectedIds.size === 1 ? "" : "s"} invited. No notifications sent.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggest to Performers</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>Select which performers to invite. You can choose whether to notify each performer.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-64 overflow-y-auto py-1">
          {draftChildren.map(child => {
            const isSelected = selectedIds.has(child.id);
            const isNotified = notifyIds.has(child.id);
            return (
              <div key={child.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(child.id)}
                  className="h-4 w-4 rounded border-input accent-primary shrink-0 cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{child.artist}</p>
                  {child.roomStage && <p className="text-xs text-muted-foreground">{child.roomStage}</p>}
                </div>
                {isSelected && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={isNotified}
                      onCheckedChange={() => toggleNotify(child.id)}
                      className="scale-75"
                    />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {child.performerProfileId ? "Notify" : "Email"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {alreadySuggested.map(child => (
            <div key={child.id} className="flex items-center gap-3 rounded-lg border p-3 opacity-50">
              <input type="checkbox" checked disabled className="h-4 w-4 rounded border-input" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{child.artist}</p>
                <p className="text-xs text-muted-foreground">Already {child.eventStatus}</p>
              </div>
            </div>
          ))}
          {childEvents.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No performers added yet. Add performers in the Event Details tab first.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
            Send {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}Suggestion{selectedIds.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Archive dialog ────────────────────────────────────────────────────────────

interface ArchiveDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  event: AppEvent;
  user: User | null;
  archiveMutate: (args: { id: string }) => void;
}

export function ArchiveDialog({ open, onOpenChange, eventId, event, user, archiveMutate }: ArchiveDialogProps) {
  const navigate = useNavigate();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Event</AlertDialogTitle>
          <AlertDialogDescription>
            This will archive the event. Are you sure you want to delete this event?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            if (!user?.uid) return;
            if (!isPrimaryEventOwner(event, user.uid)) {
              toast({ title: "Permission denied", description: "Only the primary event owner can archive this event.", variant: "destructive" });
              return;
            }
            archiveMutate({ id: eventId });
            navigate({ to: "/events" });
          }}>
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
