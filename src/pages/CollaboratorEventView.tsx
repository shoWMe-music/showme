import { useState, useEffect } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import {
  fetchCollaboratorAgreementDraft,
  fetchCollaboratorInviteByToken,
  fetchEventRowForCollaborator,
  fetchRiders,
  fetchCrew,
  fetchAgreements,
  insertMessage,
  saveCollaboratorAgreementDraft,
} from "@/lib/db";
import { ensureCollaboratorParticipantOnEvent } from "@/lib/collaboratorEventAccess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MessageSquare, Send, ChevronDown, ChevronUp, FileText, Users, Music, Calendar, CheckCircle2, Check, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateSignatureHash } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import EventMessages from "@/components/EventMessages";

interface AuthData {
  role: string;
  permission: string;
  eventId: string;
  email?: string;
  ownerUid: string;
}

interface EventData {
  id: string;
  name: string;
  date: string;
  venue: string;
  artist: string;
  capacity: number;
  event_status: string;
}

interface ManagerData {
  riders?: Array<{ id: string; name: string; type: string; fileUrl?: string; description?: string }>;
  crew?: Array<{ id: string; name: string; role: string; phone?: string; email?: string }>;
  agreements?: Array<{ id: string; name: string; type: string; status: string }>;
  agreementConfirmations?: Array<{ party: string; confirmedAt: string; confirmedBy: string; method: string; signature: string }>;
  agreementLastChangedAt?: string;
}

const SECTIONS = [
  { id: "details", label: "Event Details", icon: Calendar },
  { id: "agreement", label: "Agreement", icon: FileText },
  { id: "crew", label: "Team / Crew", icon: Users },
  { id: "riders", label: "Riders", icon: Music },
];

function mapEventRow(row: Record<string, unknown>): EventData {
  return {
    id: String(row.id),
    name: String(row.name),
    date: String(row.date),
    venue: String(row.venue),
    artist: String(row.artist),
    capacity: Number(row.capacity) || 0,
    event_status: String(row.eventStatus ?? row.event_status ?? ""),
  };
}

