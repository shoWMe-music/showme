import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { useUser, operatorRoleLabels, getBaseRole, type SharedProfile } from "@/lib/user-context";
import { fetchProfileTemplates, deleteProfileTemplate, upsertProfileTemplate } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Trash2, FolderOpen, Inbox } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// Categories backed by SectionTemplateMenu / legacy template helpers.
// Keep label + hint in sync with the section that surfaces the template.
const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "schedules", label: "Event-day schedule", hint: "Event Manager → Details" },
  { key: "settlement-overview", label: "Settlement overview", hint: "Settlement → Overview" },
  { key: "settlement-deal", label: "Settlement deal", hint: "Settlement → Deal" },
  { key: "deals", label: "Deal", hint: "Deal Templates dialog" },
  { key: "budgets", label: "Budget", hint: "Budget Templates dialog" },
  { key: "riders", label: "Rider", hint: "Riders tab" },
  { key: "terms", label: "Contract terms", hint: "Agreement terms" },
];

interface TemplateEntry {
  id: string;
  name: string;
  category: string;
  updatedAt?: string;
  raw: Record<string, unknown>;
}

interface ProfileTemplates {
  profile: SharedProfile;
  byCategory: Record<string, TemplateEntry[]>;
  total: number;
}

function pickName(doc: Record<string, unknown>, id: string): string {
  const n = typeof doc.name === "string" ? doc.name : null;
  return n && n.trim() ? n : id;
}

