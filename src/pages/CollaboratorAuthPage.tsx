import { useState, useEffect } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import {
  fetchCollaboratorInviteByToken,
  fetchEventRowForCollaborator,
  updateCollaboratorInviteCredentials,
} from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, AlertCircle, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface InviteRecord {
  token: string;
  event_id: string;
  role: string;
  permission: string;
  password: string;
  status: string;
  email: string;
  ownerUid: string;
}

export default function CollaboratorAuthPage() {
  const { eventId, token } = useParams({ from: "/collaborate/$eventId/$token" });
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteRecord | null>(null);
  const [eventName, setEventName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(`collab-auth-${token}`)) {
      navigate({ to: "/collaborate/$eventId/$token/view", params: { eventId: eventId!, token: token! }, replace: true });
      return;
    }

    const load = async () => {
      const record = await fetchCollaboratorInviteByToken(token!);
      if (!record) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setInvite(record as InviteRecord);

      if (record.password) {
        setIsSignup(false);
      }

      const evRow = await fetchEventRowForCollaborator(record.ownerUid, eventId!);
      if (evRow?.name) setEventName(String(evRow.name));
      setLoading(false);
    };
    void load();
  }, [eventId, token, navigate]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !email.trim() || !password.trim()) return;
    if (password.length < 4) { setError("Password must be at least 4 characters."); return; }

    if (invite.email && invite.email.trim() && email.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
      setError("This invitation is for a specific email address. Please use the email associated with this invite.");
      return;
    }

    try {
      await updateCollaboratorInviteCredentials(token!, {
        email: email.trim(),
        password,
        status: "accepted",
      });
    } catch {
      setError("Could not save credentials. Check Firestore rules for collaborator invites.");
      return;
    }

    sessionStorage.setItem(`collab-auth-${token}`, JSON.stringify({
      role: invite.role,
      permission: invite.permission,
      eventId: invite.event_id,
      email: email.trim(),
      ownerUid: invite.ownerUid,
    }));
    navigate({ to: "/collaborate/$eventId/$token/view", params: { eventId: eventId!, token: token! }, replace: true });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;

    if (email.trim().toLowerCase() === (invite.email || "").toLowerCase() && password === invite.password) {
      sessionStorage.setItem(`collab-auth-${token}`, JSON.stringify({
        role: invite.role,
        permission: invite.permission,
        eventId: invite.event_id,
        email: email.trim(),
        ownerUid: invite.ownerUid,
      }));
      navigate({ to: "/collaborate/$eventId/$token/view", params: { eventId: eventId!, token: token! }, replace: true });
    } else {
      setError("Incorrect email or password. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">Invalid or Expired Link</h1>
          <p className="text-muted-foreground">This collaboration link is no longer valid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <img src="/images/showme-logo.png" alt="shoWMe" className="h-8 mx-auto mb-2" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <Lock className="h-10 w-10 mx-auto text-primary" />
          <h1 className="text-2xl font-bold">Collaborator Access</h1>
          {eventName && <p className="text-lg text-muted-foreground">{eventName}</p>}
          {invite && (
            <div className="flex items-center justify-center gap-2">
              <Badge variant="secondary">{invite.role}</Badge>
              <Badge variant="outline">{invite.permission.replace("_", " ")}</Badge>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground mb-4 text-center">
            {isSignup
              ? "Enter your email and create a password to access this event."
              : "Log in with your credentials to access this event."}
          </p>

          <form onSubmit={isSignup ? handleSignup : handleLogin} className="space-y-4">
            <div>
              <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</Label>
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> {isSignup ? "Create Password" : "Password"}</Label>
              <Input
                type="password"
                placeholder={isSignup ? "Create a password" : "Enter your password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                className="mt-1"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={!email.trim() || !password.trim()}>
              {isSignup ? "Create Account & Access Event" : "Log In"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setIsSignup(!isSignup); setError(""); }}
            >
              {isSignup ? "Already have an account? Log in" : "First time? Create an account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