function SectionComment({
  sectionLabel,
  eventId,
  senderName,
}: {
  sectionLabel: string;
  eventId: string;
  senderName: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    const content = `[${sectionLabel}] ${text.trim()}`;
    try {
      await insertMessage(eventId, {
        sender_name: senderName,
        content,
        attachments: [],
      });
      setText("");
      setOpen(false);
      toast({ title: "Comment sent", description: `Your comment on ${sectionLabel} has been posted.` });
    } catch {
      toast({ title: "Could not send", description: "Message could not be saved.", variant: "destructive" });
    }
    setSending(false);
  };

  return (
    <div className="mt-3">
      {!open ? (
        <Button variant="outline" size="sm" className="gap-1.5" type="button" onClick={() => setOpen(true)}>
          <MessageSquare className="h-3.5 w-3.5" /> Comment on this section
        </Button>
      ) : (
        <div className="flex gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Comment on ${sectionLabel}...`}
            rows={2}
            className="flex-1"
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <Button size="sm" type="button" onClick={handleSend} disabled={!text.trim() || sending}>
              <Send className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setOpen(false); setText(""); }}>
              ✕
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CollaboratorEventView() {
  const { eventId, token } = useParams({ from: "/collaborate/$eventId/$token/view" });
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [event, setEvent] = useState<EventData | null>(null);
  const [managerData, setManagerData] = useState<ManagerData>({});
  const [ownerUid, setOwnerUid] = useState("");
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const senderName = `${auth?.role || "Collaborator"} (via link)`;

  useEffect(() => {
    const stored = sessionStorage.getItem(`collab-auth-${token}`);
    if (!stored) {
      navigate({ to: "/collaborate/$eventId/$token", params: { eventId: eventId!, token: token! }, replace: true });
      return;
    }
    const parsed = JSON.parse(stored) as AuthData;
    setAuth(parsed);
    const uid = parsed.ownerUid;
    setOwnerUid(uid || "");

    const loadData = async () => {
      if (!uid) {
        setLoading(false);
        return;
      }
      try {
        await ensureCollaboratorParticipantOnEvent(token!);
      } catch (e) {
        console.error(e);
        toast({
          title: "Could not join event workspace",
          description:
            "Collaborator chat needs the joinEventAsCollaborator Cloud Function (deploy functions or run the Firebase emulator).",
          variant: "destructive",
        });
      }
      const inv = await fetchCollaboratorInviteByToken(token!);
      const effectiveOwner = inv?.ownerUid || uid;
      setOwnerUid(effectiveOwner);

      const [evRow, riders, crew, agreements, draft] = await Promise.all([
        fetchEventRowForCollaborator(effectiveOwner, eventId!),
        fetchRiders(eventId!),
        fetchCrew(eventId!),
        fetchAgreements(eventId!),
        fetchCollaboratorAgreementDraft(token!),
      ]);

      if (evRow) setEvent(mapEventRow(evRow));
      const md: ManagerData = {
        riders: riders as ManagerData["riders"],
        crew: crew as ManagerData["crew"],
        agreements: agreements as ManagerData["agreements"],
        agreementConfirmations: draft && draft.length ? (draft as ManagerData["agreementConfirmations"]) : [],
      };
      setManagerData(md);
      setLoading(false);
    };
    void loadData();
  }, [eventId, token, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading event...</p>
      </div>
    );
  }

  if (!event || !auth) return null;

  const canViewBudget = auth.permission === "admin";
  const tabSections = canViewBudget
    ? [...SECTIONS, { id: "budget" as const, label: "Budget", icon: Calculator }]
    : SECTIONS;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{event.name}</h1>
            <p className="text-sm text-muted-foreground">{event.date} · {event.venue}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{auth.role}</Badge>
            <Badge variant="outline">{auth.permission.replace("_", " ")}</Badge>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <Tabs defaultValue="details">
          <TabsList className="mb-4 flex-wrap">
            {tabSections.map((s) => (
              <TabsTrigger key={s.id} value={s.id} className="gap-1.5">
                <s.icon className="h-3.5 w-3.5" /> {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="details">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-lg">Event Details</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Event:</span> {event.name}</div>
                <div><span className="text-muted-foreground">Date:</span> {event.date}</div>
                <div><span className="text-muted-foreground">Venue:</span> {event.venue}</div>
                <div><span className="text-muted-foreground">Performer:</span> {event.artist || "—"}</div>
                <div><span className="text-muted-foreground">Capacity:</span> {event.capacity}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{event.event_status}</Badge></div>
              </div>
              <SectionComment sectionLabel="Event Details" eventId={eventId!} senderName={senderName} />
            </div>
          </TabsContent>

          <TabsContent value="agreement">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-lg">Agreement</h2>
              {managerData.agreements && managerData.agreements.length > 0 ? (
                <div className="space-y-2">
                  {managerData.agreements.map((a) => (
                    <div key={a.id} className="text-sm border-b pb-2 last:border-0">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{a.type} — {a.status}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No agreement data available.</p>
              )}

              <CollaboratorAgreementConfirm
                inviteToken={token!}
                ownerUid={ownerUid}
                eventId={eventId!}
                managerData={managerData}
                auth={auth}
              />

              <SectionComment sectionLabel="Agreement" eventId={eventId!} senderName={senderName} />
            </div>
          </TabsContent>

          <TabsContent value="crew">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-lg">Team / Crew</h2>
              {managerData.crew && managerData.crew.length > 0 ? (
                <div className="space-y-2">
                  {managerData.crew.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.role}</p>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.email && <span>{c.email}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No crew members assigned.</p>
              )}
              <SectionComment sectionLabel="Team / Crew" eventId={eventId!} senderName={senderName} />
            </div>
          </TabsContent>

          <TabsContent value="riders">
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-lg">Riders</h2>
              {managerData.riders && managerData.riders.length > 0 ? (
                <div className="space-y-2">
                  {managerData.riders.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{r.type}{r.description ? ` — ${r.description}` : ""}</p>
                      </div>
                      {r.fileUrl && (
                        <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No riders attached.</p>
              )}
              <SectionComment sectionLabel="Riders" eventId={eventId!} senderName={senderName} />
            </div>
          </TabsContent>

          {canViewBudget && (
            <TabsContent value="budget">
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h2 className="font-semibold text-lg">Budget</h2>
                <p className="text-sm text-muted-foreground">Budget details are visible to editors and admins.</p>
                <SectionComment sectionLabel="Budget" eventId={eventId!} senderName={senderName} />
              </div>
            </TabsContent>
          )}
        </Tabs>

        <div className="mt-6">
          <Collapsible open={messagesOpen} onOpenChange={setMessagesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between gap-2" type="button">
                <span className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" /> Messages
                </span>
                {messagesOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <EventMessages eventId={eventId!} />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </main>
    </div>
  );
}

function CollaboratorAgreementConfirm({
  inviteToken,
  ownerUid,
  eventId,
  managerData,
  auth,
}: {
  inviteToken: string;
  ownerUid: string;
  eventId: string;
  managerData: ManagerData;
  auth: AuthData | null;
}) {
  const confirmations: Array<{ party: string; confirmedAt: string; confirmedBy: string; method: string; signature: string }> = managerData.agreementConfirmations || [];
  const lastChangedAt = managerData.agreementLastChangedAt;
  const [localConfirmations, setLocalConfirmations] = useState(confirmations);
  const [confirming, setConfirming] = useState(false);

  if (confirmations.length === 0 && !lastChangedAt) return null;

  const dealParties = Array.from(new Set(confirmations.map(c => c.party)));
  const collabRole = auth?.role || "";

  const matchingParty = dealParties.find(p => {
    const norm = p.toLowerCase();
    return norm === collabRole.toLowerCase() || collabRole.toLowerCase().includes(norm);
  });

  const handleSelfConfirm = async (party: string) => {
    setConfirming(true);
    const now = new Date().toISOString();
    const confirmedBy = `${collabRole} (collaborator)`;
    const signature = await generateSignatureHash(party, now, confirmedBy);
    const newConfirmation = { party, confirmedAt: now, confirmedBy, method: "self" as const, signature };
    const updated = [...localConfirmations.filter(c => c.party !== party), newConfirmation];
    setLocalConfirmations(updated);

    try {
      await saveCollaboratorAgreementDraft(inviteToken, ownerUid, eventId, updated);
      toast({ title: "Agreement confirmed", description: `You have electronically signed the agreement as ${party}.` });
    } catch {
      toast({ title: "Could not save", description: "Confirmation was not persisted.", variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border p-4 space-y-3">
      <h3 className="font-medium text-sm">Agreement Confirmation Status</h3>
      {lastChangedAt && (
        <p className="text-xs text-muted-foreground">
          Last modified: {new Date(lastChangedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
      <div className="space-y-2">
        {dealParties.map(party => {
          const confirmation = localConfirmations.find(c => c.party === party);
          return (
            <div key={party} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
              <div className="flex items-center gap-2">
                <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                  confirmation ? "bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]" : "bg-muted text-muted-foreground"
                )}>
                  {confirmation ? <Check className="h-3 w-3" /> : party.charAt(0)}
                </div>
                <div>
                  <span className="font-medium">{party}</span>
                  {confirmation ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0",
                        confirmation.method === "self" ? "text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]" : "text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]"
                      )}>
                        {confirmation.method === "self" ? "E-Signed" : "Manual"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{confirmation.confirmedBy}</span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">Not yet confirmed</p>
                  )}
                </div>
              </div>
              {!confirmation && matchingParty === party && (
                <Button size="sm" variant="outline" className="gap-1 text-xs" type="button" disabled={confirming} onClick={() => void handleSelfConfirm(party)}>
                  <CheckCircle2 className="h-3 w-3" /> Confirm
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
