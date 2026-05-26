import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  Loader2,
  RefreshCw,
  Pencil,
  Search,
  Crown,
} from "lucide-react";

import AppLayout from "@/components/AppLayout";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { useIsAdmin } from "@/lib/queries/useInvitationCodes";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { PLAN_LABELS, isPaidPlan, type PlanType, type ProfilePlan } from "@/lib/plans";

// ────────────────────────────────────────────────────────────────────────────
// Types mirroring the listProfilesForAdmin / setPlan callable shapes
// ────────────────────────────────────────────────────────────────────────────

interface AdminProfileRow {
  profileId: string;
  name: string;
  role: string;
  ownerUid: string;
  ownerEmail: string | null;
  acquired: boolean;
  isPublic: boolean;
  plan: ProfilePlan | null;
}

interface ListResult {
  rows: AdminProfileRow[];
  total: number;
}

type PlanFilter = PlanType | "none" | "all";
type RoleFilter = "all" | "venue" | "promoter" | "organizer" | "festival" | "performer";

const PLAN_FILTERS: Array<{ value: PlanFilter; label: string }> = [
  { value: "all", label: "All plans" },
  { value: "none", label: "No plan doc" },
  { value: "free_operator", label: "Free Operator" },
  { value: "operator_pro", label: "Operator Pro" },
  { value: "free_artist", label: "Free Artist" },
  { value: "artist_pro", label: "Artist Pro" },
];

const ROLE_FILTERS: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All roles" },
  { value: "venue", label: "Venue" },
  { value: "promoter", label: "Promoter" },
  { value: "organizer", label: "Organizer" },
  { value: "festival", label: "Festival" },
  { value: "performer", label: "Performer" },
];

const planBadgeStyle: Record<PlanType, string> = {
  operator_pro: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  artist_pro: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  free_operator: "border-muted-foreground/30 bg-muted text-muted-foreground",
  free_artist: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

// ────────────────────────────────────────────────────────────────────────────
// Page shell (admin gate)
// ────────────────────────────────────────────────────────────────────────────

export default function AdminPlansPage() {
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
          <p className="text-muted-foreground">You don&apos;t have admin access.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <AdminPlansContent />
    </AppLayout>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main content
// ────────────────────────────────────────────────────────────────────────────

function AdminPlansContent() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [editTarget, setEditTarget] = useState<AdminProfileRow | null>(null);

  // Debounce the search input so each keystroke doesn't fan out a server
  // round-trip. 250ms feels responsive without thrashing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ["adminPlans", debouncedSearch, planFilter, roleFilter],
    queryFn: async (): Promise<ListResult> => {
      const fn = httpsCallable<
        { search?: string; planType?: PlanFilter; role?: RoleFilter },
        ListResult
      >(getFirebaseFunctions(), "listProfilesForAdmin");
      const res = await fn({
        search: debouncedSearch || undefined,
        planType: planFilter,
        role: roleFilter,
      });
      return res.data;
    },
    staleTime: 15_000,
  });

  const rows = query.data?.rows ?? [];

  return (
    <div className="animate-fade-in max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plans</h1>
          <p className="text-muted-foreground mt-1">
            Manually assign and change profile plans. Changes take effect immediately —
            no JWT refresh delay because plan is read directly from Firestore in rules.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-64">
          <Label className="text-xs">Search by name or profile ID</Label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Sunset Venue or abc123__venue"
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Plan</Label>
          <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as PlanFilter)}>
            <SelectTrigger className="w-44 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Role</Label>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
            <SelectTrigger className="w-44 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Renews</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : query.isError ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-destructive">
                  Failed to load. {(query.error as Error)?.message}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No profiles match.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => <PlanRow key={row.profileId} row={row} onEdit={setEditTarget} />)
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer count */}
      {query.data && (
        <p className="text-xs text-muted-foreground">
          Showing {query.data.total} profile{query.data.total === 1 ? "" : "s"}.
        </p>
      )}

      <SetPlanDialog
        open={editTarget !== null}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        row={editTarget}
      />
    </div>
  );
}

