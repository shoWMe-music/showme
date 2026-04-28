import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Send, PenLine, Check, Share2, Copy, Clock, MessageSquare, FileText, Paperclip, X } from "lucide-react";
import SettlementBreakdownCards from "@/components/SettlementBreakdownCards";
import type { Event, Settlement, PartyBreakdown, DealStructure, SettlementStatus } from "@/lib/models";

interface SettlementTabProps {
  event: Event;
  settlement: Settlement;
  buildPayoutRows: () => { label: string; value: number; color: string }[];
  settlementTotal: number;
  updateSettlementStatus: (eventId: string, status: SettlementStatus) => void;
  addComment: (eventId: string, party: string, message: string, attachments?: { name: string; size: string; type: string }[]) => void;
  generateShareLink: (eventId: string, parties: string[]) => string;
  currentUser: { name: string; roles: string[] };
  partyBreakdowns: PartyBreakdown[];
  totalRevenue: number;
  totalDeductions: number;
  netRevenue: number;
  deal?: DealStructure;
}

export function SettlementTab({ event, settlement, buildPayoutRows, settlementTotal, updateSettlementStatus, addComment, generateShareLink, currentUser, partyBreakdowns, totalRevenue, totalDeductions, netRevenue, deal }: SettlementTabProps) {
  const [commentText, setCommentText] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const isOperator = currentUser.roles.includes("promoter") || currentUser.roles.includes("venue") || currentUser.roles.includes("organizer");

  const handleSendForReview = () => {
    updateSettlementStatus(event.id, "pending_review");
  };

  const handleRevise = () => {
    updateSettlementStatus(event.id, "pending_review");
  };

  const handleFinalize = () => {
    updateSettlementStatus(event.id, "finalized");
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    const partyName = currentUser.roles.includes("performer") ? "Performer Agent" : currentUser.name;
    const attachments = attachedFiles.map(f => ({
      name: f.name,
      size: f.size > 1024 * 1024 ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(f.size / 1024)} KB`,
      type: f.type || f.name.split(".").pop() || "file",
    }));
    addComment(event.id, partyName, commentText.trim(), attachments.length > 0 ? attachments : undefined);
    setCommentText("");
    setAttachedFiles([]);
  };

  const handleShare = () => {
    const token = generateShareLink(event.id, ["Performer", "Agent", "Venue"]);
    const link = `${window.location.origin}/review/${token}`;
    setShareLink(link);
  };

  const handleCopy = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <SettlementBreakdownCards
        partyBreakdowns={partyBreakdowns}
        settlementTotal={settlementTotal}
        totalRevenue={totalRevenue}
        totalDeductions={totalDeductions}
        netRevenue={netRevenue}
        deal={deal}
      />

      {/* Workflow Actions */}
      {isOperator && (
        <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl">
          <h3 className="font-display text-lg font-semibold mb-4">Workflow Actions</h3>
          <div className="flex flex-wrap gap-2">
            {settlement.status === "open" && (
              <Button onClick={handleSendForReview}>
                <Send className="h-4 w-4 mr-2" /> Send for Review
              </Button>
            )}
            {(settlement.status === "comments_received" || settlement.status === "revised") && (
              <>
                <Button onClick={handleRevise} variant="outline">
                  <PenLine className="h-4 w-4 mr-2" /> Send Revised for Review
                </Button>
                <Button onClick={handleFinalize}>
                  <Check className="h-4 w-4 mr-2" /> Finalize Settlement
                </Button>
              </>
            )}
            {settlement.status === "pending_review" && (
              <Button onClick={handleFinalize}>
                <Check className="h-4 w-4 mr-2" /> Finalize Settlement
              </Button>
            )}
            {settlement.status !== "finalized" && (
              <Button variant="outline" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" /> Share for Review
              </Button>
            )}
          </div>

          {shareLink && (
            <div className="mt-4 rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground mb-2">Share this link with external parties:</p>
              <div className="flex gap-2">
                <Input value={shareLink} readOnly className="text-xs font-mono" />
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Approval Status */}
      <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl">
        <h3 className="font-display text-lg font-semibold mb-4">Approval Status</h3>
        <div className="space-y-3">
          {settlement.approvals.map((a) => (
            <div key={a.party} className="flex items-center justify-between">
              <span className="text-sm font-medium">{a.party}</span>
              <div className="flex items-center gap-2">
                {a.approved ? (
                  <span className="text-xs font-semibold text-success">Approved {a.date}</span>
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">Pending</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Revision Log */}
      {settlement.revisions.length > 0 && (
        <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl">
          <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5" /> Revision History
          </h3>
          <div className="space-y-3">
            {settlement.revisions.map((r, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-muted-foreground whitespace-nowrap">{r.date}</span>
                <div>
                  <span className="font-medium">{r.by}</span>
                  <span className="text-muted-foreground"> — {r.changes}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      <div className="rounded-xl border bg-card p-6 shadow-sm max-w-2xl">
        <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5" /> Comments ({settlement.comments.length})
        </h3>
        {settlement.comments.length > 0 && (
          <div className="space-y-4 mb-4">
            {settlement.comments.map((c, i) => (
              <div key={i} className="rounded-lg bg-muted p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">{c.party}</span>
                  <span className="text-xs text-muted-foreground">{c.date}</span>
                </div>
                <p className="text-sm">{c.message}</p>
                {c.attachments && c.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {c.attachments.map((a, j) => (
                      <span key={j} className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs border">
                        <FileText className="h-3 w-3" /> {a.name} <span className="text-muted-foreground">({a.size})</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            className="min-h-[80px]"
          />
        </div>
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {attachedFiles.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs border">
                <FileText className="h-3 w-3" /> {f.name}
                <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="ml-1 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex justify-between mt-2">
          <div>
            <input
              type="file"
              accept=".doc,.docx,.pdf,.csv,.xls,.xlsx"
              multiple
              className="hidden"
              id="settlement-file-upload"
              onChange={(e) => {
                if (e.target.files) {
                  setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => document.getElementById("settlement-file-upload")?.click()}>
              <Paperclip className="h-4 w-4 mr-1" /> Attach File
            </Button>
          </div>
          <Button size="sm" onClick={handleAddComment} disabled={!commentText.trim()}>
            Add Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
