import { Fragment, useMemo, useState } from "react";
import { Crown, Sparkles, Mail, Users as UsersIcon, Calendar as CalendarIcon, Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

import { useAuth } from "@/lib/auth-context";
import { useUser, type SharedProfile } from "@/lib/user-context";
import {
  PLAN_LABELS,
  isPaidPlan,
  isOperatorPlan,
  isArtistPlan,
  useProfilePlan,
  type PlanType,
  type ProfilePlan,
} from "@/lib/plans";

/**
 * True iff the plan doc is well-formed enough to render — guards against
 * partial / legacy docs that have a status but a missing or unknown `type`
 * field (the cap-maintenance trigger writes only `eventCapBlocked` /
 * `eventCapCount`, which can leave a stub doc on profiles that lost their
 * type during an earlier test). Treat malformed docs as "no plan" so the
 * UI falls back to the default-Free copy and the owner can re-request.
 */
function isWellFormedPlan(plan: ProfilePlan | null | undefined): plan is ProfilePlan {
  if (!plan) return false;
  return plan.type in PLAN_LABELS;
}
import { useEventCapStatus } from "@/lib/eventCap";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/integrations/firebase/app";

// ────────────────────────────────────────────────────────────────────────────
// Top-level page
// ────────────────────────────────────────────────────────────────────────────

export function BillingTab() {
  const { profiles } = useUser();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  // Only the owner of a profile can mutate its billing — admins of the
  // profile cannot. Show every profile the user owns; show member-of profiles
  // read-only at the bottom.
  const ownedProfiles = useMemo(
    () =>
      Object.values(profiles).filter(
        (p) =>
          p.created &&
          (p.owner_uid === uid || (p.id?.startsWith(`${uid}__`) ?? false)),
      ),
    [profiles, uid],
  );

  const memberProfiles = useMemo(
    () =>
      Object.values(profiles).filter(
        (p) =>
          p.created &&
          !(p.owner_uid === uid || (p.id?.startsWith(`${uid}__`) ?? false)),
      ),
    [profiles, uid],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold mb-1">Subscription & Billing</h3>
        <p className="text-sm text-muted-foreground">
          Each profile has its own plan. Only the profile owner can change billing.
        </p>
      </div>

      {ownedProfiles.length === 0 && (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          You don&apos;t own any profiles yet. Create a profile in <strong>My Profiles</strong> to manage billing.
        </div>
      )}

      {ownedProfiles.map((profile) => (
        <ProfilePlanCard
          key={profile.id}
          profile={profile}
          isOwner
        />
      ))}

      {memberProfiles.length > 0 && (
        <>
          <h4 className="font-display text-base font-semibold pt-4">Profiles you collaborate on</h4>
          <p className="text-xs text-muted-foreground -mt-3">
            Billing is managed by each profile&apos;s owner.
          </p>
          {memberProfiles.map((profile) => (
            <ProfilePlanCard
              key={profile.id}
              profile={profile}
              isOwner={false}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Per-profile plan card
// ────────────────────────────────────────────────────────────────────────────

interface ProfilePlanCardProps {
  profile: SharedProfile;
  isOwner: boolean;
}

function ProfilePlanCard({ profile, isOwner }: ProfilePlanCardProps) {
  const profileId = profile.id ?? "";
  const { plan: rawPlan, loading } = useProfilePlan(profileId);

  // Drop malformed plan docs to the "no plan assigned" path so the
  // owner sees an actionable message instead of half-rendered fields.
  const plan = isWellFormedPlan(rawPlan) ? rawPlan : undefined;

  if (!profileId) return null;

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">
              {profile.name || "Untitled profile"}
            </h3>
            <Badge variant="outline" className="text-xs capitalize">
              {profile.role}
            </Badge>
            {!isOwner && (
              <Badge variant="secondary" className="text-xs">
                Member
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? <Skeleton className="h-3 w-32" /> : <PlanHeadline plan={plan} />}
          </p>
        </div>
        {plan && isPaidPlan(plan.type) && (
          <Badge variant="default" className="gap-1">
            <Crown className="h-3 w-3" /> Pro
          </Badge>
        )}
      </header>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : (
        <>
          <PlanDetails plan={plan} profileId={profileId} profileRole={profile.role} />
          <FreeOperatorUsage plan={plan} profileId={profileId} />
        </>
      )}

      {isOwner && (
        <PlanActions profileId={profileId} profile={profile} plan={plan} />
      )}
    </div>
  );
}

function PlanHeadline({ plan }: { plan: ProfilePlan | null | undefined }) {
  if (plan === null) {
    return <span>Loading…</span>;
  }
  if (plan === undefined) {
    return <span>No plan assigned yet — contact us to get set up.</span>;
  }
  const statusLabel = plan.status === "active" ? "Active" : plan.status === "cancelled" ? "Cancelled" : "—";
  return <span>{PLAN_LABELS[plan.type]} · {statusLabel}</span>;
}

function PlanDetails({
  plan,
  profileId,
  profileRole,
}: {
  plan: ProfilePlan | null | undefined;
  profileId: string;
  profileRole: string;
}) {
  void profileId;
  if (!plan) {
    return (
      <div className="text-sm text-muted-foreground">
        This profile is on the default Free tier ({profileRole === "performer" ? "Free Artist" : "Free Operator"}).
      </div>
    );
  }

  const showSeats = plan.type === "operator_pro";
  const showRenewal = isPaidPlan(plan.type) && plan.renewalAt;
  const statusText = plan.status === "active" ? "Active" : plan.status === "cancelled" ? "Cancelled" : "—";

  const rows: Array<{ label: React.ReactNode; value: React.ReactNode }> = [
    { label: "Plan", value: PLAN_LABELS[plan.type] },
    { label: "Status", value: statusText },
  ];
  if (showSeats) {
    rows.push({
      label: (
        <span className="inline-flex items-center gap-1">
          <UsersIcon className="h-3.5 w-3.5" /> Seats
        </span>
      ),
      value: plan.seats ?? 2,
    });
  }
  if (showRenewal && plan.renewalAt) {
    rows.push({
      label: (
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="h-3.5 w-3.5" /> Renews
        </span>
      ),
      value: new Date(plan.renewalAt).toLocaleDateString(),
    });
  }

  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
      {rows.map((row, i) => (
        <Fragment key={i}>
          <div className="text-muted-foreground">{row.label}</div>
          <div>{row.value}</div>
        </Fragment>
      ))}
    </div>
  );
}

function FreeOperatorUsage({
  plan,
  profileId,
}: {
  plan: ProfilePlan | null | undefined;
  profileId: string;
}) {
  // Only Free Operator cares about the 60-event cap. Paid plans + artist
  // plans have no cap, so don't bother fetching.
  const planType = plan?.type ?? "free_operator";
  const shouldShow = planType === "free_operator";
  const { data: cap } = useEventCapStatus(shouldShow ? profileId : null);

  if (!shouldShow || !cap || !cap.applies) return null;

  const pct = Math.min(100, Math.round((cap.count / cap.cap) * 100));
  const overCap = cap.count > cap.cap;
  const blocked = cap.blocked;

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium">Confirmed events (rolling 12 months)</span>
        <span className={`text-sm font-mono ${blocked ? "text-destructive" : overCap ? "text-amber-600" : ""}`}>
          {cap.count} / {cap.cap}
        </span>
      </div>
      <Progress value={pct} className={overCap ? "bg-amber-100" : undefined} />
      {blocked && (
        <p className="mt-2 text-xs text-destructive">
          You&apos;ve reached the Free Operator limit including the grace period.
          New confirmations are blocked until events cancel or you upgrade.
        </p>
      )}
      {!blocked && overCap && (
        <p className="mt-2 text-xs text-amber-700">
          You&apos;re in the grace period — {cap.remaining} more confirmations before the hard block.
        </p>
      )}
      {!overCap && cap.count >= cap.cap - 10 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Approaching the 60-event/year Free limit. Upgrade to Operator Pro for unlimited events.
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Owner-only actions
// ────────────────────────────────────────────────────────────────────────────

function PlanActions({
  profileId,
  profile,
  plan,
}: {
  profileId: string;
  profile: SharedProfile;
  plan: ProfilePlan | null | undefined;
}) {
  const [action, setAction] = useState<null | "upgrade" | "downgrade" | "seats" | "cancel">(null);

  const planType = plan?.type ?? (profile.role === "performer" ? "free_artist" : "free_operator");

  const onFreePlan = planType === "free_operator" || planType === "free_artist";
  const showSeatChange = planType === "operator_pro";
  const showCancel = isPaidPlan(planType);

  return (
    <div className="flex flex-wrap gap-2 pt-1 border-t">
      {onFreePlan && (
        <Button onClick={() => setAction("upgrade")} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Upgrade
        </Button>
      )}
      {!onFreePlan && (
        <Button variant="outline" onClick={() => setAction("downgrade")} className="gap-1.5">
          Change plan
        </Button>
      )}
      {showSeatChange && (
        <Button variant="outline" onClick={() => setAction("seats")} className="gap-1.5">
          <UsersIcon className="h-3.5 w-3.5" /> Add seats
        </Button>
      )}
      {showCancel && (
        <Button variant="outline" onClick={() => setAction("cancel")} className="gap-1.5 text-destructive">
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
      )}
      <ContactDialog
        open={action !== null}
        onOpenChange={(o) => { if (!o) setAction(null); }}
        action={action}
        profileId={profileId}
        profileName={profile.name || "(unnamed profile)"}
        profileRole={profile.role}
        currentPlan={planType}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Contact-us dialog (fires Brevo email to sales inbox)
// ────────────────────────────────────────────────────────────────────────────

function ContactDialog({
  open,
  onOpenChange,
  action,
  profileId,
  profileName,
  profileRole,
  currentPlan,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: "upgrade" | "downgrade" | "seats" | "cancel" | null;
  profileId: string;
  profileName: string;
  profileRole: string;
  currentPlan: PlanType;
}) {
  const { toast } = useToast();
  const [requestedPlan, setRequestedPlan] = useState<PlanType | null>(null);
  const [seats, setSeats] = useState<number>(2);
  const [message, setMessage] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Plans available given the profile role. Performers can only land on
  // free_artist / artist_pro; operators on free_operator / operator_pro.
  const availablePlans: PlanType[] = useMemo(() => {
    const isPerformer = profileRole === "performer";
    return isPerformer
      ? ["free_artist", "artist_pro"]
      : ["free_operator", "operator_pro"];
  }, [profileRole]);

  // Default the requested plan based on the action.
  useMemo(() => {
    if (action === "upgrade") {
      setRequestedPlan(
        availablePlans.find((p) => isPaidPlan(p)) ?? null,
      );
    } else if (action === "downgrade") {
      setRequestedPlan(
        availablePlans.find((p) => !isPaidPlan(p)) ?? null,
      );
    } else if (action === "cancel") {
      setRequestedPlan(
        availablePlans.find((p) => !isPaidPlan(p)) ?? null,
      );
    } else if (action === "seats") {
      setRequestedPlan(currentPlan);
    }
  }, [action, availablePlans, currentPlan]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const fn = httpsCallable<
        {
          profileId: string;
          profileName: string;
          action: string;
          currentPlan: PlanType;
          requestedPlan: PlanType | null;
          seats?: number;
          message: string;
        },
        { ok: true }
      >(getFirebaseFunctions(), "requestPlanChange");
      await fn({
        profileId,
        profileName,
        action: action ?? "upgrade",
        currentPlan,
        requestedPlan,
        seats: action === "seats" ? seats : undefined,
        message: message.trim(),
      });
      toast({ title: "Request sent", description: "We'll be in touch shortly to confirm." });
      onOpenChange(false);
      setMessage("");
    } catch (err) {
      toast({
        title: "Could not send request",
        description: (err as Error)?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const titleMap: Record<NonNullable<typeof action>, string> = {
    upgrade: "Upgrade plan",
    downgrade: "Change plan",
    seats: "Add seats",
    cancel: "Cancel subscription",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action ? titleMap[action] : "Contact us"}</DialogTitle>
          <DialogDescription>
            Tell us what you need and we&apos;ll get it set up. Mollie self-serve checkout is on its way — for
            now plan changes go through the shoWMe team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Profile</span><span className="font-medium">{profileName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Current plan</span><span className="font-medium">{PLAN_LABELS[currentPlan]}</span></div>
            {requestedPlan && action !== "seats" && (
              <div className="flex justify-between"><span className="text-muted-foreground">Requested plan</span><span className="font-medium">{PLAN_LABELS[requestedPlan]}</span></div>
            )}
          </div>
          {action === "seats" && (
            <div>
              <Label className="text-xs">Total seats</Label>
              <input
                type="number"
                min={2}
                value={seats}
                onChange={(e) => setSeats(Math.max(2, parseInt(e.target.value || "2", 10) || 2))}
                className="mt-1 w-32 rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">€99 base · +€15/seat after 2</p>
            </div>
          )}
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Anything we should know — billing email, invoice address, urgency, etc."
              className="mt-1 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            <Mail className="h-3.5 w-3.5" /> {submitting ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-export helpers for tests / future use.
export { isOperatorPlan, isArtistPlan };
// Tree-shaking guard — keep the Check import alive for badge icons in future iterations.
void Check;
