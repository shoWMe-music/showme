import { useParams, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  calculateSettlement,
  type Event as AppEvent,
  type DealStructure,
  type TicketRevenue,
  type Settlement,
  type TicketType,
  type AdditionalRevenueField,
  type CustomCostField,
  type CustomDeductionField,
  type PartySplit,
} from "@/lib/models";
import StatusBadge from "@/components/StatusBadge";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, FileText, Music, MapPin, Ticket, Users, Paperclip, X, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import showmeLogo from "@/assets/showme-logo.png";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { fetchPublicShareByToken, approvePublicShare, type SettlementShareSnapshot } from "@/lib/db";
import { queryKeys, useAddComment, useShareTokens, useEvent, useEventEconomics } from "@/lib/queries";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";

export default function SettlementReviewPage() {
  const { token } = useParams({ from: "/review/$token" });
  const { user } = useAuth();
  const navigate = useNavigate();

  const addCommentMutation = useAddComment();

  // Resolve eventId from share token cache
  const shareTokens = useShareTokens();
  const tokenRecord = token ? shareTokens[token] : undefined;
  const tokenEventId = tokenRecord?.eventId;

  // Look up live event + economics for authenticated users
  const liveEvent = useEvent(tokenEventId ?? "");
  const { deal: liveDeal, revenue: liveRevenue, settlement: liveSettlement } = useEventEconomics(
    tokenEventId ?? "",
    !!tokenEventId,
  );

  const { data: remoteResult, isPending: remoteLoading } = useQuery({
    queryKey: queryKeys.publicShareByToken(token ?? ""),
    queryFn: async (): Promise<{ snapshot: SettlementShareSnapshot; approved: boolean; updatedAtMs: number | null } | null> => {
      if (!token) return null;
      try {
        const pub = await fetchPublicShareByToken(token);
        if (pub?.snapshot?.event && pub.snapshot.deal && pub.snapshot.revenue && pub.snapshot.settlement) {
          return {
            snapshot: pub.snapshot as SettlementShareSnapshot,
            approved: pub.approved === true,
            updatedAtMs: pub.updatedAtMs ?? null,
          };
        }
        return null;
      } catch {
        return null;
      }
    },
    enabled: !!token,
  });
  const remote = remoteResult?.snapshot ?? null;
  const remoteApproved = remoteResult?.approved ?? false;
  const remoteUpdatedAtMs = remoteResult?.updatedAtMs ?? null;

  const isAuthenticated = Boolean(user);

  // Prefer live data when available; fall back to snapshot in public share doc
  const liveData = liveEvent && liveDeal && liveRevenue && liveSettlement
    ? { event: liveEvent, deal: liveDeal, revenue: liveRevenue, settlement: liveSettlement }
    : undefined;

  const data =
    remoteLoading
      ? undefined
      : liveData ?? remote ?? undefined;

  if (remoteLoading) {
    return (
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background px-6 py-4 flex items-center justify-between">
          <img src={showmeLogo} alt="showMe" className="h-6" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-40" />
          </div>
        </header>
        <div className="max-w-3xl mx-auto p-6 space-y-6">
          {/* Event header card skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          </div>

          {/* Settlement overview card skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
            <Skeleton className="h-5 w-36" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
            <div className="border-t pt-3 flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-28" />
            </div>
          </div>

          {/* Party breakdown cards skeleton (2 columns) */}
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-7 w-36" />
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3.5 w-16" />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Comments section skeleton */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-36" />
            </div>
            {[...Array(2)].map((_, i) => (
              <div key={i} className="rounded-lg bg-muted p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
            <Skeleton className="h-20 w-full rounded-md" />
            <div className="flex justify-end">
              <Skeleton className="h-8 w-32" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
        <img src={showmeLogo} alt="showMe" className="h-8 mb-6" />
        <h1 className="text-2xl font-bold font-display mb-2">Settlement Not Found</h1>
        <p className="text-muted-foreground">This review link may be invalid or expired.</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="text-center">
            <img src={showmeLogo} alt="showMe" className="h-8 mx-auto mb-4" />
            <h1 className="text-xl font-bold font-display mb-1">Settlement Review</h1>
            <p className="text-sm text-muted-foreground">Sign in with your shoWMe account to review this settlement</p>
          </div>
          <div className="space-y-3">
            <Button
              className="w-full"
              onClick={() => {
                if (!token) return;
                navigate({ to: "/login", search: { redirect: `/review/${token}` } });
              }}
            >
              Sign in to shoWMe
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (!token) return;
                navigate({ to: "/signup", search: { redirect: `/review/${token}` } });
              }}
            >
              Create an account
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            After signing in you will return to this settlement review.
          </p>
        </div>
      </div>
    );
  }

  const { event, deal, revenue, settlement } = data;
  const reviewerName = user?.displayName?.trim() || user?.email?.split("@")[0] || "Reviewer";
  const canPersistComments = Boolean(user?.uid && tokenEventId);

  const settlementTotal = settlement.artistPayout + settlement.promoterPayout + settlement.venuePayout +
    settlement.commissionPayouts.reduce((sum, c) => sum + c.payout, 0);

  const totalAdditionalRevenue = (revenue.additionalRevenue || []).reduce((s, r) => s + r.amount, 0);
  const totalRevenue = revenue.grossRevenue + revenue.doorSales + totalAdditionalRevenue;
  const totalCustomDeductions = (revenue.additionalDeductions || []).reduce((s, d) => {
    if (d.type === "percentage" && d.sourceField) {
      const src = d.sourceField === "ticketSales" ? revenue.grossRevenue : d.sourceField === "doorSales" ? revenue.doorSales : d.sourceField === "totalRevenue" ? totalRevenue : ((revenue.additionalRevenue || []).find(r => r.name === d.sourceField)?.amount || 0);
      return s + src * d.amount / 100;
    }
    return s + d.amount;
  }, 0);
  const totalCustomCosts = (revenue.customCosts || []).reduce((s, c) => s + c.amount, 0);
  const totalDeductions = (revenue.ticketFees || 0) + (revenue.tax || 0) + (revenue.refunds || 0) + (revenue.productionExpenses || 0) + (revenue.additionalCosts || 0) + totalCustomDeductions + totalCustomCosts;
  const netRevenue = totalRevenue - totalDeductions;

  const recalc = deal && revenue ? calculateSettlement(deal, revenue) : null;
  const partyBreakdowns = recalc?.partyBreakdowns || [];

  const persistComment = canPersistComments && tokenEventId
    ? (eventId: string, party: string, message: string, attachments?: { name: string; size: number; type: string; fileUrl: string }[]) => {
        addCommentMutation.mutate({
          eventId,
          party,
          message,
          attachments,
          date: new Date().toISOString().slice(0, 10),
        });
      }
    : () => {
        toast({ title: "Comments unavailable", description: "Sign in as the workspace owner on this device to post comments on this settlement.", variant: "destructive" });
      };

  const isViewingSnapshot = !liveData && !!remote;

  const tokenParties = tokenRecord?.parties ?? [];
  const viewerIsPerformer = tokenParties.length === 0
    || tokenParties.some((p) => p === "Performer" || p === "Agent");

  return <SettlementReviewContent
    event={event} deal={deal} revenue={revenue} settlement={settlement}
    reviewerName={reviewerName}
    addComment={persistComment}
    settlementTotal={settlementTotal}
    totalRevenue={totalRevenue} totalDeductions={totalDeductions} netRevenue={netRevenue}
    partyBreakdowns={partyBreakdowns}
    initialApproved={remoteApproved}
    token={token}
    snapshotUpdatedAtMs={isViewingSnapshot ? remoteUpdatedAtMs : null}
    viewerIsPerformer={viewerIsPerformer}
  />;
}

type CommentAttachment = { name: string; size: number; type: string; fileUrl: string };

function formatRelativeTime(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

function SettlementReviewContent({ event, deal, revenue, settlement, reviewerName, addComment, settlementTotal, totalRevenue, totalDeductions, netRevenue, partyBreakdowns, initialApproved, token, snapshotUpdatedAtMs, viewerIsPerformer }: {
  event: AppEvent; deal: DealStructure; revenue: TicketRevenue; settlement: Settlement; reviewerName: string;
  addComment: (eventId: string, party: string, message: string, attachments?: CommentAttachment[]) => void;
  settlementTotal: number;
  totalRevenue: number; totalDeductions: number; netRevenue: number;
  partyBreakdowns: import("@/lib/models").PartyBreakdown[];
  initialApproved: boolean;
  token: string;
  snapshotUpdatedAtMs: number | null;
  viewerIsPerformer: boolean;
}) {
  const [commentText, setCommentText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [approved, setApproved] = useState(initialApproved);
  const [submittingComment, setSubmittingComment] = useState(false);

  const handleAddComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const attachments = await Promise.all(attachedFiles.map(async (f) => {
        const safeName = f.name.replace(/[^\w.\-]+/g, "_");
        const path = `settlement-comments/${event.id}/${Date.now()}-${safeName}`;
        const fileUrl = await uploadUserBinary(path, f, f.type || undefined);
        return { name: f.name, size: f.size, type: f.type || f.name.split(".").pop() || "file", fileUrl };
      }));
      addComment(event.id, reviewerName, commentText.trim(), attachments.length > 0 ? attachments : undefined);
      setCommentText("");
      setAttachedFiles([]);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message || "Could not upload attachment", variant: "destructive" });
    } finally {
      setSubmittingComment(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-6 py-4 flex items-center justify-between">
        <img src={showmeLogo} alt="showMe" className="h-6" />
        <div className="flex items-center gap-3">
          {snapshotUpdatedAtMs !== null && (
            <span className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Last updated {formatRelativeTime(snapshotUpdatedAtMs)}
            </span>
          )}
          <span className="text-xs text-muted-foreground">Reviewing as <strong>{reviewerName}</strong></span>
          <span className="text-xs text-muted-foreground">Settlement Review</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Event Header */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold font-display">{event.name}</h1>
            <StatusBadge status={settlement.status} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {[
              { icon: Music, label: "Performer", value: event.artist },
              { icon: MapPin, label: "Venue", value: event.venue },
              { icon: Users, label: "Operator", value: `${event.operator} (${event.operatorType})` },
              { icon: Ticket, label: "Date", value: event.date },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{label}:</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue Area */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold mb-4">Revenue</h2>
          <dl className="space-y-2">
            {revenue.ticketTypes && revenue.ticketTypes.length > 0 && revenue.ticketTypes.map((t: TicketType, i: number) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t.name} ({t.sold} × {formatCurrency(t.price)})</span>
                <span className="font-medium">{formatCurrency(t.price * t.sold)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Gross Revenue (Ticket Sales)</span>
              <span className="font-medium">{formatCurrency(revenue.grossRevenue)}</span>
            </div>
            {revenue.doorSales > 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Door Sales</span><span className="font-medium">{formatCurrency(revenue.doorSales)}</span></div>}
            {(revenue.additionalRevenue || []).map((r: AdditionalRevenueField, i: number) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {r.name}
                  {r.vat && r.vat.rate > 0 && (
                    <span className="text-[10px] ml-1">({r.vat.mode === "included" ? `${r.vat.rate}% VAT incl.` : `+ ${r.vat.rate}% VAT`})</span>
                  )}
                </span>
                <span className="font-medium">{formatCurrency(r.amount)}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between">
              <span className="font-semibold">Total Revenue</span>
              <span className="font-bold font-display">{formatCurrency(totalRevenue)}</span>
            </div>
          </dl>
        </div>

        {/* Deductions & Costs Area */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold mb-4">Deductions & Costs</h2>
          <dl className="space-y-2">
            {(revenue.customCosts || []).length > 0 && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Production Costs</p>
            )}
            {(revenue.customCosts || []).map((c: CustomCostField, i: number) => (
              <div key={`cost-${i}`} className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {c.name}{c.fromParty ? ` (from ${c.fromParty})` : ""}
                  {c.vat && c.vat.rate > 0 && (
                    <span className="text-[10px] ml-1">({c.vat.mode === "included" ? `${c.vat.rate}% VAT incl.` : `+ ${c.vat.rate}% VAT`})</span>
                  )}
                </span>
                <span className="font-medium">- {formatCurrency(c.amount)}</span>
              </div>
            ))}
            {(revenue.additionalDeductions || []).length > 0 && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-2">Deductions</p>
            )}
            {(revenue.additionalDeductions || []).map((d: CustomDeductionField, i: number) => {
              let val = d.amount;
              if (d.type === "percentage" && d.sourceField) {
                const src = d.sourceField === "ticketSales" ? revenue.grossRevenue : d.sourceField === "doorSales" ? revenue.doorSales : d.sourceField === "totalRevenue" ? totalRevenue : ((revenue.additionalRevenue || []).find((r: AdditionalRevenueField) => r.name === d.sourceField)?.amount || 0);
                val = src * d.amount / 100;
              }
              const desc = d.type === "fixed"
                ? `${d.name}${d.fromParty ? ` from ${d.fromParty}` : ""}${d.toParty ? ` → ${d.toParty}` : ""}`
                : `${d.name} (${d.amount}% of ${d.sourceField})${d.partySplits && d.partySplits.length > 0 ? ` — ${d.partySplits.filter((s: PartySplit) => s.percentage > 0).map((s: PartySplit) => `${s.party} ${s.percentage}%`).join(", ")}` : ""}`;
              const vatSuffix = d.vat && d.vat.rate > 0 ? ` (${d.vat.mode === "included" ? `${d.vat.rate}% VAT incl.` : `+ ${d.vat.rate}% VAT`})` : "";
              return (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{desc}{vatSuffix}</span>
                  <span className="font-medium">- {formatCurrency(val)}</span>
                </div>
              );
            })}
            <div className="border-t pt-2 flex justify-between">
              <span className="font-semibold">Total Deductions</span>
              <span className="font-bold font-display">- {formatCurrency(totalDeductions)}</span>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-lg">Net Revenue</span>
            <span className="font-bold font-display text-xl">{formatCurrency(netRevenue)}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold mb-4">Deal Structure</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Deal Type</span><span className="font-medium capitalize">{deal.dealType.replace(/_/g, " ")}</span></div>
            {deal.artistGuarantee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Performer Guarantee</span><span className="font-semibold">{formatCurrency(deal.artistGuarantee)}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Performer / Promoter / Venue Split</span><span className="font-medium">{deal.artistSplit}% / {deal.promoterSplit}% / {deal.venueSplit}%</span></div>
            {((deal.artistCostSplit || 0) > 0 || deal.promoterCostSplit > 0 || deal.venueCostSplit > 0) && (
              <div className="flex justify-between"><span className="text-muted-foreground">Production Costs Split (A/P/V)</span><span className="font-medium">{deal.artistCostSplit || 0}% / {deal.promoterCostSplit}% / {deal.venueCostSplit}%</span></div>
            )}
            {deal.venueRental > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Venue Rental</span><span className="font-semibold">{formatCurrency(deal.venueRental)}</span></div>}
          </dl>
        </div>

        <SettlementBreakdownCards
          partyBreakdowns={partyBreakdowns}
          settlementTotal={settlementTotal}
          totalRevenue={totalRevenue}
          totalDeductions={totalDeductions}
          netRevenue={netRevenue}
          deal={deal}
          partyNames={{ Performer: event.artist, Venue: event.venue, Promoter: event.operator }}
          viewerIsPerformer={viewerIsPerformer}
        />

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold mb-4">Your Approval</h2>
          {approved ? (
            <div className="flex items-center gap-2 text-[hsl(var(--success))]">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">You have approved this settlement as {reviewerName}</span>
            </div>
          ) : (
            <Button onClick={async () => {
              try {
                await approvePublicShare(token, reviewerName);
                setApproved(true);
                toast({ title: "Settlement approved" });
              } catch {
                toast({ title: "Failed to approve settlement", description: "Please try again.", variant: "destructive" });
              }
            }} className="gap-2">
              <CheckCircle2 className="h-4 w-4" /> Approve Settlement
            </Button>
          )}
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Comments ({settlement.comments.length})
          </h2>
          {settlement.comments.length > 0 && (
            <div className="space-y-3 mb-4">
              {settlement.comments.map((c, i: number) => (
                <div key={i} className="rounded-lg bg-muted p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold">{c.party}</span>
                    <span className="text-xs text-muted-foreground">{c.date}</span>
                  </div>
                  <p className="text-sm">{c.message}</p>
                  {c.attachments && c.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {c.attachments.map((a, j: number) => (
                        <a key={j} href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs border hover:bg-muted">
                          <FileText className="h-3 w-3" /> {a.name} <span className="text-muted-foreground">({a.size > 1024 * 1024 ? `${(a.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(a.size / 1024)} KB`})</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-3">
            <Textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment or raise a correction..."
              className="min-h-[80px]"
            />
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs border">
                    <FileText className="h-3 w-3" /> {f.name}
                    <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex justify-between">
              <div>
                <input
                  type="file"
                  accept=".doc,.docx,.pdf,.csv,.xls,.xlsx"
                  multiple
                  className="hidden"
                  id="review-file-upload"
                  onChange={(e) => {
                    if (e.target.files) {
                      setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                      e.target.value = "";
                    }
                  }}
                />
                <Button variant="ghost" size="sm" type="button" onClick={() => document.getElementById("review-file-upload")?.click()}>
                  <Paperclip className="h-4 w-4 mr-1" /> Attach File
                </Button>
              </div>
              <Button size="sm" type="button" onClick={handleAddComment} disabled={!commentText.trim() || submittingComment}>
                {submittingComment ? "Uploading…" : "Submit Comment"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
