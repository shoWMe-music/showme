import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { httpsCallable } from "firebase/functions";
import { Loader2, Mail, Send, Trash2, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { toast } from "@/hooks/use-toast";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { useAuth } from "@/lib/auth-context";
import { useUser } from "@/lib/user-context";
import type { Event as AppEvent } from "@/lib/models";

/**
 * Inline banner shown on an event that's waiting for a venue to accept the
 * management handoff. Performer-side actions: resend, redirect (change
 * recipient), cancel (delete draft + revoke code).
 *
 * Only renders the action buttons when the viewer can manage the handoff —
 * for the venue side (or anyone else viewing), it's read-only.
 */
export function VenueHandoffBanner({
  event,
  onCancelled,
}: {
  event: AppEvent;
  onCancelled?: () => void;
}) {
  const { user } = useAuth();
  const { profiles } = useUser();
  const queryClient = useQueryClient();

  const [resendOpen, setResendOpen] = useState(false);
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectEmail, setRedirectEmail] = useState("");
  const [redirectName, setRedirectName] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  // The performer who initiated this handoff is the only one with a manage
  // button. Match on either:
  //   - the user is owner/admin of the createdByProfileId profile
  //   - the user owns the (transient) host stub profile
  const canManage = useMemo(() => {
    if (!user?.uid) return false;
    const performerProfileId = event.createdByProfileId;
    const hostProfileId = event.hostProfileId;
    for (const p of Object.values(profiles)) {
      if (!p.id) continue;
      const ownerMatch = p.owner_uid === user.uid;
      if (!ownerMatch) continue;
      if (performerProfileId && p.id === performerProfileId) return true;
      if (hostProfileId && p.id === hostProfileId) return true;
    }
    return false;
  }, [event.createdByProfileId, event.hostProfileId, profiles, user?.uid]);

  const resendMutation = useMutation({
    mutationFn: async () => {
      const fn = httpsCallable<{ eventId: string }, { ok: true; code: string }>(
        getFirebaseFunctions(),
        "resendVenueHandoffInvitation",
      );
      await fn({ eventId: event.id });
    },
    onSuccess: () => {
      toast({
        title: "Invitation resent",
        description: `Re-sent to ${event.pendingHostHandoffInviteEmail ?? "the venue"}.`,
      });
      setResendOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Resend failed", description: err.message, variant: "destructive" });
    },
  });

  const redirectMutation = useMutation({
    mutationFn: async () => {
      const fn = httpsCallable<
        { eventId: string; newEmail: string; newName?: string },
        { ok: true; code: string }
      >(getFirebaseFunctions(), "redirectVenueHandoff");
      await fn({
        eventId: event.id,
        newEmail: redirectEmail.trim(),
        newName: redirectName.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({
        title: "Invitation sent to new recipient",
        description: redirectEmail.trim(),
      });
      setRedirectOpen(false);
      setRedirectEmail("");
      setRedirectName("");
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not redirect", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const fn = httpsCallable<{ eventId: string }, { ok: true }>(
        getFirebaseFunctions(),
        "cancelVenueHandoff",
      );
      await fn({ eventId: event.id });
    },
    onSuccess: () => {
      toast({ title: "Draft cancelled", description: "The invitation has been revoked." });
      setCancelOpen(false);
      // Event no longer exists — invalidate list caches so the parent page
      // doesn't try to render a dead doc.
      queryClient.invalidateQueries({ queryKey: ["events"] });
      onCancelled?.();
    },
    onError: (err: Error) => {
      toast({ title: "Could not cancel", description: err.message, variant: "destructive" });
    },
  });

  const busy = resendMutation.isPending || redirectMutation.isPending || cancelMutation.isPending;

  const validRedirectEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(redirectEmail.trim());

  return (
    <div className="mb-6 rounded-xl border border-amber-400/40 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-500/30 p-5">
      <div className="flex items-start gap-3">
        <Mail className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            Waiting for venue to take over
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            An invitation has been sent to{" "}
            <span className="font-medium text-foreground">
              {event.pendingHostHandoffInviteEmail || "the venue"}
            </span>{" "}
            to manage this event on shoWMe. The event stays as a draft until they accept —
            once they do, the venue becomes the host and you remain a collaborator.
          </p>
          {canManage && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setResendOpen(true)}
                disabled={busy}
              >
                <Send className="h-3.5 w-3.5" /> Resend invitation
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  setRedirectEmail("");
                  setRedirectName("");
                  setRedirectOpen(true);
                }}
                disabled={busy}
              >
                <UserCog className="h-3.5 w-3.5" /> Send to different venue
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => setCancelOpen(true)}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" /> Cancel draft
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Resend confirm */}
      <AlertDialog open={resendOpen} onOpenChange={(o) => { if (!busy) setResendOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-send the venue invitation email to{" "}
              <strong>{event.pendingHostHandoffInviteEmail}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resendMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); resendMutation.mutate(); }}
              disabled={resendMutation.isPending}
            >
              {resendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Redirect dialog */}
      <Dialog open={redirectOpen} onOpenChange={(o) => { if (!busy) setRedirectOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send invitation to different venue</DialogTitle>
            <DialogDescription>
              We&apos;ll update the pending invitation and email the new recipient. The
              invitation code stays the same — the previous recipient&apos;s link won&apos;t work anymore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs">New venue email *</Label>
              <Input
                type="email"
                value={redirectEmail}
                onChange={(e) => setRedirectEmail(e.target.value)}
                placeholder="venue@example.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">New venue name (optional)</Label>
              <Input
                value={redirectName}
                onChange={(e) => setRedirectName(e.target.value)}
                placeholder="Leave blank to keep current name"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedirectOpen(false)} disabled={redirectMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => redirectMutation.mutate()}
              disabled={!validRedirectEmail || redirectMutation.isPending}
              className="gap-1.5"
            >
              {redirectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" /> Send
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={(o) => { if (!busy) setCancelOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft event will be deleted and the venue invitation revoked. If the venue
              has a shoWMe account, they&apos;ll get a notification that the invitation was cancelled.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); cancelMutation.mutate(); }}
              disabled={cancelMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
