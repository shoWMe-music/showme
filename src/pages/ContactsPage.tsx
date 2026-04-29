import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import CreateContactDialog from "@/components/CreateContactDialog";
import ImportContactsDialog from "@/components/ImportContactsDialog";
import { usePaginatedContacts, useAddContact, useUpdateContact, useDeleteContact } from "@/lib/queries";
import { useMyInvitationCodes } from "@/lib/queries/useInvitationCodes";
import type { InvitationCode } from "@/lib/db";
import { Skeleton } from "@/components/ui/skeleton";
import { Contact, ContactType, contactTypeLabels } from "@/lib/models";
import { contactHasType, contactPrimaryType, contactTypeList, groupContactsByType } from "@/lib/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Users, MapPin, Music, Ticket, Briefcase, UserCheck, Factory, Upload, AlertTriangle, Merge, Loader2, Handshake, Trash2, Copy, Check } from "lucide-react";
import { copyToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";

const FETCH_SIZE = 50;

const typeIcons: Record<ContactType, typeof Users> = {
  promoter: Users,
  venue: MapPin,
  performer: Music,
  ticketing: Ticket,
  agent: Briefcase,
  manager: UserCheck,
  production: Factory,
};

const allTypes: ContactType[] = ["promoter", "venue", "performer", "ticketing", "agent", "manager", "production"];

interface DuplicateGroup {
  key: string;
  parties: Contact[];
}

function findDuplicates(parties: Contact[]): DuplicateGroup[] {
  const groups = new Map<string, Contact[]>();
  // Group by normalized name
  parties.forEach(p => {
    const key = p.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  });
  // Also group by shared email across contacts
  const emailMap = new Map<string, Contact[]>();
  parties.forEach(p => {
    p.contacts.forEach(c => {
      if (c.email) {
        const ek = c.email.trim().toLowerCase();
        if (!emailMap.has(ek)) emailMap.set(ek, []);
        const list = emailMap.get(ek)!;
        if (!list.find(x => x.id === p.id)) list.push(p);
      }
    });
  });
  // Merge all duplicate groups, dedup by party id sets
  const seen = new Set<string>();
  const results: DuplicateGroup[] = [];
  const addGroup = (key: string, list: Contact[]) => {
    if (list.length < 2) return;
    const ids = list.map(p => p.id).sort().join(",");
    if (seen.has(ids)) return;
    seen.add(ids);
    results.push({ key, parties: list });
  };
  groups.forEach((list, key) => addGroup(key, list));
  emailMap.forEach((list, key) => addGroup(`email:${key}`, list));
  return results;
}

function mergeContacts(parties: Contact[]): Contact {
  const primary = parties[0];
  const allContacts = parties.flatMap(p => p.contacts);
  const seen = new Set<string>();
  const contacts = allContacts.filter(c => {
    if (!c.email) return true;
    const k = c.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    ...primary,
    contacts,
    iban: parties.find(p => p.iban)?.iban || "",
    bankName: parties.find(p => p.bankName)?.bankName || "",
    vatId: parties.find(p => p.vatId)?.vatId || "",
    address: parties.find(p => p.address)?.address || "",
    notes: parties.map(p => p.notes).filter(Boolean).join("\n"),
  };
}

export default function ContactsPage() {
  const addContactMutation = useAddContact();
  const updateContactMutation = useUpdateContact();
  const deleteContactMutation = useDeleteContact();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<ContactType | "all" | "collaborators">("all");
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<DuplicateGroup | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Contact | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [page, setPage] = useState(1);

  const { data: invitationCodes } = useMyInvitationCodes();

  // No server-side type filter — we use client-side filtering to support multi-type contacts
  const firestoreFilters = undefined;

  const {
    data: paginatedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isSuccess: contactsLoaded,
  } = usePaginatedContacts(FETCH_SIZE, firestoreFilters);

  // Flatten all loaded Firestore pages into a single array
  const allLoadedContacts = useMemo(
    () => paginatedData?.pages.flatMap((p) => p.contacts) ?? [],
    [paginatedData],
  );

  // Collect unique custom types (non-preset) from all loaded contacts
  const customTypes = useMemo(() => {
    const preset = new Set(allTypes as string[]);
    const custom = new Set<string>();
    for (const c of allLoadedContacts) {
      for (const t of contactTypeList(c)) {
        if (!preset.has(t)) custom.add(t);
      }
    }
    return Array.from(custom).sort();
  }, [allLoadedContacts]);

  // Build a set of collaborator contact names/emails for the "Active Collaborators" filter
  const collaboratorNames = useMemo(() => {
    if (!invitationCodes) return new Set<string>();
    const names = new Set<string>();
    for (const code of invitationCodes) {
      if (code.recipientName) names.add(code.recipientName.trim().toLowerCase());
      if (code.recipientEmail) names.add(code.recipientEmail.trim().toLowerCase());
    }
    return names;
  }, [invitationCodes]);

  const isCollaborator = (contact: Contact): boolean => {
    if (collaboratorNames.has(contact.name.trim().toLowerCase())) return true;
    return contact.contacts.some(c => c.email && collaboratorNames.has(c.email.trim().toLowerCase()));
  };

  const getMatchingInvite = (contact: Contact): InvitationCode | null => {
    if (!invitationCodes) return null;
    for (const code of invitationCodes) {
      const nameMatch = code.recipientName && contact.name.trim().toLowerCase() === code.recipientName.trim().toLowerCase();
      const emailMatch = code.recipientEmail && contact.contacts.some(c => c.email.trim().toLowerCase() === code.recipientEmail!.trim().toLowerCase());
      if (nameMatch || emailMatch) return (code.status === "used" || code.status === "active") ? code : null;
    }
    return null;
  };

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const handleCopyCode = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Reset pagination cursor whenever filters change
  useEffect(() => { setPage(1); }, [search, filterType]);

  const duplicates = useMemo(() => findDuplicates(allLoadedContacts), [allLoadedContacts]);

  // Client-side search + type filter
  const filtered = useMemo(() => {
    let result = allLoadedContacts;
    if (filterType === "collaborators") {
      result = result.filter(isCollaborator);
    } else if (filterType !== "all") {
      result = result.filter(p => contactHasType(p, filterType));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) || p.contacts.some(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [allLoadedContacts, search, filterType, collaboratorNames]);

  // Fetch the next Firestore batch when the user clicks "Load more" (page bumps).
  useEffect(() => {
    if (page > 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [page, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Group across all filtered (loaded) contacts so newly created contacts
  // always appear in their type section regardless of pagination position.
  const grouped = useMemo(() => groupContactsByType(filtered), [filtered]);

  const handleSave = (contact: Contact) => {
    if (editingContact) {
      updateContactMutation.mutate({ id: contact.id, updates: contact });
    } else {
      addContactMutation.mutate({ contact });
    }
    setEditingContact(null);
  };

  const handleMerge = (group: DuplicateGroup) => {
    const merged = mergeContacts(group.parties);
    updateContactMutation.mutate({ id: merged.id, updates: merged });
    group.parties.slice(1).forEach(p => deleteContactMutation.mutate({ id: p.id }));
    setMergeConfirm(null);
  };

  if (!contactsLoaded) {
    return (
      <AppLayout>
        <div>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
              <Skeleton className="h-4 w-64 mt-1" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </div>

          {/* Filter bar skeleton */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Skeleton className="h-10 w-56 rounded-md" />
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-md" />
              ))}
            </div>
          </div>

          {/* Party group cards skeleton — 2-column grid with 3 groups */}
          <div className="grid gap-6 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, gi) => (
              <div key={gi} className="rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b px-6 py-4">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-3 w-5 ml-auto" />
                </div>
                <div className="divide-y">
                  {Array.from({ length: gi === 0 ? 4 : gi === 1 ? 3 : gi === 2 ? 5 : 2 }).map((_, ri) => (
                    <div key={ri} className="flex items-center justify-between px-6 py-3">
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-3 w-12" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
            <p className="mt-1 text-muted-foreground">All counterparties in your event settlements</p>
          </div>
          <div className="flex gap-2">
            {duplicates.length > 0 && (
              <Button variant="outline" onClick={() => setDuplicatesOpen(true)} className="text-amber-600 border-amber-300 hover:bg-amber-50">
                <AlertTriangle className="h-4 w-4 mr-2" /> {duplicates.length} Duplicate{duplicates.length > 1 ? "s" : ""}
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button variant="destructive" onClick={() => setBulkDeleteConfirm(true)}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete {selectedIds.size}
              </Button>
            )}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Import
            </Button>
            <Button onClick={() => { setEditingContact(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add Contact
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant={filterType === "all" ? "default" : "outline"} size="sm" onClick={() => setFilterType("all")}>
              All ({allLoadedContacts.length}{hasNextPage ? "+" : ""})
            </Button>
            {allTypes.map(t => {
              const count = allLoadedContacts.filter(p => contactHasType(p, t)).length;
              return (
                <Button key={t} variant={filterType === t ? "default" : "outline"} size="sm" onClick={() => setFilterType(t)}>
                  {contactTypeLabels[t]} ({count})
                </Button>
              );
            })}
            {customTypes.map(t => {
              const count = allLoadedContacts.filter(p => contactHasType(p, t)).length;
              return (
                <Button key={t} variant={filterType === t ? "default" : "outline"} size="sm" onClick={() => setFilterType(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)} ({count})
                </Button>
              );
            })}
            <Button variant={filterType === "collaborators" ? "default" : "outline"} size="sm" onClick={() => setFilterType("collaborators")}>
              <Handshake className="h-3.5 w-3.5 mr-1.5" />
              Active Collaborators
            </Button>
          </div>
        </div>

        {/* Grouped list */}
        <div className="grid gap-6 lg:grid-cols-2">
          {[...allTypes, ...customTypes].map(type => {
            const items = grouped[type];
            if (!items || items.length === 0) return null;
            const Icon = typeIcons[type as ContactType] ?? Users;
            const label = contactTypeLabels[type] || (type.charAt(0).toUpperCase() + type.slice(1));
            return (
              <div key={type} className="rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b px-6 py-4">
                  <Icon className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">{label}</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="divide-y">
                  {items.map(party => {
                  const invite = getMatchingInvite(party);
                  return (
                    <div
                      key={party.id}
                      className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedIds.has(party.id)}
                        onCheckedChange={() => toggleSelect(party.id)}
                        className="mr-3 shrink-0"
                      />
                      <button
                        className="flex flex-1 items-center justify-between min-w-0"
                        onClick={() => navigate({ to: "/contacts/$id", params: { id: party.id } })}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{party.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {party.contacts[0]?.name || "No contact"}
                            {party.contacts.length > 1 && ` +${party.contacts.length - 1}`}
                          </p>
                          {party.contacts[0]?.email && (
                            <span className="text-xs text-muted-foreground/70 truncate block">{party.contacts[0].email}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {invite?.status === "active" && (
                            <>
                              <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">Pending</Badge>
                              <span className="text-[10px] font-mono text-muted-foreground">{invite.code}</span>
                              <button
                                type="button"
                                className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted"
                                onClick={(e) => handleCopyCode(invite.code, e)}
                                title="Copy invitation code"
                              >
                                {copiedCode === invite.code
                                  ? <Check className="h-3 w-3 text-emerald-600" />
                                  : <Copy className="h-3 w-3 text-muted-foreground" />}
                              </button>
                            </>
                          )}
                          {invite?.status === "used" && (
                            <Badge variant="outline" className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">Accepted</Badge>
                          )}
                          {party.contacts[0]?.email && (
                            <button className="p-1 hover:bg-accent rounded" onClick={(e) => { e.stopPropagation(); copyToast(party.contacts[0].email, "Email"); }}>
                              <Copy className="h-3 w-3 text-muted-foreground" />
                            </button>
                          )}
                          <span className="text-xs text-muted-foreground">{contactPrimaryType(party) !== "ticketing" && party.iban ? "IBAN ✓" : ""}</span>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(party); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                </div>
              </div>
            );
          })}
        </div>

        {contactsLoaded && (hasNextPage || isFetchingNextPage) && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>Showing {filtered.length} of {allLoadedContacts.length}{hasNextPage ? "+" : ""} loaded contacts</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNextPage || isFetchingNextPage}
              onClick={() => setPage((p) => p + 1)}
            >
              {isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Load more
            </Button>
          </div>
        )}

        {filtered.length === 0 && contactsLoaded && (
          <div className="text-center py-12 text-muted-foreground">
            No contacts found. Try adjusting your search or filters.
          </div>
        )}
      </div>

      <CreateContactDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        editingContact={editingContact}
        customTypes={customTypes}
      />
      <ImportContactsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(imported) => imported.forEach(p => addContactMutation.mutate({ contact: p }))}
      />

      {/* Duplicates Dialog */}
      <Dialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Duplicate Contacts Found
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            The following contacts share the same name and may be duplicates. You can merge them to combine their details into a single record.
          </p>
          <div className="space-y-4">
            {duplicates.map(group => (
              <div key={group.key} className="rounded-lg border p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{group.parties[0].name}</h3>
                  <Badge variant="outline" className="text-xs">{group.parties.length} entries</Badge>
                </div>
                <div className="space-y-1.5 mb-3">
                  {group.parties.map(p => (
                    <div key={p.id} className="text-xs text-muted-foreground flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{contactTypeList(p).map(t => contactTypeLabels[t] || t).join(", ")}</Badge>
                      <span>{p.contacts[0]?.email || "No email"}</span>
                      {p.iban && <span className="text-green-600">IBAN ✓</span>}
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="outline" onClick={() => { setDuplicatesOpen(false); setMergeConfirm(group); }}>
                  <Merge className="h-3.5 w-3.5 mr-1.5" /> Merge
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicatesOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Confirmation */}
      <AlertDialog open={!!mergeConfirm} onOpenChange={(v) => { if (!v) setMergeConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge "{mergeConfirm?.parties[0]?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will combine {mergeConfirm?.parties.length} entries into one, merging all contacts, bank details, and notes.
              The duplicate entries will be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => mergeConfirm && handleMerge(mergeConfirm)}>Merge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteConfirm?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this contact and all their details. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteConfirm) { deleteContactMutation.mutate({ id: deleteConfirm.id }); setDeleteConfirm(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} contacts?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to delete these contacts. Do you want to proceed? This action is irreversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                for (const id of selectedIds) deleteContactMutation.mutate({ id });
                setSelectedIds(new Set());
                setBulkDeleteConfirm(false);
              }}
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
