import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { CreateProfileDialog } from "@/components/CreateProfileDialog";
import { operatorRoleLabels, type OperatorRole } from "@/lib/user-context";
import logo from "@/assets/showme-logo.png";
import { Loader2, AlertCircle, CheckCircle2, UserPlus } from "lucide-react";

interface PeekResult {
  status: "active" | "used" | "revoked" | "not-found";
  emailMatches?: boolean;
  recipientEmail?: string;
  recipientName?: string;
  recipientRole?: string;
  linkedEventId?: string;
  eventName?: string;
  senderName?: string;
  matchingProfile?: { id: string; name: string; role: string };
}

const OPERATOR_ROLES = new Set<OperatorRole>([
  "venue", "promoter", "organizer", "performer", "festival",
]);

function isOperatorRole(role: string | undefined): role is OperatorRole {
  return !!role && OPERATOR_ROLES.has(role as OperatorRole);
}

export default function InvitePage() {
  const { code } = useSearch({ from: "/invite" });
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peeking, setPeeking] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const trimmedCode = (code || "").trim();

  // Peek runs only once we know who's signed in — the result depends on the
  // caller's email matching the invitation's recipientEmail.
  useEffect(() => {
    if (authLoading) return;
    if (!trimmedCode) {
      setPeeking(false);
      return;
    }
    if (!user) {
      // Don't peek anonymously — peekInvitationCode requires auth so we can
      // verify the recipient email. The signed-out branch renders below.
      setPeeking(false);
      return;
    }
    let cancelled = false;
    setPeeking(true);
    (async () => {
      try {
        const fn = httpsCallable<{ code: string }, PeekResult>(
          getFirebaseFunctions(), "peekInvitationCode",
        );
        const res = await fn({ code: trimmedCode });
        if (!cancelled) setPeek(res.data);
      } catch (err) {
        if (!cancelled) {
          const message = (err as { message?: string })?.message || "Could not load this invitation.";
          setPeekError(message);
        }
      } finally {
        if (!cancelled) setPeeking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, trimmedCode]);

  const claimWithProfile = async (profileId: string) => {
    if (accepting) return;
    setAccepting(true);
    try {
      const fn = httpsCallable<
        { code: string; profileId: string },
        { ok: true; eventId?: string; profileId: string }
      >(getFirebaseFunctions(), "claimInviteWithProfile");
      const res = await fn({ code: trimmedCode, profileId });
      toast({
        title: "Invitation accepted",
        description: peek?.eventName ? `You now have access to ${peek.eventName}.` : "Access granted.",
      });
      if (res.data.eventId) {
        navigate({ to: "/events/$id", params: { id: res.data.eventId }, replace: true });
      } else {
        navigate({ to: "/events", replace: true });
      }
    } catch (err) {
      const message = (err as { message?: string })?.message || "Could not accept this invitation.";
      toast({ title: "Could not accept invitation", description: message, variant: "destructive" });
      setAccepting(false);
    }
  };

  const handleProfileCreated = (_slot: string, profileId: string) => {
    setCreateOpen(false);
    void claimWithProfile(profileId);
  };

  // ── Render branches ──────────────────────────────────────────────────────

  const roleLabel = useMemo(() => {
    const role = peek?.recipientRole;
    return isOperatorRole(role) ? operatorRoleLabels[role] : (role ?? "collaborator");
  }, [peek?.recipientRole]);

  const eventLabel = peek?.eventName ? `"${peek.eventName}"` : "an event";
  const senderLabel = peek?.senderName || "Someone";

  function frame(title: React.ReactNode, description: string, body: React.ReactNode) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-muted/30">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center space-y-3">
            <img src={logo} alt="shoWMe" className="mx-auto h-9" />
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">{body}</CardContent>
        </Card>
      </div>
    );
  }

  if (!trimmedCode) {
    return frame(
      "Invalid invitation link",
      "This link is missing its invitation code. Ask the sender to share the original link.",
      <Button asChild className="w-full"><Link to="/login">Go to sign in</Link></Button>,
    );
  }

  if (authLoading || peeking) {
    return frame(
      "Loading…",
      "Checking your invitation.",
      <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>,
    );
  }

  // Signed-out: offer sign-in or sign-up (sign-up route handles the new-user
  // signup-then-claim flow via the existing /signup?code= path).
  if (!user) {
    const redirectTarget = `/invite?code=${encodeURIComponent(trimmedCode)}`;
    return frame(
      "Accept your invitation",
      "Sign in or create an account to continue.",
      <>
        <Button asChild className="w-full">
          <Link to="/login" search={{ redirect: redirectTarget }}>Sign in</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link to="/signup" search={{ code: trimmedCode }}>Create account</Link>
        </Button>
      </>,
    );
  }

  if (peekError) {
    return frame(
      "Could not load invitation",
      peekError,
      <Button asChild variant="outline" className="w-full"><Link to="/events">Go to events</Link></Button>,
    );
  }

  if (!peek) {
    return frame("Loading…", "Checking your invitation.", <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>);
  }

  if (peek.status === "not-found") {
    return frame(
      "Invitation not found",
      "This invitation link is invalid. Check it with the sender.",
      <Button asChild variant="outline" className="w-full"><Link to="/events">Go to events</Link></Button>,
    );
  }

  if (peek.status === "used") {
    return frame(
      "Invitation already used",
      "This invitation has already been accepted. Sign in with the account you used and look in your events list.",
      <Button asChild className="w-full"><Link to="/events">Go to events</Link></Button>,
    );
  }

  if (peek.status === "revoked") {
    return frame(
      "Invitation no longer valid",
      "This invitation was revoked by the sender. Ask them to send a new one.",
      <Button asChild variant="outline" className="w-full"><Link to="/events">Go to events</Link></Button>,
    );
  }

  // Active but the signed-in account doesn't match the recipient email.
  if (peek.emailMatches === false) {
    return frame(
      "Wrong account",
      `This invitation was sent to a different email address. Sign out and sign in with the invited account.`,
      <Button asChild variant="outline" className="w-full"><Link to="/settings">Account settings</Link></Button>,
    );
  }

  // Active + email matches + recipient already has a profile in the requested
  // role — single-click accept.
  if (peek.matchingProfile) {
    return frame(
      "Accept invitation",
      `${senderLabel} invited you to ${eventLabel} as ${roleLabel}.`,
      <>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{peek.matchingProfile.name}</p>
          <p className="text-xs text-muted-foreground">{roleLabel} profile</p>
        </div>
        <Button
          className="w-full gap-2"
          onClick={() => void claimWithProfile(peek.matchingProfile!.id)}
          disabled={accepting}
        >
          {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Accept as {peek.matchingProfile.name}
        </Button>
      </>,
    );
  }

  // Active + email matches + no matching profile — prompt the recipient to
  // build one through the standard wizard. Once it's saved we wire the new
  // profile to the invite via claimInviteWithProfile.
  const role = isOperatorRole(peek.recipientRole) ? peek.recipientRole : undefined;

  return (
    <>
      {frame(
        <>Create your profile to accept<br />- it takes 5 seconds!</>,
        `${senderLabel} invited you to ${eventLabel} as ${roleLabel}. Set up a ${roleLabel} profile to continue.`,
        <>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              You'll go through a short setup. Your new {roleLabel} profile is linked to {eventLabel} automatically.
            </p>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => setCreateOpen(true)}
            disabled={accepting || !role}
          >
            {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create {roleLabel} profile
          </Button>
        </>,
      )}
      {role && (
        <CreateProfileDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={handleProfileCreated}
          forcedRole={role}
        />
      )}
    </>
  );
}
