import { AlertTriangle, Calendar, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PendingDateChange } from "@/lib/db";
import type { Event } from "@/lib/models";

function formatDateLabel(val: string | undefined): string {
  if (!val) return "—";
  // If it looks like a date (YYYY-MM-DD), format it nicely
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return new Date(val + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return val;
}

interface DateChangeBannerProps {
  event: Event;
  pendingDateChange: PendingDateChange;
  /** The current user's uid */
  currentUid: string;
  /** Profile IDs the current user controls (from event.accessProfileIds intersected with user's profiles) */
  userProfileIds: string[];
  onConfirm: (profileId: string) => void;
  onDecline: (profileId: string) => void;
  onCancel: () => void;
}

export function DateChangeBanner({
  event,
  pendingDateChange,
  currentUid,
  userProfileIds,
  onConfirm,
  onDecline,
  onCancel,
}: DateChangeBannerProps) {
  const isProposer = pendingDateChange.proposedBy === currentUid;
  const isChild = !!event.parentEventId;

  // Find which confirmation entry (if any) belongs to the current user
  const myConfirmationEntry = Object.entries(pendingDateChange.confirmations).find(
    ([profileId]) => userProfileIds.includes(profileId),
  );
  const myProfileId = myConfirmationEntry?.[0];
  const myConfirmation = myConfirmationEntry?.[1];
  const needsMyAction = myConfirmation?.status === "pending";

  const allConfirmationEntries = Object.entries(pendingDateChange.confirmations);
  const allEntries = allConfirmationEntries.map(([, c]) => c);
  const allConfirmed = allEntries.every((c) => c.status === "confirmed");

  // On a child event, only show the current user's own confirmation; other
  // performers' approval state is private to the parent organizer's view.
  const visibleEntries = isChild
    ? allConfirmationEntries
        .filter(([pid]) => userProfileIds.includes(pid))
        .map(([, c]) => c)
    : allEntries;
  const otherPendingCount = isChild
    ? allConfirmationEntries.filter(
        ([pid, c]) => c.status === "pending" && !userProfileIds.includes(pid),
      ).length
    : 0;

  // Off-platform parties the organizer can act on behalf of
  const offPlatformPending = isProposer
    ? allConfirmationEntries.filter(([, c]) => !c.onPlatform && c.status === "pending")
    : [];

  // Build the change summary
  const changes: { label: string; from: string; to: string }[] = [];
  const pv = pendingDateChange.proposedValues;
  const prev = pendingDateChange.previousValues;
  if (pv.date) changes.push({ label: "Date", from: formatDateLabel(prev.date), to: formatDateLabel(pv.date) });
  if (pv.startTime) changes.push({ label: "Start time", from: prev.startTime || "—", to: pv.startTime });
  if (pv.endTime) changes.push({ label: "End time", from: prev.endTime || "—", to: pv.endTime });

  return (
    <div className="rounded-xl border-2 border-amber-400/50 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-500/30 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-amber-100 dark:bg-amber-900/40 p-2 shrink-0 mt-0.5">
          <Calendar className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Date change proposed
              {pendingDateChange.proposedByProfile && (
                <span className="font-normal text-muted-foreground">
                  by {pendingDateChange.proposedByProfile}
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isProposer
                ? "Awaiting confirmation from other parties before the date change takes effect."
                : "A date change has been proposed for this event. Please confirm or decline."}
            </p>
          </div>

          {/* Change details */}
          <div className="flex flex-wrap gap-3">
            {changes.map((c) => (
              <div key={c.label} className="text-sm">
                <span className="text-muted-foreground">{c.label}:</span>{" "}
                <span className="line-through text-muted-foreground/70">{c.from}</span>{" "}
                <span className="font-medium">{c.to}</span>
              </div>
            ))}
          </div>

          {/* Confirmation statuses */}
          <div className="flex flex-wrap gap-2">
            {visibleEntries.map((conf) => (
              <Badge
                key={conf.profileName}
                variant="outline"
                className={
                  conf.status === "confirmed"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                    : conf.status === "declined"
                      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-400"
                      : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                }
              >
                {conf.status === "confirmed" && <Check className="h-3 w-3 mr-1" />}
                {conf.status === "declined" && <X className="h-3 w-3 mr-1" />}
                {conf.profileName} ({conf.role})
                {conf.status === "pending" && " — pending"}
                {conf.status === "confirmed" && " — confirmed"}
                {conf.status === "declined" && " — declined"}
              </Badge>
            ))}
            {isChild && otherPendingCount > 0 && (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
              >
                Awaiting approval from {otherPendingCount} other{" "}
                {otherPendingCount === 1 ? "party" : "parties"}
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {/* On-platform party: confirm/decline for yourself */}
            {needsMyAction && myProfileId && (
              <>
                <Button
                  size="sm"
                  onClick={() => onConfirm(myProfileId)}
                  className="gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" />
                  Confirm date change
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDecline(myProfileId)}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  Decline
                </Button>
              </>
            )}
            {/* Organizer: confirm on behalf of off-platform parties */}
            {offPlatformPending.map(([profileId, conf]) => (
              <Button
                key={profileId}
                size="sm"
                variant="secondary"
                onClick={() => onConfirm(profileId)}
                className="gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                Confirm on behalf of {conf.profileName}
              </Button>
            ))}
            {isProposer && !allConfirmed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                className="text-muted-foreground"
              >
                Cancel proposed change
              </Button>
            )}
          </div>

          {/* Off-platform notice */}
          {!isChild && allEntries.some((c) => !c.onPlatform && c.status === "pending") && (
            <p className="text-xs text-muted-foreground italic">
              Some parties are not on the platform yet. You can confirm on their behalf, or an email confirmation will be sent (coming soon).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