function pickTimestamp(doc: Record<string, unknown>): string | undefined {
  const u = doc.updated_at ?? doc.updatedAt ?? doc.created_at ?? doc.createdAt;
  if (typeof u === "string") return u;
  return undefined;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TemplatesPage() {
  const { profiles } = useUser();
  const qc = useQueryClient();

  const profileList = useMemo(
    () =>
      Object.entries(profiles)
        .filter(([, p]) => (p as SharedProfile).id)
        .map(([slot, p]) => ({ slot, profile: p as SharedProfile })),
    [profiles],
  );

  const profileIds = profileList.map((p) => p.profile.id!).join(",");

  const query = useQuery<ProfileTemplates[]>({
    queryKey: ["templates-page", profileIds],
    enabled: profileList.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const results = await Promise.all(
        profileList.map(async ({ profile }) => {
          const profileId = profile.id!;
          const byCategory: Record<string, TemplateEntry[]> = {};
          await Promise.all(
            CATEGORIES.map(async (cat) => {
              try {
                const docs = await fetchProfileTemplates(profileId, cat.key);
                byCategory[cat.key] = docs.map((d) => {
                  const r = d as Record<string, unknown>;
                  const id = String(r.id);
                  return {
                    id,
                    name: pickName(r, id),
                    category: cat.key,
                    updatedAt: pickTimestamp(r),
                    raw: r,
                  };
                });
              } catch {
                byCategory[cat.key] = [];
              }
            }),
          );
          const total = Object.values(byCategory).reduce((acc, list) => acc + list.length, 0);
          return { profile, byCategory, total };
        }),
      );
      return results;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (input: { profileId: string; category: string; id: string }) => {
      await deleteProfileTemplate(input.profileId, input.category, input.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates-page"] });
      toast({ title: "Template deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: async (input: { profileId: string; category: string; id: string; name: string }) => {
      await upsertProfileTemplate(input.profileId, input.category, input.id, { name: input.name.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates-page"] });
      toast({ title: "Template renamed" });
    },
    onError: () => toast({ title: "Failed to rename", variant: "destructive" }),
  });

  const [renameTarget, setRenameTarget] = useState<{ profileId: string; category: string; entry: TemplateEntry } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ profileId: string; category: string; entry: TemplateEntry } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ profile: SharedProfile; category: string; entry: TemplateEntry } | null>(null);

  const data = query.data ?? [];
  const totalAcross = data.reduce((acc, p) => acc + p.total, 0);

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <header className="space-y-2">
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            <FolderOpen className="h-7 w-7 text-primary" /> Templates
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Templates are saved per profile and shared with everyone on that profile&apos;s team.
            Save and load templates from the section they apply to (Settlement, Schedule, Riders, etc.) — this page lets you rename or delete saved templates across all your profiles.
          </p>
        </header>

        {profileList.length === 0 && (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any profiles yet. Create one in <strong>My Profiles</strong> to start saving templates.
            </p>
          </div>
        )}

        {query.isLoading && profileList.length > 0 && (
          <div className="space-y-4">
            {profileList.map((p) => (
              <div key={p.slot} className="rounded-xl border bg-card p-6 space-y-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        )}

        {!query.isLoading && totalAcross === 0 && profileList.length > 0 && (
          <div className="rounded-xl border bg-card p-8 text-center space-y-2">
            <Inbox className="h-8 w-8 text-muted-foreground/60 mx-auto" />
            <p className="text-sm text-muted-foreground">
              No templates saved yet. Open the <strong>Templates</strong> menu inside any Settlement, Schedule, or Riders section to save the current data as a template.
            </p>
          </div>
        )}

        {!query.isLoading &&
          data
            .filter((p) => p.total > 0)
            .map(({ profile, byCategory }) => {
              const profileId = profile.id!;
              const baseRole = getBaseRole(profile.role);
              return (
                <section key={profileId} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-6 py-4">
                    <div className="flex items-center gap-3">
                      <h2 className="font-display text-lg font-semibold">{profile.name || "Untitled profile"}</h2>
                      <Badge variant="secondary" className="text-xs">
                        {operatorRoleLabels[baseRole]}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{profileId}</span>
                  </div>
                  <div className="divide-y">
                    {CATEGORIES.map((cat) => {
                      const list = byCategory[cat.key] ?? [];
                      if (list.length === 0) return null;
                      return (
                        <div key={cat.key} className="px-6 py-4">
                          <div className="flex items-baseline justify-between mb-2">
                            <h3 className="text-sm font-semibold">{cat.label}</h3>
                            <span className="text-xs text-muted-foreground">{cat.hint}</span>
                          </div>
                          <ul className="space-y-1">
                            {list.map((entry) => (
                              <li
                                key={entry.id}
                                className="flex items-center gap-2 rounded px-2 py-2 hover:bg-muted/40 group"
                              >
                                <button
                                  type="button"
                                  onClick={() => setPreviewTarget({ profile, category: cat.key, entry })}
                                  className="flex-1 min-w-0 text-left rounded -mx-1 px-1 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <p className="text-sm font-medium truncate">{entry.name}</p>
                                  {entry.updatedAt && (
                                    <p className="text-xs text-muted-foreground">Updated {formatTimestamp(entry.updatedAt)}</p>
                                  )}
                                </button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="opacity-0 group-hover:opacity-100 h-7 px-2"
                                  onClick={() => {
                                    setRenameTarget({ profileId, category: cat.key, entry });
                                    setRenameValue(entry.name);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="opacity-0 group-hover:opacity-100 h-7 px-2 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget({ profileId, category: cat.key, entry })}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename template</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Template name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim() && renameTarget) {
                renameMutation.mutate({
                  profileId: renameTarget.profileId,
                  category: renameTarget.category,
                  id: renameTarget.entry.id,
                  name: renameValue,
                });
                setRenameTarget(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button
              disabled={!renameValue.trim() || renameMutation.isPending}
              onClick={() => {
                if (!renameTarget) return;
                renameMutation.mutate({
                  profileId: renameTarget.profileId,
                  category: renameTarget.category,
                  id: renameTarget.entry.id,
                  name: renameValue,
                });
                setRenameTarget(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewTarget} onOpenChange={(open) => !open && setPreviewTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewTarget?.entry.name}</DialogTitle>
          </DialogHeader>
          {previewTarget && (() => {
            const cat = CATEGORIES.find((c) => c.key === previewTarget.category);
            const { id: _id, name: _name, created_at: _ca, createdAt: _cb, updated_at: _ua, updatedAt: _ub, ...rest } = previewTarget.entry.raw;
            // Canonical SectionTemplateMenu shape stores the section payload under `data`;
            // legacy helpers (deals/riders/terms/budgets) write fields at the top level.
            const payload = "data" in rest && rest.data !== undefined ? rest.data : rest;
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{cat?.label ?? previewTarget.category}</Badge>
                    <span>{previewTarget.profile.name}</span>
                  </div>
                  {previewTarget.entry.updatedAt && (
                    <span>Updated {formatTimestamp(previewTarget.entry.updatedAt)}</span>
                  )}
                </div>
                <pre className="rounded-lg bg-muted/50 border p-4 text-xs overflow-auto max-h-[60vh] font-mono whitespace-pre-wrap">
                  {JSON.stringify(payload, null, 2)}
                </pre>
                <p className="text-xs text-muted-foreground">
                  To apply this template, open the {cat?.hint ?? "matching section"} on an event and use its Templates menu.
                </p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>This will permanently delete <strong>{deleteTarget.entry.name}</strong>. This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deleteTarget) return;
                deleteMutation.mutate({
                  profileId: deleteTarget.profileId,
                  category: deleteTarget.category,
                  id: deleteTarget.entry.id,
                });
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
