import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams, useSearch, useNavigate } from "@tanstack/react-router";
import { fetchPublicShareByToken, updatePublicShareAgreementConfirmations } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/models";
import type { DealStructure, Event, EventCollaborator, ScheduleItem, CrewMember, TicketType, Agreement } from "@/lib/models";
import { generateSignatureHash } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Calendar, MapPin, Music, Users, Ticket, DollarSign, Clock, FileText, Share2, Lock, Mail, AlertCircle, CheckCircle2, Check, LogOut, ShieldAlert } from "lucide-react";

interface AgreementConfirmation {
  party: string;
  confirmedAt: string;
  confirmedBy: string;
  method: string;
  signature: string;
}

interface ManagerData {
  dealDescription?: string;
  agreementConfirmations?: AgreementConfirmation[];
  agreementLastChangedAt?: string;
  schedule?: ScheduleItem[];
  crew?: CrewMember[];
  agreements?: Agreement[];
  collaborators?: EventCollaborator[];
}

interface SharedEventSnapshot {
  event?: Event;
  deal?: DealStructure;
  revenue?: { ticketTypes?: TicketType[] };
  eventMeta?: ManagerData;
  managerData?: ManagerData;
}

export default function SharedEventPage() {
  const { eventId } = useParams({ from: "/shared/event/$eventId" });
  const search = useSearch({ from: "/shared/event/$eventId" });
  const navigate = useNavigate();

  /** Email the viewer entered to match optional share recipients (not Firebase auth). */
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<SharedEventSnapshot | null>(null);
  const [shareInfo, setShareInfo] = useState<{ createdBy: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string; email?: string } | null>(null);

  // Auth form state
  const [isSignup, setIsSignup] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const token = search.token;
  const tabs = search.tabs?.split(",").filter(Boolean) || [];
  const sections = search.sections?.split(",").filter(Boolean) || [];
  const showAll = tabs.length === 0 && sections.length === 0;

  // Whether this share requires email verification (null = unknown yet)
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null);

  const showTab = (tabId: string) => showAll || tabs.includes(tabId);
  const showSection = (sectionId: string) => showAll || sections.includes(sectionId) || tabs.some(t => {
    const tabSections: Record<string, string[]> = {
      details: ["event-info", "ticketing", "production-schedule", "riders", "deal-structure"],
      agreement: ["event-summary", "agreements-docs", "terms"],
      crew: ["shared-team", "schedule", "tasks", "private-notes"],
      settlement: ["settlement-overview"],
    };
    return tabSections[t]?.includes(sectionId);
  });

  // Step 1: Check if share has recipients — if not, bypass auth gate
  useEffect(() => {
    if (!token || !eventId) return;
    if (verifiedEmail) return; // already authenticated
    if (requiresAuth !== null) return; // already checked

    const check = async () => {
      setLoading(true);
      try {
        const pub = await fetchPublicShareByToken(token);
        if (!pub || pub.kind !== "event_snapshot" || pub.eventId !== eventId) {
          setError({ code: "NOT_FOUND", message: "This shared link is invalid or has expired." });
          setRequiresAuth(false);
          setLoading(false);
          return;
        }
        const recipients = (pub.recipients || []).map((r: string) => String(r).toLowerCase().trim()).filter(Boolean);
        if (recipients.length === 0) {
          // No recipients — public link, skip auth
          setRequiresAuth(false);
          setVerifiedEmail("__public__");
        } else {
          setRequiresAuth(true);
        }
      } catch {
        setRequiresAuth(true);
      }
      setLoading(false);
    };
    void check();
  }, [token, eventId, verifiedEmail, requiresAuth]);

  // Step 2: Load snapshot data once we have a verified email (or public bypass)
  useEffect(() => {
    if (!verifiedEmail || !token || !eventId) return;

    const resolve = async () => {
      setLoading(true);
      setError(null);
      try {
        const pub = await fetchPublicShareByToken(token);
        if (!pub || pub.kind !== "event_snapshot" || pub.eventId !== eventId) {
          setError({ code: "NOT_FOUND", message: "This shared link is invalid or has expired." });
          setLoading(false);
          return;
        }
        const recipients = (pub.recipients || []).map((r: string) => String(r).toLowerCase().trim()).filter(Boolean);
        if (recipients.length > 0 && verifiedEmail !== "__public__" && !recipients.includes(verifiedEmail.toLowerCase().trim())) {
          setError({ code: "ACCESS_DENIED", message: "", email: verifiedEmail });
          setLoading(false);
          return;
        }
        const rawSnap = pub.snapshotData as SharedEventSnapshot | undefined;
        if (!rawSnap) {
          setError({ code: "NOT_FOUND", message: "Shared snapshot is missing." });
          setLoading(false);
          return;
        }
        const extra = pub.agreementConfirmations as AgreementConfirmation[] | undefined;
        const snapMeta: ManagerData | undefined = rawSnap.eventMeta ?? rawSnap.managerData;
        let snap: SharedEventSnapshot = rawSnap;
        if (extra && Array.isArray(extra) && snapMeta) {
          snap = {
            ...rawSnap,
            eventMeta: {
              ...snapMeta,
              agreementConfirmations: extra,
            },
          };
        }
        setSnapshot(snap);
        setShareInfo({
          createdBy: String((pub as { creatorName?: string }).creatorName || "Organizer"),
          createdAt: String(pub.createdAt || new Date().toISOString()),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load shared event.";
        setError({ code: "NETWORK", message: msg });
      }
      setLoading(false);
    };
    void resolve();
  }, [token, eventId, verifiedEmail]);

  // Mock signup/login — just set the email locally
  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setAuthSubmitting(true);
    setAuthError("");
    // Accept any password, just store the email
    setVerifiedEmail(email.trim().toLowerCase());
    setAuthSubmitting(false);
  };

  const handleSignOut = () => {
    setVerifiedEmail(null);
    setSnapshot(null);
    setError(null);
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // No token
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">Invalid Link</h1>
          <p className="text-muted-foreground">This shared event link is missing a valid token.</p>
        </div>
      </div>
    );
  }

  // Auth gate — show login/signup when not "authenticated" and share requires it
  if (!verifiedEmail && requiresAuth !== false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <img src="/images/showme-logo.png" alt="shoWMe" className="h-8 mx-auto mb-2" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <Lock className="h-10 w-10 mx-auto text-primary" />
            <h1 className="text-2xl font-bold">Private Event Link</h1>
            <p className="text-sm text-muted-foreground">Sign in or create an account to access this shared event. Only authorized email addresses can view this content.</p>
          </div>

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <p className="text-sm text-muted-foreground mb-4 text-center">
              {isSignup
                ? "Create an account with the email this link was shared to."
                : "Sign in with your account to access this event."}
            </p>

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</Label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setAuthError(""); }}
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <Label className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> {isSignup ? "Create Password" : "Password"}</Label>
                <Input
                  type="password"
                  placeholder={isSignup ? "Min. 6 characters" : "Enter your password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setAuthError(""); }}
                  className="mt-1"
                />
              </div>
              {authError && <p className="text-sm text-destructive">{authError}</p>}
              <Button type="submit" className="w-full" disabled={!email.trim() || !password.trim() || authSubmitting}>
                {authSubmitting ? "Please wait..." : isSignup ? "Create Account" : "Sign In"}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setIsSignup(!isSignup); setAuthError(""); }}
              >
                {isSignup ? "Already have an account? Sign in" : "First time? Create an account"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Access denied
  if (error?.code === "ACCESS_DENIED") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <img src="/images/showme-logo.png" alt="shoWMe" className="h-8 mx-auto mb-2" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <ShieldAlert className="h-12 w-12 mx-auto text-destructive" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            Your email <span className="font-medium text-foreground">{error.email || verifiedEmail}</span> is not authorized to view this shared event.
          </p>
          <p className="text-xs text-muted-foreground">
            Only specific email addresses invited by the event creator can access this link.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={handleSignOut} className="gap-2">
              <LogOut className="h-4 w-4" /> Sign out & try a different account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Other errors
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <h1 className="text-xl font-bold">
            {error.code === "NOT_FOUND" ? "Link Not Found" : "Error"}
          </h1>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          {error.code === "NOT_FOUND" && (
            <p className="text-xs text-muted-foreground">
              This link may have expired or needs to be re-shared by the event creator.
            </p>
          )}
          <Button variant="outline" onClick={handleSignOut} className="gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  // No snapshot loaded
  if (!snapshot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading event data...</p>
      </div>
    );
  }

  const event = snapshot.event;
  const deal = snapshot.deal;
  const revenue = snapshot.revenue;
  const managerData = snapshot.eventMeta ?? snapshot.managerData;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-6">
          <img src="/images/showme-logo.png" alt="shoWMe" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{verifiedEmail}</span>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1 h-7 text-xs">
              <LogOut className="h-3 w-3" /> Sign out
            </Button>
          </div>
        </div>

        {/* Share metadata */}
        {shareInfo && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            <Share2 className="h-3.5 w-3.5 shrink-0" />
            <span>Shared by <span className="font-medium text-foreground">{shareInfo.createdBy}</span> on {new Date(shareInfo.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}

        {/* Header */}
        {event && (
          <div className="mb-8">
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Shared Event Details</p>
            <h1 className="text-3xl font-bold tracking-tight">{event.name}</h1>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> {event.date}</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {event.venue}</span>
              {event.artist && <span className="flex items-center gap-1.5"><Music className="h-4 w-4" /> {event.artist}</span>}
            </div>
            <Badge variant="secondary" className="mt-3 capitalize">{(event.eventStatus || event.event_status)?.replace(/_/g, " ")}</Badge>
          </div>
        )}

        <div className="space-y-6">
          {/* Event Summary */}
          {showSection("event-summary") && event && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Event Summary</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Event:</span> <span className="font-medium ml-2">{event.name}</span></div>
                <div><span className="text-muted-foreground">Date:</span> <span className="font-medium ml-2">{event.date}</span></div>
                <div><span className="text-muted-foreground">Venue:</span> <span className="font-medium ml-2">{event.venue}</span></div>
                {event.artist && <div><span className="text-muted-foreground">Performer:</span> <span className="font-medium ml-2">{event.artist}</span></div>}
                {deal?.dealType && <div><span className="text-muted-foreground">Deal Type:</span> <span className="font-medium ml-2 capitalize">{deal.dealType.replace(/_/g, " ")}</span></div>}
                {deal?.artistGuarantee > 0 && <div><span className="text-muted-foreground">Performer Guarantee:</span> <span className="font-medium ml-2">{formatCurrency(deal.artistGuarantee)}</span></div>}
                {deal?.venueRental > 0 && <div><span className="text-muted-foreground">Venue Rental:</span> <span className="font-medium ml-2">{formatCurrency(deal.venueRental)}</span></div>}
                <div><span className="text-muted-foreground">Capacity:</span> <span className="font-medium ml-2">{event.capacity?.toLocaleString()}</span></div>
              </div>
            </div>
          )}

          {/* Event Information */}
          {showSection("event-info") && event && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Event Information</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Venue:</span> <span className="font-medium ml-2">{event.venue}</span></div>
                <div><span className="text-muted-foreground">Capacity:</span> <span className="font-medium ml-2">{event.capacity?.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Operator:</span> <span className="font-medium ml-2">{event.operator}</span></div>
                {event.ticketingProvider && <div><span className="text-muted-foreground">Ticketing:</span> <span className="font-medium ml-2">{event.ticketingProvider}</span></div>}
              </div>
            </div>
          )}

          {/* Ticket Types */}
          {showSection("ticketing") && revenue?.ticketTypes?.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Ticket className="h-5 w-5 text-primary" /> Ticket Types</h3>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/30 border-b"><th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground">Type</th><th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">Price</th><th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">Expected</th></tr></thead>
                  <tbody className="divide-y">
                    {revenue.ticketTypes.map((tt: TicketType) => (
                      <tr key={tt.name}><td className="px-4 py-2">{tt.name}</td><td className="px-4 py-2 text-right">{formatCurrency(tt.price)}</td><td className="px-4 py-2 text-right">{tt.sold?.toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Deal Structure */}
          {showSection("deal-structure") && deal && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-primary" /> Deal Structure</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Deal Type:</span> <span className="font-medium ml-2 capitalize">{deal.dealType?.replace(/_/g, " ")}</span></div>
                {deal.artistGuarantee > 0 && <div><span className="text-muted-foreground">Performer Guarantee:</span> <span className="font-medium ml-2">{formatCurrency(deal.artistGuarantee)}</span></div>}
                {deal.venueRental > 0 && <div><span className="text-muted-foreground">Venue Rental:</span> <span className="font-medium ml-2">{formatCurrency(deal.venueRental)}</span></div>}
              </div>
            </div>
          )}

          {/* Standalone Terms */}
          {showSection("terms") && managerData?.dealDescription && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Terms & Conditions</h3>
              <p className="text-sm whitespace-pre-wrap">{managerData.dealDescription}</p>
            </div>
          )}

          {/* Production Schedule */}
          {showSection("production-schedule") && managerData?.schedule?.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> Production Schedule</h3>
              <div className="space-y-2 text-sm">
                {managerData.schedule.filter((s: ScheduleItem) => s.time).map((s: ScheduleItem) => (
                  <div key={s.id} className="flex gap-4"><span className="text-muted-foreground w-14 shrink-0">{s.time}</span><span className="font-medium">{s.label}</span></div>
                ))}
              </div>
            </div>
          )}

          {/* Shared Team */}
          {showSection("shared-team") && managerData?.crew?.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Team</h3>
              <div className="space-y-2">
                {managerData.crew.map((c: CrewMember) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <div><span className="font-medium">{c.name}</span><span className="text-muted-foreground ml-2">— {c.role}</span></div>
                    {c.collaborator && <Badge variant="outline" className="text-xs">{c.collaborator}</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agreement Confirmation */}
          {showSection("agreements-docs") && managerData && token && (
            <SharedAgreementConfirm
              shareToken={token}
              eventId={eventId!}
              managerData={managerData}
              deal={deal}
              userEmail={verifiedEmail}
              onConfirmationsUpdated={(updated) => {
                setSnapshot((s) =>
                  s ? {
                    ...s,
                    eventMeta: { ...(s.eventMeta ?? s.managerData), agreementConfirmations: updated },
                  } : null,
                );
              }}
            />
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-12">Shared via shoWMe</p>
      </div>
    </div>
  );
}

function SharedAgreementConfirm({
  shareToken,
  eventId,
  managerData,
  deal,
  userEmail,
  onConfirmationsUpdated,
}: {
  shareToken: string;
  eventId: string;
  managerData: ManagerData;
  deal: DealStructure | undefined;
  userEmail: string | null;
  onConfirmationsUpdated: (rows: AgreementConfirmation[]) => void;
}) {
  const confirmations: AgreementConfirmation[] = managerData.agreementConfirmations || [];
  const lastChangedAt = managerData.agreementLastChangedAt;
  const agreements = managerData.agreements || [];
  const terms = managerData.dealDescription || "";
  const collaborators: EventCollaborator[] = managerData.collaborators || [];

  const [localConfirmations, setLocalConfirmations] = useState(confirmations);

  const confirmMutation = useMutation({
    mutationFn: (updated: AgreementConfirmation[]) =>
      updatePublicShareAgreementConfirmations(shareToken, updated as unknown[]),
    onSuccess: (_data, updated) => {
      onConfirmationsUpdated(updated);
      toast({ title: "Agreement confirmed", description: `You have approved the agreement as ${updated[updated.length - 1]?.party}.` });
    },
    onError: () => {
      toast({ title: "Could not save", description: "Confirmation was not persisted. Check Firestore rules.", variant: "destructive" });
    },
  });

  // Derive parties from collaborators, or fallback to deal structure
  const collaboratorParties = collaborators.map((c: EventCollaborator) => c.role || c.eventRole || c.name).filter(Boolean);
  const derivedParties: string[] = [];
  if (collaboratorParties.length === 0 && deal) {
    if (deal.artistGuarantee > 0 || deal.artistSplit > 0) derivedParties.push("Performer");
    if (deal.venueRental > 0 || deal.venueSplit > 0) derivedParties.push("Venue");
    if (deal.promoterSplit > 0) derivedParties.push("Promoter");
    if (derivedParties.length === 0) {
      derivedParties.push("Performer", "Venue");
    }
  }

  const allParties = Array.from(new Set([
    ...collaboratorParties,
    ...derivedParties,
    ...confirmations.map(c => c.party),
  ]));

  // Map user email to the party they represent
  const hasCollaborators = collaboratorParties.length > 0;
  const userParty = hasCollaborators
    ? collaborators.find((c: EventCollaborator) => c.email && userEmail && c.email.toLowerCase().trim() === userEmail.toLowerCase().trim())
    : null;
  const userPartyName = hasCollaborators
    ? (userParty ? (userParty.role || userParty.eventRole || userParty.name) : null)
    : null; // When no collaborators, we allow confirming any derived party below

  if (!allParties.length && !agreements.length && !terms) return null;

  const handleSelfConfirm = async (party: string) => {
    if (!userEmail) return;
    const now = new Date().toISOString();
    const signature = await generateSignatureHash(party, now, userEmail);
    const newConfirmation = { party, confirmedAt: now, confirmedBy: userEmail, method: "self" as const, signature };
    const updated = [...localConfirmations.filter(c => c.party !== party), newConfirmation];
    setLocalConfirmations(updated);
    confirmMutation.mutate(updated);
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Agreement Confirmation</h3>
      {lastChangedAt && (
        <p className="text-xs text-muted-foreground mb-3">
          Last modified: {new Date(lastChangedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}

      {terms && (
        <div className="rounded-lg border p-3 mb-4 text-sm bg-muted/20">
          <p className="text-xs font-medium text-muted-foreground mb-1">Terms & Conditions</p>
          <p className="whitespace-pre-wrap">{terms}</p>
        </div>
      )}

      <div className="space-y-3">
        {allParties.map(party => {
          const confirmation = localConfirmations.find(c => c.party === party);
          return (
            <div key={party} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${confirmation ? "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]" : "bg-muted text-muted-foreground"}`}>
                  {confirmation ? <Check className="h-4 w-4" /> : party.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium">{party}</p>
                  {confirmation ? (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${confirmation.method === "self" ? "text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" : "text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]"}`}>
                          {confirmation.method === "self" ? "Approved" : "Manual"}
                        </Badge>
                        <span className="text-xs text-[hsl(var(--success))]">
                          {confirmation.method === "manual" ? `Confirmed manually by ${confirmation.confirmedBy}` : `Confirmed by ${confirmation.confirmedBy}`}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(confirmation.confirmedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {confirmation.signature && <span className="ml-2 font-mono" title={`Signature: ${confirmation.signature}`}>ID: {confirmation.signature.slice(0, 8)}…</span>}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not yet confirmed</p>
                  )}
                </div>
              </div>
              {!confirmation && userEmail && (hasCollaborators ? userPartyName === party : true) && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={confirmMutation.isPending} onClick={() => handleSelfConfirm(party)}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Agreement
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
