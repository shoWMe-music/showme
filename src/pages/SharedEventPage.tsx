import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams, useSearch, useNavigate } from "@tanstack/react-router";
import {
  callConfirmShareParty,
  fetchPublicShareByToken,
  getShareIdentity,
  ShareAuthRequiredError,
  type Todo,
} from "@/lib/db";
import ShareOtpGate from "@/components/share/ShareOtpGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/models";
import type { DealStructure, Event, EventCollaborator, ScheduleItem, CrewMember, TicketType, Agreement, Rider, ProEstimate, Settlement } from "@/lib/models";
import { generateSignatureHash } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Calendar, MapPin, Music, Users, Ticket, DollarSign, Clock, FileText, Share2, AlertCircle, CheckCircle2, Check, FileBox, Calculator, TrendingUp, ListChecks, StickyNote, Receipt, Download, Sparkles } from "lucide-react";

interface AgreementConfirmation {
  party: string;
  confirmedAt: string;
  confirmedBy: string;
  method: string;
  signature: string;
}

interface BudgetField {
  id?: string;
  name: string;
  value: number;
}

interface BudgetSnapshot {
  revenueFields?: BudgetField[];
  costFields?: BudgetField[];
  resultFields?: BudgetField[];
}

interface ManagerData {
  dealDescription?: string;
  agreementConfirmations?: AgreementConfirmation[];
  agreementLastChangedAt?: string;
  schedule?: ScheduleItem[];
  crew?: CrewMember[];
  agreements?: Agreement[];
  collaborators?: EventCollaborator[];
  riders?: Rider[];
  crewScheduleItems?: { id: string; time: string; label: string; assignee: string }[];
  todos?: Todo[];
  privateNotes?: { id: string; text: string; assignee: string }[];
  proEstimate?: ProEstimate;
  budget?: BudgetSnapshot;
}

interface SharedEventSnapshot {
  event?: Event;
  deal?: DealStructure;
  revenue?: { ticketTypes?: TicketType[] };
  settlement?: Settlement;
  currency?: string;
  eventMeta?: ManagerData;
  managerData?: ManagerData;
}

