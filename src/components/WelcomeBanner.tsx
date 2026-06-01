import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { useUser } from "@/lib/user-context";
import { getMissingPerformerFields } from "@/lib/profileCompleteness";
import { useAccountHasPaidPlan } from "@/lib/plans";

const DISMISS_KEY_PREFIX = "showme:welcome-banner-dismissed:";

function dismissKey(uid: string): string {
  return `${DISMISS_KEY_PREFIX}${uid}`;
}

function readDismissed(uid: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(dismissKey(uid)) === "1";
  } catch {
    return true;
  }
}

function writeDismissed(uid: string): void {
  try {
    window.localStorage.setItem(dismissKey(uid), "1");
  } catch {
    // Storage write failed (private mode, quota) — banner will reappear next
    // load. Acceptable degradation; do not block the dismiss UX on it.
  }
}

/**
 * One-time dashboard banner shown to a user on first login. Variant depends
 * on whether they have a performer profile (focus on profile completion to
 * unblock send flows) or operator profiles only (focus on Pro upgrade).
 *
 * Dismissal is per-uid-per-device in localStorage. Pre-launch this is fine;
 * if we later need cross-device persistence we can promote it to a Firestore
 * field on `users/{uid}/settings/main`.
 */
export function WelcomeBanner() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { profiles, loaded } = useUser();

  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    if (!uid) return;
    setDismissed(readDismissed(uid));
  }, [uid]);

  const performerProfile = useMemo(
    () => Object.values(profiles).find((p) => p.role === "performer"),
    [profiles],
  );
  const operatorProfileIds = useMemo(
    () =>
      Object.values(profiles)
        .filter((p) => p.role !== "performer")
        .map((p) => p.id)
        .filter((id): id is string => !!id),
    [profiles],
  );
  const { hasPaid: operatorHasPaid } = useAccountHasPaidPlan(operatorProfileIds);

  const missingPerformerFields = useMemo(
    () => (performerProfile ? getMissingPerformerFields(performerProfile) : []),
    [performerProfile],
  );

  if (!uid || !loaded || dismissed) return null;

  const handleDismiss = () => {
    writeDismissed(uid);
    setDismissed(true);
  };

  // Performer-first messaging when the user has any performer profile —
  // their immediate task is completing it so send buttons unlock.
  if (performerProfile) {
    const incomplete = missingPerformerFields.length > 0;
    return (
      <BannerShell onDismiss={handleDismiss}>
        <p className="text-sm font-medium">Welcome to shoWMe Free.</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {incomplete
            ? `Complete your performer profile (${missingPerformerFields.length} ${missingPerformerFields.length === 1 ? "item" : "items"} left) to start sending invites and offers to venues.`
            : "Your profile is ready. Reply to incoming requests or invite venues you're talking to."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {incomplete && performerProfile.id ? (
            <Link
              to="/profiles/$profileId/edit"
              params={{ profileId: performerProfile.id }}
            >
              <Button size="sm" className="gap-1.5">
                Finish my profile
              </Button>
            </Link>
          ) : (
            <Link to="/requests">
              <Button size="sm" className="gap-1.5">
                See incoming requests
              </Button>
            </Link>
          )}
        </div>
      </BannerShell>
    );
  }

  // Operator: nudge toward Pro unless they already have a paid plan on at
  // least one profile (in which case the banner has nothing useful to say
  // and we suppress it).
  if (operatorHasPaid) return null;

  return (
    <BannerShell onDismiss={handleDismiss}>
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" /> Welcome to shoWMe Free Operator.
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        You get up to 60 confirmed events / year, public profile and EPK, in-event messaging, and integrated settlement. Upgrade to Pro for unlimited events, CRM, team management, and advanced analytics.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link to="/settings" hash="billing">
          <Button size="sm" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> See Pro plans
          </Button>
        </Link>
        <Link to="/settings">
          <Button size="sm" variant="outline">
            Set up my workspace
          </Button>
        </Link>
      </div>
    </BannerShell>
  );
}

function BannerShell({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="relative mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 pr-10">
      {children}
      <button
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground transition-colors"
        aria-label="Dismiss welcome banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
