import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Mail, Send } from "lucide-react";
import { Link } from "@tanstack/react-router";

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
import {
  getMissingPerformerFields,
  performerFieldLabel,
} from "@/lib/profileCompleteness";
import type { SharedProfile } from "@/lib/user-context";
import {
  FREE_ARTIST_COLLAB_INVITE_CREDITS,
  isPaidPlan,
  useProfilePlan,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * Free-Artist-side dialog that converts an incoming booking-request card into
 * a draft event + invitation to the named venue to take over management.
 *
 * The performer never becomes host (rules wouldn't allow it). Instead, an
 * unclaimed venue stub profile is created — performer owns it transiently —
 * and ownership transfers to the venue when they accept the invitation code.
 * See `createVenueHandoffDraft` for the full data shape.
 *
 * Profile gate: send is blocked until the performer profile has all the
 * fields a venue would expect to see when reviewing a cold invitation. See
 * `getMissingPerformerFields` for the canonical list.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  performerProfile: SharedProfile;
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
  performerProfile,
  defaultVenueName,
  defaultVenueEmail,
  defaultDate,
  defaultFee,
  sourceRequestId,
  onCreated,
}: Props) {
  const performerProfileId = performerProfile.id ?? "";
  const performerName = performerProfile.name ?? "";
  const missingFields = useMemo(
    () => getMissingPerformerFields(performerProfile),
    [performerProfile],
  );
  const profileIncomplete = missingFields.length > 0;
  const queryClient = useQueryClient();

  const { plan } = useProfilePlan(performerProfileId);
  const planType = plan?.type ?? "free_artist";
  const inviteLimited = !isPaidPlan(planType);
  const credits =
    plan?.collabInviteCredits ?? FREE_ARTIST_COLLAB_INVITE_CREDITS;
  const suspended = plan?.collabInviteSuspended === true;
  const noCredits = inviteLimited && credits <= 0;

  const [venueName, setVenueName] = useState(defaultVenueName);
  const [venueEmail, setVenueEmail] = useState(defaultVenueEmail);
  const [message, setMessage] = useState("");
  const [attested, setAttested] = useState(false);

  // Refresh state when a different request opens the dialog.
  useEffect(() => {
    if (open) {
      setVenueName(defaultVenueName);
      setVenueEmail(defaultVenueEmail);
      setMessage("");
      setAttested(false);
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
    !profileIncomplete &&
    !noCredits &&
    !suspended &&
    attested &&
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
        {inviteLimited && !profileIncomplete && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs flex items-center justify-between gap-3",
              suspended
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : noCredits
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : credits <= 3
                    ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            <span>
              {suspended
                ? "Collaborate invites are temporarily disabled following spam reports. The offer flow is still available."
                : noCredits
                  ? "You're out of collaborate-invite credits. Credits refill when an invite is accepted."
                  : `${credits} collaborate-invite ${credits === 1 ? "credit" : "credits"} remaining (refills +1 per acceptance)`}
            </span>
          </div>
        )}

        {profileIncomplete && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="flex items-start gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Complete your profile to send
            </p>
            <p className="mt-1 leading-snug">
              Venues see your shoWMe profile when they get this invite. Add the missing pieces so they have what they need to say yes:
            </p>
            <ul className="mt-1.5 ml-5 list-disc space-y-0.5">
              {missingFields.map((f) => (
                <li key={f}>{performerFieldLabel(f)}</li>
              ))}
            </ul>
            {performerProfileId && (
              <Link
                to="/profiles/$profileId/edit"
                params={{ profileId: performerProfileId }}
                className="mt-2 inline-block font-medium underline underline-offset-2"
                onClick={() => onOpenChange(false)}
              >
                Edit my profile →
              </Link>
            )}
          </div>
        )}
        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Venue name *</Label>
            <Input
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder="The venue name"
              className="mt-1"
              disabled={profileIncomplete}
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
              disabled={profileIncomplete}
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
              disabled={profileIncomplete}
            />
          </div>
        </div>

        {!profileIncomplete && !noCredits && !suspended && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800/60 dark:bg-amber-950/40">
            <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1.5">
              Collaborate invites are for warm relationships only.
            </p>
            <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80 leading-snug">
              Only invite a venue you&apos;ve already been in contact with about this event.
              If you have not had a prior conversation, send an Offer instead. Abuse will
              result in account suspension or deletion.
            </p>
            <label className="mt-2 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5 accent-amber-700"
              />
              <span className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
                I confirm we&apos;ve already discussed this event.
              </span>
            </label>
          </div>
        )}

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
