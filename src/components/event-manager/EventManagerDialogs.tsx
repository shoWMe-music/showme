import { useState, useEffect } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { isPrimaryEventOwner } from "@/lib/eventPermissions";
import { createPerformerInvitation, sendPerformerInvitationEmail } from "@/lib/createPerformerInvitation";
import type { Event as AppEvent, EventStatus } from "@/lib/models";
import type { User } from "firebase/auth";
import type { QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

// ── Mark as Active / Suggest to Performer dialog (single performer) ──────────

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
): { targetStatus: EventStatus; description: string } {
  const fromRequest = !!sourceRequestId;

  if (event.eventStatus === "suggested") {
    return {
      targetStatus: "pending",
      description: "This will advance the event to Pending, indicating you're moving forward. The performer will be notified of the status change.",
    };
  }

  const dateChanged = fromRequest && sourceRequestDate && event.date !== sourceRequestDate;
  const targetStatus: EventStatus = fromRequest && !dateChanged ? "pending" : "suggested";

  if (fromRequest && dateChanged) {
    return {
      targetStatus,
      description: `The date was changed from the original request (${sourceRequestDate}), so this will be sent as a counter-proposal. The performer can accept or decline the new date.`,
    };
  }
  if (fromRequest) {
    return {
      targetStatus,
      description: "This accepts the booking request as-is. The event will move to Pending.",
    };
  }

  // No performer linked + no booking request: routed to InviteCollaboratorDialog
  // upstream, so this dialog is only used when a performer is on the platform.
  return {
    targetStatus,
    description: "This performer is already on shoWMe. They will be notified about this event.",
  };
}

export function MarkPendingDialog({
  open, onOpenChange, event, sourceRequestId, sourceRequestDate, updateEvent,
}: MarkPendingDialogProps) {
  const [notify, setNotify] = useState(true);

  const { targetStatus, description } = resolveActivation(event, sourceRequestId, sourceRequestDate);

  const fromRequest = !!sourceRequestId;
  const dateChanged = fromRequest && sourceRequestDate && event.date !== sourceRequestDate;
  const isAcceptingRequest = fromRequest && !dateChanged && event.eventStatus === "draft";
  const onPlatform = !!event.performerProfileId;

  const title = event.eventStatus === "suggested"
    ? "Mark as Pending"
    : isAcceptingRequest
      ? "Accept Request"
      : dateChanged
        ? "Counter-Propose"
        : "Notify Performer";

  const buttonLabel = event.eventStatus === "suggested"
    ? "Mark as Pending"
    : isAcceptingRequest
      ? "Accept Request"
      : dateChanged
        ? "Send Counter-Proposal"
        : "Suggest to Performer";

  const handleConfirm = () => {
    updateEvent(event.id, {
      eventStatus: targetStatus,
      ...(notify ? { notifyPerformerOnActivation: true } : {}),
    } as Partial<AppEvent>);

    const msg = notify
      ? (onPlatform ? "The performer has been notified." : "An invitation will be sent.")
      : "No notification will be sent.";
    toast({ title: isAcceptingRequest ? "Request accepted" : `Event marked as ${targetStatus}`, description: msg });
    onOpenChange(false);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) setNotify(true);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{description}</p>
              <p>You can still make changes after this.</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3">
            <Switch id="notify-toggle" checked={notify} onCheckedChange={setNotify} />
            <Label htmlFor="notify-toggle" className="cursor-pointer font-normal text-foreground text-sm">
              {onPlatform ? "Notify performer" : "Send email invitation"}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
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
  user: User | null;
  eventName: string;
  queryClient: QueryClient;
  onCollaboratorAdded?: () => void;
  senderName: string;
}