export default function SharedEventPage() {
  const { eventId } = useParams({ from: "/shared/event/$eventId" });
  const search = useSearch({ from: "/shared/event/$eventId" });
  const navigate = useNavigate();

  const [snapshot, setSnapshot] = useState<SharedEventSnapshot | null>(null);
  const [shareInfo, setShareInfo] = useState<{ createdBy: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  /** Bumped after the OTP gate unlocks so the load effect re-runs. */
  const [reloadTick, setReloadTick] = useState(0);

  const token = search.token;
  const tabs = search.tabs?.split(",").filter(Boolean) || [];
  const sections = search.sections?.split(",").filter(Boolean) || [];
  const showAll = tabs.length === 0 && sections.length === 0;

  const showTab = (tabId: string) => showAll || tabs.includes(tabId);
  const showSection = (sectionId: string) => showAll || sections.includes(sectionId) || tabs.some(t => {
    const tabSections: Record<string, string[]> = {
      details: ["event-info", "ticketing", "production-schedule", "riders", "deal-structure"],
      agreement: ["event-summary", "agreements-docs", "terms"],
      crew: ["shared-team", "schedule", "tasks", "private-notes"],
      settlement: ["settlement-overview"],
      budget: ["budget-calculator", "budget-charts", "pro-estimator"],
    };
    return tabSections[t]?.includes(sectionId);
  });

  useEffect(() => {
    if (!token || !eventId) return;

    const resolve = async () => {
      setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const pub = await fetchPublicShareByToken(token);
        if (!pub || pub.kind !== "event_snapshot" || pub.eventId !== eventId) {
          setError({ code: "NOT_FOUND", message: "This shared link is invalid or has expired." });
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
        if (err instanceof ShareAuthRequiredError) {
          setAuthRequired(true);
          setSnapshot(null);
        } else {
          const msg = err instanceof Error ? err.message : "Failed to load shared event.";
          setError({ code: "NETWORK", message: msg });
        }
      }
      setLoading(false);
    };
    void resolve();
  }, [token, eventId, reloadTick]);

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

  // OTP gate — getPublicShare rejected with permission-denied, meaning the
  // share is protected and the caller has no Firebase Auth identity on the
  // recipient list nor a valid OTP JWT. Render the gate; on unlock, bump the
  // reload tick so the load effect re-runs (which now picks up the cached JWT).
  if (authRequired && token) {
    return (
      <ShareOtpGate
        token={token}
        onUnlocked={() => setReloadTick((t) => t + 1)}
      />
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
  const settlement = snapshot.settlement;
  const managerData = snapshot.eventMeta ?? snapshot.managerData;
  const budget = managerData?.budget;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header bar */}
        <div className="flex items-center justify-between mb-6">
          <img src="/images/showme-logo.png" alt="shoWMe" className="h-8" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
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
                {event.tickets?.length ? (
                  <div>
                    <span className="text-muted-foreground">Ticketing:</span>{" "}
                    <span className="font-medium ml-2">
                      {Array.from(new Set(event.tickets.map(t => t.provider).filter(Boolean))).join(", ")}
                    </span>
                  </div>
                ) : null}
              </div>
              {event.notes && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Notes</div>
                  <p className="text-sm whitespace-pre-wrap">{event.notes}</p>
                </div>
              )}
              {((event.amenities && event.amenities.length > 0) || event.cateringNotes || event.accommodationNotes) && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Amenities
                  </div>
                  {event.amenities && event.amenities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {event.amenities.map((a) => (
                        <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                  )}
                  {event.cateringNotes && (
                    <div className="mt-2">
                      <div className="text-xs font-medium mb-0.5">Catering</div>
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{event.cateringNotes}</p>
                    </div>
                  )}
                  {event.accommodationNotes && (
                    <div className="mt-2">
                      <div className="text-xs font-medium mb-0.5">Accommodation</div>
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{event.accommodationNotes}</p>
                    </div>
                  )}
                </div>
              )}
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

          {/* Riders & Documents */}
          {showSection("riders") && managerData?.riders && managerData.riders.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><FileBox className="h-5 w-5 text-primary" /> Riders & Documents</h3>
              <div className="space-y-2">
                {managerData.riders.map((r: Rider) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 text-sm gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.name}</div>
                      {r.fileName && (
                        <div className="text-xs text-muted-foreground truncate">{r.fileName}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs capitalize">{r.type}</Badge>
                      {r.fileUrl && (
                        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                          <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" download={r.fileName}>
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agreements & Documents */}
          {showSection("agreements-docs") && managerData?.agreements && managerData.agreements.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Agreements & Documents</h3>
              <div className="space-y-2">
                {managerData.agreements.map((a: Agreement) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border p-3 text-sm gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{a.name}</div>
                      {a.fileName && (
                        <div className="text-xs text-muted-foreground truncate">{a.fileName}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs capitalize">{a.type}</Badge>
                      <Badge variant="outline" className="text-xs capitalize">{a.status}</Badge>
                      {a.fileUrl && (
                        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
                          <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" download={a.fileName}>
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
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

          {/* Team Schedule */}
          {showSection("schedule") && managerData?.crewScheduleItems && managerData.crewScheduleItems.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> Team Schedule</h3>
              <div className="space-y-2 text-sm">
                {managerData.crewScheduleItems.map((s) => (
                  <div key={s.id} className="flex items-center gap-4">
                    <span className="text-muted-foreground w-14 shrink-0">{s.time || "--:--"}</span>
                    <span className="font-medium flex-1">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{s.assignee || "Unassigned"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          {showSection("tasks") && managerData?.todos && managerData.todos.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><ListChecks className="h-5 w-5 text-primary" /> Tasks</h3>
              <div className="space-y-2">
                {managerData.todos.map((t: Todo) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      {t.completed ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" /> : <div className="h-4 w-4 rounded-full border" />}
                      <span className={t.completed ? "line-through text-muted-foreground" : "font-medium"}>{t.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{t.assignee || "Unassigned"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Private Notes */}
          {showSection("private-notes") && managerData?.privateNotes && managerData.privateNotes.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><StickyNote className="h-5 w-5 text-primary" /> Private Notes</h3>
              <div className="space-y-2">
                {managerData.privateNotes.map((n) => (
                  <div key={n.id} className="rounded-lg border p-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.text}</p>
                    <p className="text-xs text-muted-foreground mt-1">{n.assignee || "Unassigned"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settlement Overview */}
          {showSection("settlement-overview") && settlement && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-primary" /> Settlement</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <span className="font-medium ml-2 capitalize">{settlement.status}</span></div>
                {settlement.artistPayout > 0 && <div><span className="text-muted-foreground">Performer Payout:</span> <span className="font-medium ml-2">{formatCurrency(settlement.artistPayout)}</span></div>}
                {settlement.venuePayout > 0 && <div><span className="text-muted-foreground">Venue Payout:</span> <span className="font-medium ml-2">{formatCurrency(settlement.venuePayout)}</span></div>}
                {settlement.promoterPayout > 0 && <div><span className="text-muted-foreground">Promoter Payout:</span> <span className="font-medium ml-2">{formatCurrency(settlement.promoterPayout)}</span></div>}
              </div>
            </div>
          )}

          {/* Budget Calculator */}
          {showSection("budget-calculator") && budget && ((budget.revenueFields && budget.revenueFields.length > 0) || (budget.costFields && budget.costFields.length > 0) || (budget.resultFields && budget.resultFields.length > 0)) && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" /> Budget Calculator</h3>
              <div className="space-y-4 text-sm">
                {budget.revenueFields && budget.revenueFields.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Revenue</p>
                    <div className="space-y-1">
                      {budget.revenueFields.map((f) => (
                        <div key={f.name} className="flex justify-between border-b py-1">
                          <span>{f.name}</span><span className="font-medium">{formatCurrency(f.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {budget.costFields && budget.costFields.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Costs</p>
                    <div className="space-y-1">
                      {budget.costFields.map((f) => (
                        <div key={f.name} className="flex justify-between border-b py-1">
                          <span>{f.name}</span><span className="font-medium">{formatCurrency(f.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {budget.resultFields && budget.resultFields.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Result</p>
                    <div className="space-y-1">
                      {budget.resultFields.map((f) => {
                        const display = f.id === "profit_margin"
                          ? `${f.value.toFixed(1)}%`
                          : f.id === "breakeven_tickets"
                          ? Math.round(f.value).toString()
                          : formatCurrency(f.value);
                        return (
                          <div key={f.name} className="flex justify-between border-b py-1">
                            <span>{f.name}</span><span className="font-medium">{display}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Break-even Analysis */}
          {showSection("budget-charts") && budget?.resultFields && budget.resultFields.length > 0 && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Break-even Analysis</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Profit / Loss:</span>
                  <span className="font-medium ml-2">{formatCurrency(budget.resultFields.find(f => f.id === "profit_loss")?.value ?? 0)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Break-even Tickets:</span>
                  <span className="font-medium ml-2">{Math.round(budget.resultFields.find(f => f.id === "breakeven_tickets")?.value ?? 0)}</span>
                </div>
              </div>
            </div>
          )}

          {/* PRO Fee Estimate */}
          {showSection("pro-estimator") && managerData?.proEstimate && (
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> PRO Fee Estimate</h3>
              <p className="text-xs text-muted-foreground mb-3">Estimate only — review before final decisions.</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">PRO:</span> <span className="font-medium ml-2 uppercase">{managerData.proEstimate.pro}</span></div>
                <div><span className="text-muted-foreground">Country:</span> <span className="font-medium ml-2">{managerData.proEstimate.country}</span></div>
                <div><span className="text-muted-foreground">Event Type:</span> <span className="font-medium ml-2 capitalize">{String(managerData.proEstimate.eventType).replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">Ticket Price:</span> <span className="font-medium ml-2">{formatCurrency(managerData.proEstimate.ticketPrice)}</span></div>
                <div><span className="text-muted-foreground">Expected Tickets:</span> <span className="font-medium ml-2">{managerData.proEstimate.expectedTickets}</span></div>
                <div><span className="text-muted-foreground">Estimated Fee:</span> <span className="font-medium ml-2">{formatCurrency(managerData.proEstimate.estimatedFee)}</span></div>
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
              userEmail={getShareIdentity(token).email}
              onConfirmationsUpdated={(updated) => {
                setSnapshot((s) =>
                  s ? {
                    ...s,
                    eventMeta: { ...(s.eventMeta ?? s.managerData), agreementConfirmations: updated },
                  } : null,
                );
              }}
              onConfirmed={() => setReloadTick((t) => t + 1)}
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
  onConfirmed,
}: {
  shareToken: string;
  eventId: string;
  managerData: ManagerData;
  deal: DealStructure | undefined;
  userEmail: string | null;
  onConfirmationsUpdated: (rows: AgreementConfirmation[]) => void;
  onConfirmed?: () => void;
}) {
  // eventId is referenced by the shareToken on the server; surface it here so
  // the callsite signature stays explicit.
  void eventId;
  const confirmations: AgreementConfirmation[] = managerData.agreementConfirmations || [];
  const lastChangedAt = managerData.agreementLastChangedAt;
  const agreements = managerData.agreements || [];
  const terms = managerData.dealDescription || "";
  const collaborators: EventCollaborator[] = managerData.collaborators || [];

  const [localConfirmations, setLocalConfirmations] = useState(confirmations);

  const confirmMutation = useMutation({
    mutationFn: async ({ party }: { party: string; updated: AgreementConfirmation[] }) =>
      callConfirmShareParty(shareToken, party),
    onSuccess: (_data, vars) => {
      onConfirmationsUpdated(vars.updated);
      onConfirmed?.();
      toast({ title: "Confirmation recorded" });
    },
    onError: () => {
      toast({
        title: "Could not save",
        description: "Confirmation was not recorded. Verify your access and try again.",
        variant: "destructive",
      });
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
    confirmMutation.mutate({ party, updated });
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
