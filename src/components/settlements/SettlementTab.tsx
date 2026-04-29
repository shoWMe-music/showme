import { useState } from "react";
import {
  Send, PenLine, Check, Share2, Copy, MessageSquare, Download, CreditCard,
  Clock, FileText, CheckCircle2, Paperclip, X, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast, copyToast } from "@/hooks/use-toast";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import {
  formatCurrency, SettlementStatus,
  type Event as AppEvent, type DealStructure, type TicketRevenue, type Settlement, type PartyBreakdown,
} from "@/lib/models";
import { exportSettlementCSV, exportSettlementPDF } from "./settlementExport";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";

function formatFileSize(size: number): string {
  return size > 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;
}

export function SettlementTab({ event, deal, revenue, settlement, buildPayoutRows, settlementTotal, updateSettlementStatus, addComment, generateShareLink, currentUser, currency = "EUR", updateRevenue, partyBreakdowns, totalRevenue, totalDeductions, netRevenue, partyNames }: {
  event: AppEvent; deal?: DealStructure; revenue?: TicketRevenue; settlement: Settlement;
  buildPayoutRows: () => { label: string; value: number; color: string; role: string }[];
  settlementTotal: number;
  updateSettlementStatus: (eventId: string, status: SettlementStatus) => void;
  addComment: (eventId: string, party: string, message: string, attachments?: { name: string; size: number; type: string; fileUrl: string }[]) => void;
  generateShareLink: (eventId: string, parties: string[]) => string;
  currentUser: { name: string; roles: string[] };
  currency?: string;
  updateRevenue: (eventId: string, revenue: TicketRevenue) => void;
  partyBreakdowns: PartyBreakdown[];
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
  partyNames?: Record<string, string>;
}) {
  const [commentText, setCommentText] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [submittingComment, setSubmittingComment] = useState(false);

  const isOperator = currentUser.roles.includes("promoter") || currentUser.roles.includes("venue") || currentUser.roles.includes("organizer");

  const handleAddComment = async () => {
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const partyName = currentUser.roles.includes("performer") ? "Performer Agent" : currentUser.name;
      const attachments = await Promise.all(attachedFiles.map(async (f) => {
        const safeName = f.name.replace(/[^\w.\-]+/g, "_");
        const path = `settlement-comments/${event.id}/${Date.now()}-${safeName}`;
        const fileUrl = await uploadUserBinary(path, f, f.type || undefined);
        return { name: f.name, size: f.size, type: f.type || f.name.split(".").pop() || "file", fileUrl };
      }));
      addComment(event.id, partyName, commentText.trim(), attachments.length > 0 ? attachments : undefined);
      setCommentText("");
      setAttachedFiles([]);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message || "Could not upload attachment", variant: "destructive" });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleShare = () => {
    const link = generateShareLink(event.id, ["Performer", "Agent", "Venue"]);
    setShareLink(link);
  };

  const handleCopy = () => {
    if (shareLink) { navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const handleReOpen = () => {
    updateSettlementStatus(event.id, "pending_review");
    toast({ title: "Settlement re-opened", description: "Settlement has been moved back to Pending Review." });
  };

  const exportArgs = { event, deal, revenue, settlement, currency, partyBreakdowns, buildPayoutRows, totalRevenue, totalDeductions, netRevenue };

  const operatorRole = event.operatorType;
  const roleToPartyLabel: Record<string, string> = { promoter: "Promoter", venue: "Venue", artist: "Performer", organizer: "Organizer" };
  const payoutRows = buildPayoutRows();
  const payoutTotal = payoutRows.filter(r => r.value > 0).reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-6">
      <SettlementBreakdownCards
        partyBreakdowns={partyBreakdowns}
        settlementTotal={settlementTotal}
        totalRevenue={totalRevenue}
        totalDeductions={totalDeductions}
        netRevenue={netRevenue}
        deal={deal}
        currency={currency}
        operatorRole={operatorRole}
        partyNames={partyNames}
      />

      {/* Total Payouts with progress bars */}
      <div className="rounded-xl border bg-card p-6 shadow-sm ">
        <h3 className="font-display text-lg font-semibold mb-4">Total Payouts</h3>
        <p className="text-xs text-muted-foreground mb-4">
          As {roleToPartyLabel[operatorRole] || operatorRole} (operator), your share is retained. Below are the amounts payable to other parties.
        </p>
        <div className="space-y-3">
          {payoutRows.map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium">{row.label}</span>
                {row.value >= 0 ? (
                  <span className="font-display font-semibold">{formatCurrency(row.value, currency)}</span>
                ) : (
                  <span className="font-display font-semibold text-[hsl(var(--warning))]">
                    Owed to you: {formatCurrency(Math.abs(row.value), currency)}
                  </span>
                )}
              </div>
              {row.value >= 0 && (
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary transition-all rounded-full" style={{ width: `${payoutTotal > 0 ? Math.max((row.value / payoutTotal) * 100, 2) : 0}%` }} />
                </div>
              )}
            </div>
          ))}
          <div className="flex justify-between border-t pt-3 mt-2">
            <span className="font-semibold">Total Payable</span>
            <span className="font-bold font-display text-lg">{formatCurrency(payoutTotal, currency)}</span>
          </div>
        </div>
      </div>

      {/* Workflow */}
      {isOperator && (
        <div className="rounded-xl border bg-card p-6 shadow-sm ">
          <h3 className="font-display text-lg font-semibold mb-4">Workflow Actions</h3>
          <div className="flex flex-wrap gap-2">
            {settlement.status !== "finalized" && settlement.status !== "paid" && (
              <Button onClick={() => updateSettlementStatus(event.id, "pending_review")}>
                <Send className="h-4 w-4 mr-2" />
                {settlement.status === "pending_review" ? "Resend for Review" : "Send for Review"}
              </Button>
            )}
            {(settlement.status === "comments_received" || settlement.status === "revised" || settlement.status === "pending_review") && (
              <Button onClick={() => updateSettlementStatus(event.id, "finalized")}><Check className="h-4 w-4 mr-2" /> Finalize</Button>
            )}
            {settlement.status === "finalized" && <Button onClick={() => updateSettlementStatus(event.id, "paid")} className="gap-2"><CreditCard className="h-4 w-4" /> Mark as Paid</Button>}
            {(settlement.status === "finalized" || settlement.status === "paid") && (
              <Button variant="outline" onClick={handleReOpen} className="gap-2"><RotateCcw className="h-4 w-4" /> Re-Open Settlement</Button>
            )}
            <Button variant="outline" onClick={handleShare} className="gap-2"><Share2 className="h-4 w-4" /> Share for Review</Button>
            <Button variant="outline" onClick={() => exportSettlementCSV(exportArgs)} className="gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
            <Button variant="outline" onClick={() => exportSettlementPDF(exportArgs)} className="gap-2"><FileText className="h-4 w-4" /> Export PDF</Button>
          </div>
          {shareLink && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted p-3">
              <Input value={shareLink} readOnly className="text-xs font-mono" />
              <Button variant="outline" size="icon" onClick={handleCopy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
            </div>
          )}
        </div>
      )}

      {/* Approvals */}
      <div className="rounded-xl border bg-card p-6 shadow-sm ">
        <h3 className="font-display text-lg font-semibold mb-4">Approval Status</h3>
        <div className="space-y-3">
          {settlement.approvals.map(a => (
            <div key={a.party} className="flex items-center justify-between">
              <span className="text-sm font-medium">{a.party}</span>
              {a.approved ? (
                <Badge variant="outline" className="text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)] text-xs"><CheckCircle2 className="h-3 w-3 mr-1" /> Approved</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-xs">Pending</Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Revisions */}
      {settlement.revisions.length > 0 && (
        <div className="rounded-xl border bg-card p-6 shadow-sm ">
          <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2"><Clock className="h-5 w-5" /> Revision History</h3>
          <div className="space-y-3">
            {settlement.revisions.map((r, i) => (
              <div key={i} className="flex gap-3 text-sm"><span className="text-muted-foreground whitespace-nowrap">{r.date}</span><div><span className="font-medium">{r.by}</span><span className="text-muted-foreground"> — {r.changes}</span></div></div>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      <div id="settlement-comments" className="rounded-xl border bg-card p-6 shadow-sm ">
        <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Comments ({settlement.comments.length})</h3>
        {settlement.comments.length > 0 && (
          <div className="space-y-4 mb-4">
            {settlement.comments.map((c, i) => (
              <div key={i} className="rounded-lg bg-muted p-4">
                <div className="flex items-center justify-between mb-1"><span className="text-sm font-semibold">{c.party}</span><span className="text-xs text-muted-foreground">{c.date}</span></div>
                <p className="text-sm">{c.message}</p>
                {c.attachments && c.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {c.attachments.map((a, j) => <a key={j} href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs border hover:bg-muted"><FileText className="h-3 w-3" /> {a.name} <span className="text-muted-foreground">({formatFileSize(a.size)})</span></a>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2"><Textarea value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }} placeholder="Add a comment… (Enter to send, Shift+Enter for new line)" className="min-h-[80px]" /></div>
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {attachedFiles.map((f, i) => <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs border"><FileText className="h-3 w-3" /> {f.name}<button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button></span>)}
          </div>
        )}
        <div className="flex justify-between mt-2">
          <div>
            <input type="file" accept=".doc,.docx,.pdf,.csv,.xls,.xlsx" multiple className="hidden" id="settlement-file-upload" onChange={e => { if (e.target.files) { setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ""; } }} />
            <Button variant="ghost" size="sm" onClick={() => document.getElementById("settlement-file-upload")?.click()}><Paperclip className="h-4 w-4 mr-1" /> Attach File</Button>
          </div>
          <Button size="sm" onClick={handleAddComment} disabled={!commentText.trim() || submittingComment}>{submittingComment ? "Uploading…" : "Add Comment"}</Button>
        </div>
      </div>
    </div>
  );
}