export function SuggestToPerformersDialog({
  open, onOpenChange, parentEventId, childEvents, updateEvent,
  user, eventName, queryClient, onCollaboratorAdded, senderName,
}: SuggestToPerformersDialogProps) {
  const draftChildren = childEvents.filter(c => c.eventStatus === "draft");
  const alreadySuggested = childEvents.filter(c => c.eventStatus !== "draft");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notifyIds, setNotifyIds] = useState<Set<string>>(new Set());
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});
  const [messageMap, setMessageMap] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      const draftIds = new Set(draftChildren.map(c => c.id));
      setSelectedIds(draftIds);
      setNotifyIds(new Set(draftIds));
      setEmailMap({});
      setMessageMap({});
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const handleConfirm = async () => {
    if (!user) return;
    setSending(true);

    const selectedChildren = draftChildren.filter(c => selectedIds.has(c.id));
    const needsInvite = selectedChildren.filter(c => !c.performerProfileId);
    const onPlatform = selectedChildren.filter(c => !!c.performerProfileId);

    // Create invitations for off-platform performers
    const results = await Promise.allSettled(
      needsInvite.map(async (child) => {
        const childEmail = emailMap[child.id]?.trim();
        if (!childEmail) return;

        const result = await createPerformerInvitation({
          eventId: child.id,
          email: childEmail,
          displayName: child.artist || childEmail.split("@")[0],
          userUid: user.uid,
          queryClient,
          message: messageMap[child.id]?.trim(),
          onCollaboratorAdded,
        });

        if (result && notifyIds.has(child.id)) {
          await sendPerformerInvitationEmail({
            code: result.code,
            recipientEmail: childEmail,
            recipientName: child.artist || childEmail.split("@")[0],
            eventName,
            senderName,
            message: messageMap[child.id]?.trim() || undefined,
          });
        }

        return result;
      }),
    );

    const failures = results.filter(r => r.status === "rejected");
    if (failures.length > 0) {
      console.error("Some invitations failed:", failures);
    }

    // Update statuses for all selected children
    for (const child of selectedChildren) {
      updateEvent(child.id, {
        eventStatus: "suggested",
        ...(child.performerProfileId && notifyIds.has(child.id) ? { notifyPerformerOnActivation: true } : {}),
      } as Partial<AppEvent>);
    }
    updateEvent(parentEventId, { eventStatus: "suggested" });

    const invitedCount = needsInvite.filter(c => emailMap[c.id]?.trim()).length;
    const notifiedCount = onPlatform.filter(c => notifyIds.has(c.id)).length;
    const parts: string[] = [];
    if (invitedCount > 0) parts.push(`${invitedCount} invited`);
    if (notifiedCount > 0) parts.push(`${notifiedCount} notified`);
    toast({
      title: "Performers updated",
      description: parts.length > 0
        ? `${selectedIds.size} performer${selectedIds.size === 1 ? "" : "s"} marked as suggested (${parts.join(", ")}).`
        : `${selectedIds.size} performer${selectedIds.size === 1 ? "" : "s"} marked as suggested.`,
    });

    setSending(false);
    onOpenChange(false);
  };

  // All off-platform selected performers must have an email
  const offPlatformSelected = draftChildren.filter(c => selectedIds.has(c.id) && !c.performerProfileId);
  const allOffPlatformHaveEmail = offPlatformSelected.length === 0 || offPlatformSelected.every(c => emailMap[c.id]?.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Invite Performers</DialogTitle>
          <DialogDescription>
            Send invitations to performers. Performers already on shoWMe will be notified directly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto flex-1 min-h-0 py-1">
          {draftChildren.map(child => {
            const isSelected = selectedIds.has(child.id);
            const isNotified = notifyIds.has(child.id);
            const onPlatform = !!child.performerProfileId;
            return (
              <div key={child.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(child.id)}
                    className="h-4 w-4 rounded border-input accent-primary shrink-0 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{child.artist}</p>
                    {child.roomStage && <p className="text-xs text-muted-foreground">{child.roomStage}</p>}
                    {onPlatform && (
                      <p className="text-xs text-green-600">On shoWMe — will be notified</p>
                    )}
                  </div>
                  {isSelected && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        checked={isNotified}
                        onCheckedChange={() => toggleNotify(child.id)}
                        className="scale-75"
                      />
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {onPlatform ? "Notify" : "Send email"}
                      </span>
                    </div>
                  )}
                </div>
                {isSelected && !onPlatform && (
                  <div className="space-y-2 pl-7">
                    <Input
                      type="email"
                      placeholder="Email (required)"
                      value={emailMap[child.id] || ""}
                      onChange={e => setEmailMap(prev => ({ ...prev, [child.id]: e.target.value }))}
                    />
                    <Textarea
                      placeholder="Personal message (optional)"
                      value={messageMap[child.id] || ""}
                      onChange={e => setMessageMap(prev => ({ ...prev, [child.id]: e.target.value }))}
                      rows={2}
                      className="text-sm"
                    />
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
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={selectedIds.size === 0 || !allOffPlatformHaveEmail || sending}>
            {sending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending...</>
            ) : (
              `Send ${selectedIds.size > 0 ? `${selectedIds.size} ` : ""}Invitation${selectedIds.size !== 1 ? "s" : ""}`
            )}
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
