import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { createVenueHandoffDraft } from "@/lib/createVenueHandoffDraft";

/**
 * Free-Artist-side dialog that converts an incoming booking-request card into
 * a draft event + invitation to the named venue to take over management.
 *
 * The performer never becomes host (rules wouldn't allow it). Instead, an
 * unclaimed venue stub profile is created — performer owns it transiently —
 * and ownership transfers to the venue when they accept the invitation code.
 * See `createVenueHandoffDraft` for the full data shape.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  performerProfileId: string;
  performerName: string;
  /** Prefill from the booking request. */
  defaultVenueName: string;
  defaultVenueEmail: string;
  defaultDate: string;
  defaultFee?: number | null;
  sourceRequestId?: string;
  onCreated?: (eventId: string) => void;
}

export default function CreateDraftWithVenueHandoffDialog({
  open,
  onOpenChange,
  performerProfileId,
  performerName,
  defaultVenueName,
  defaultVenueEmail,
  defaultDate,
  defaultFee,
  sourceRequestId,
  onCreated,
}: Props) {
  const queryClient = useQueryClient();

  const [venueName, setVenueName] = useState(defaultVenueName);
  const [venueEmail, setVenueEmail] = useState(defaultVenueEmail);
  const [message, setMessage] = useState("");

  // Refresh state when a different request opens the dialog.
  useEffect(() => {
    if (open) {
      setVenueName(defaultVenueName);
      setVenueEmail(defaultVenueEmail);
      setMessage("");
    }
  }, [open, defaultVenueName, defaultVenueEmail]);

  const mutation = useMutation({
    mutationFn: async () => {
      // Email + in-app notification fire from the
      // `onVenueHandoffInvitationCreated` Firestore trigger — keeps email
      // delivery in one place and makes it idempotent (one email per code).
      return await createVenueHandoffDraft({
        performerProfileId,
        performerName,
        venueName,
        venueEmail,
        date: defaultDate,
        artistFee: defaultFee,
        message,
        sourceRequestId,
        queryClient,
      });
    },
    onSuccess: (res) => {
      toast({
        title: "Draft created, invitation sent",
        description: `${venueName} has been invited to manage the event.`,
      });
      onOpenChange(false);
      onCreated?.(res.eventId);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not create draft",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit =
    !!venueName.trim() &&
    !!venueEmail.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(venueEmail.trim()) &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!mutation.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create draft event & invite venue</DialogTitle>
          <DialogDescription>
            We&apos;ll create a draft event for <strong>{defaultDate}</strong> and email the venue an
            invitation to take over and manage the booking on shoWMe.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Venue name *</Label>
            <Input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder="The venue name"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Venue email *</Label>
            <Input
              type="email"
              value={venueEmail}
              onChange={(e) => setVenueEmail(e.target.value)}
              placeholder="venue@example.com"
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The invitation link goes here. If the venue already has a shoWMe account, this
              must be the email on file.
            </p>
          </div>
          <div>
            <Label className="text-xs">Message (optional)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Tell the venue why you're interested in this date…"
              className="mt-1 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit} className="gap-1.5">
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Send className="h-3.5 w-3.5" /> Create & invite
              </>
            )}
          </Button>
        </DialogFooter>
        {!mutation.isPending && (
          <p className="text-[10px] text-muted-foreground text-center -mt-2">
            <Mail className="h-3 w-3 inline mr-1" />
            Mollie self-serve isn&apos;t live yet — handoff invitations go out via shoWMe email.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
