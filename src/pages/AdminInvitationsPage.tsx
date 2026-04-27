import { useState, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { useIsAdmin, useRevokeInvitationCode } from "@/lib/queries/useInvitationCodes";
import { fetchAllInvitationCodes } from "@/lib/db";
import type { InvitationCode } from "@/lib/db";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert,
  Plus,
  Copy,
  XCircle,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast, copyToast } from "@/hooks/use-toast";

const PAGE_SIZE = 20;

const statusColors: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  used: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  revoked: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function formatDate(val: unknown): string {
  if (!val) return "—";
  // Firestore Timestamp
  if (typeof val === "object" && val !== null && "toDate" in val) {
    return (val as { toDate: () => Date }).toDate().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  // ISO string
  if (typeof val === "string") {
    return new Date(val).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return "—";
}

export default function AdminInvitationsPage() {
  const { data: isAdmin, isLoading: adminLoading } = useIsAdmin();

  if (adminLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-bold">Access denied</h1>
          <p className="text-muted-foreground">You don't have admin access.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <AdminInvitationsContent />
    </AppLayout>
  );
}

function AdminInvitationsContent() {
  const [codes, setCodes] = useState<InvitationCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cursors, setCursors] = useState<(QueryDocumentSnapshot | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const revokeMutation = useRevokeInvitationCode();

  const loadPage = useCallback(
    async (cursor: QueryDocumentSnapshot | null, filter: string) => {
      setLoading(true);
      try {
        const result = await fetchAllInvitationCodes(
          PAGE_SIZE,
          cursor,
          filter === "all" ? undefined : filter,
        );
        setCodes(result.codes);
        setHasMore(result.hasMore);
        if (result.lastDoc) {
          setCursors((prev) => {
            const next = [...prev];
            next[page + 1] = result.lastDoc;
            return next;
          });
        }
      } catch {
        toast({ title: "Failed to load invitation codes", variant: "destructive" });
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    },
    [page],
  );

  // Initial load
  if (!loaded && !loading) {
    loadPage(null, statusFilter);
  }

  const handleFilterChange = (val: string) => {
    setStatusFilter(val);
    setPage(0);
    setCursors([null]);
    setLoaded(false);
  };

  const handleRefresh = () => {
    setCursors([null]);
    setPage(0);
    loadPage(null, statusFilter);
  };

  const handleNextPage = () => {
    const nextCursor = cursors[page + 1];
    if (nextCursor) {
      setPage((p) => p + 1);
      loadPage(nextCursor, statusFilter);
    }
  };

  const handlePrevPage = () => {
    if (page > 0) {
      const prevCursor = cursors[page - 1];
      setPage((p) => p - 1);
      loadPage(prevCursor, statusFilter);
    }
  };

  const handleRevoke = (code: string) => {
    revokeMutation.mutate(code, {
      onSuccess: () => {
        setCodes((prev) =>
          prev.map((c) => (c.code === code ? { ...c, status: "revoked" as const } : c)),
        );
      },
    });
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    copyToast("Code copied to clipboard");
  };

  return (
    <div className="animate-fade-in max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invitation Codes</h1>
          <p className="text-muted-foreground mt-1">Manage all invitation codes across the platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create Code
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Label className="text-sm">Status:</Label>
        <Select value={statusFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="used">Used</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Used by</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : codes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  No invitation codes found.
                </TableCell>
              </TableRow>
            ) : (
              codes.map((c) => (
                <TableRow key={c.code}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${statusColors[c.status] ?? ""}`}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {c.recipientName || c.recipientEmail ? (
                      <div>
                        {c.recipientName && (
                          <p className="text-sm font-medium">{c.recipientName}</p>
                        )}
                        {c.recipientEmail && (
                          <p className="text-xs text-muted-foreground">{c.recipientEmail}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {c.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.usedByUid ? (
                      <span>{formatDate(c.usedAt)}</span>
                    ) : (
                      <span>—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleCopy(c.code)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {c.status === "active" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          disabled={revokeMutation.isPending}
                          onClick={() => handleRevoke(c.code)}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {page + 1} {hasMore && "· more available"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={handlePrevPage}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || loading}
            onClick={handleNextPage}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      <CreateCodeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleRefresh}
      />
    </div>
  );
}

// ── Create Code Dialog ──────────────────────────────────────────────────────

interface CreateCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function CreateCodeDialog({ open, onOpenChange, onCreated }: CreateCodeDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState("");

  const handleCreate = async () => {
    setCreating(true);
    try {
      const createInvitationCode = httpsCallable<
        { recipientEmail?: string; recipientName?: string; source: string },
        { code: string }
      >(getFirebaseFunctions(), "createInvitationCode");

      const result = await createInvitationCode({
        source: "admin",
        recipientEmail: recipientEmail.trim() || undefined,
        recipientName: recipientName.trim() || undefined,
      });

      setCreatedCode(result.data.code);
      toast({ title: "Invitation code created", description: result.data.code });
      onCreated();
    } catch {
      toast({ title: "Failed to create code", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setRecipientEmail("");
      setRecipientName("");
      setCreatedCode("");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Invitation Code</DialogTitle>
        </DialogHeader>
        {createdCode ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Code created successfully. Share it with the recipient.
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3">
              <span className="font-mono text-lg font-semibold flex-1">{createdCode}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(createdCode);
                  copyToast("Code copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button className="w-full" onClick={() => handleClose(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div>
              <Label>Recipient Name (optional)</Label>
              <Input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Name"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Recipient Email (optional)</Label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="email@example.com"
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating} className="gap-2">
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Create
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
