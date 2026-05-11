import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { fetchPublicProfileBySlug } from "@/lib/db";
import { getBaseRole, type OperatorRole, type SharedProfile } from "@/lib/user-context";
import RequestDateForm from "@/components/RequestDateForm";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2 } from "lucide-react";

export default function BookingWidgetPage() {
  const { slug } = useParams({ from: "/request-date/$slug" });
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SharedProfile | null>(null);
  const [role, setRole] = useState<OperatorRole | null>(null);
  const [ownerUid, setOwnerUid] = useState("");
  const [formOpen, setFormOpen] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const remote = await fetchPublicProfileBySlug(slug);
        if (cancelled) return;
        if (remote) {
          setProfile(remote.profile);
          setRole(getBaseRole(remote.slot));
          setOwnerUid(remote.owner_uid);
        } else {
          setProfile(null);
          setRole(null);
          setOwnerUid("");
        }
      } catch {
        if (!cancelled) {
          setProfile(null);
          setRole(null);
          setOwnerUid("");
        }
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-md mx-auto space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!profile || !role) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Profile not found</h1>
          <p className="text-sm text-muted-foreground">This booking widget link is invalid or the profile is not public.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border bg-card p-8 shadow-sm text-center">
          <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-3" />
          <h1 className="text-xl font-semibold mb-1">Request sent</h1>
          <p className="text-sm text-muted-foreground">
            Thanks — your booking request was sent to {profile.name}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-md mx-auto">
        <h1 className="text-lg font-semibold mb-1">Request a date with {profile.name}</h1>
        <p className="text-sm text-muted-foreground mb-4">Fill in the form below to send a booking request.</p>
        <RequestDateForm
          open={formOpen}
          onOpenChange={(v) => setFormOpen(v)}
          targetProfileSlug={slug}
          targetProfileId={profile.id ?? ""}
          targetRole={role}
          source="widget"
          operatorOwnerUid={ownerUid}
          onSuccess={() => setSubmitted(true)}
        />
        {!formOpen && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-sm text-primary underline"
          >
            Open form
          </button>
        )}
      </div>
    </div>
  );
}