function PlanRow({
  row,
  onEdit,
}: {
  row: AdminProfileRow;
  onEdit: (r: AdminProfileRow) => void;
}) {
  const plan = row.plan;
  const planType = plan?.type;

  return (
    <TableRow>
      <TableCell>
        <div>
          <p className="text-sm font-medium">{row.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono">{row.profileId}</p>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs capitalize">{row.role}</Badge>
      </TableCell>
      <TableCell>
        {row.ownerEmail ? (
          <div>
            <p className="text-sm">{row.ownerEmail}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{row.ownerUid.slice(0, 14)}</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">{row.ownerUid.slice(0, 14) || "—"}</span>
        )}
      </TableCell>
      <TableCell>
        {planType ? (
          <Badge variant="outline" className={`text-xs ${planBadgeStyle[planType] ?? ""}`}>
            {planType in PLAN_LABELS ? PLAN_LABELS[planType] : planType}
            {isPaidPlan(planType) && <Crown className="h-3 w-3 ml-1 inline" />}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs border-dashed text-muted-foreground">
            no plan doc
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-sm capitalize">{plan?.status ?? "—"}</TableCell>
      <TableCell className="text-sm">{plan?.seats ?? "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {plan?.renewalAt ? new Date(plan.renewalAt).toLocaleDateString() : "—"}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={() => onEdit(row)} className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" /> Set plan
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Set Plan dialog
// ────────────────────────────────────────────────────────────────────────────

function SetPlanDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: AdminProfileRow | null;
}) {
  const qc = useQueryClient();

  // Allowed plan types for this profile shape — performers can only land on
  // artist plans, operator-shaped roles on operator plans. Matches the
  // server-side assertPlanMatchesProfileRole guard.
  const allowedTypes = useMemo<PlanType[]>(() => {
    if (!row) return [];
    const r = row.role.toLowerCase();
    if (r === "performer" || r === "artist") return ["free_artist", "artist_pro"];
    return ["free_operator", "operator_pro"];
  }, [row]);

  const [planType, setPlanType] = useState<PlanType>("free_operator");
  const [status, setStatus] = useState<"active" | "cancelled">("active");
  const [seats, setSeats] = useState<number>(2);
  const [renewalAt, setRenewalAt] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");

  // Hydrate the form whenever a different row opens.
  useEffect(() => {
    if (!row) return;
    const defaultType =
      (row.plan?.type as PlanType | undefined) ?? allowedTypes[0] ?? "free_operator";
    setPlanType(defaultType);
    setStatus(row.plan?.status ?? "active");
    setSeats(row.plan?.seats ?? 2);
    setRenewalAt(row.plan?.renewalAt ? row.plan.renewalAt.slice(0, 10) : "");
    setReason("");
    setCancelReason(row.plan?.cancelReason ?? "");
  }, [row, allowedTypes]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No profile selected.");
      const fn = httpsCallable<
        {
          profileId: string;
          type: PlanType;
          status: "active" | "cancelled";
          seats?: number;
          renewalAt?: string;
          reason?: string;
          cancelReason?: string;
        },
        { ok: true; plan: ProfilePlan }
      >(getFirebaseFunctions(), "setPlan");
      // Build the payload with conditional keys rather than literal `undefined`
      // values. Firebase callable serialization doesn't always strip undefined
      // (depends on emulator vs deployed), and a stale `seats` value tagged
      // onto an Artist Pro request used to make the server reject the whole
      // save with "seats must be a positive integer".
      const payload: {
        profileId: string;
        type: PlanType;
        status: "active" | "cancelled";
        seats?: number;
        renewalAt?: string;
        reason?: string;
        cancelReason?: string;
      } = {
        profileId: row.profileId,
        type: planType,
        status,
      };
      if (planType === "operator_pro") payload.seats = seats;
      if (isPaidPlan(planType) && renewalAt) {
        payload.renewalAt = new Date(renewalAt).toISOString();
      }
      const trimmedReason = reason.trim();
      if (trimmedReason) payload.reason = trimmedReason;
      const trimmedCancel = cancelReason.trim();
      if (status === "cancelled" && trimmedCancel) payload.cancelReason = trimmedCancel;

      const res = await fn(payload);
      return res.data.plan;
    },
    onSuccess: () => {
      toast({ title: "Plan updated" });
      qc.invalidateQueries({ queryKey: ["adminPlans"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not update plan",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = useCallback(
    (next: boolean) => {
      if (mutation.isPending) return;
      onOpenChange(next);
    },
    [mutation.isPending, onOpenChange],
  );

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set plan</DialogTitle>
          <DialogDescription>
            {row.name} · <span className="font-mono text-xs">{row.profileId}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <Label className="text-xs">Plan type</Label>
            <Select value={planType} onValueChange={(v) => setPlanType(v as PlanType)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((t) => (
                  <SelectItem key={t} value={t}>{PLAN_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {row.role === "performer" ? "Performer profiles use artist plans." : "Operator profiles use operator plans."}
            </p>
          </div>

          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "active" | "cancelled")}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {planType === "operator_pro" && (
            <div>
              <Label className="text-xs">Seats</Label>
              <Input
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                className="mt-1 w-32"
              />
              <p className="text-xs text-muted-foreground mt-1">€99 base · +€15/seat after 2</p>
            </div>
          )}

          {isPaidPlan(planType) && (
            <div>
              <Label className="text-xs">Renewal date (optional)</Label>
              <Input
                type="date"
                value={renewalAt}
                onChange={(e) => setRenewalAt(e.target.value)}
                className="mt-1"
              />
            </div>
          )}

          <div>
            <Label className="text-xs">History note (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why this change?"
              className="mt-1 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Appended to the plan&apos;s history. Visible to admins only.
            </p>
          </div>

          {status === "cancelled" && (
            <div>
              <Label className="text-xs">Cancellation reason (optional)</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
