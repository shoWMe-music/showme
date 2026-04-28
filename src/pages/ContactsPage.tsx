import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import CreateContactDialog from "@/components/CreateContactDialog";
import ImportContactsDialog from "@/components/ImportContactsDialog";
import { usePaginatedContacts, useAddContact, useUpdateContact, useDeleteContact } from "@/lib/queries";
import { useMyInvitationCodes } from "@/lib/queries/useInvitationCodes";
import { Skeleton } from "@/components/ui/skeleton";
import { Contact, ContactType, contactTypeLabels } from "@/lib/models";
import { contactHasType, contactPrimaryType } from "@/lib/contacts";
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
import { Plus, Search, Users, MapPin, Music, Ticket, Briefcase, UserCheck, Factory, Upload, AlertTriangle, Merge, ChevronLeft, ChevronRight, Loader2, Handshake } from "lucide-react";

const PAGE_SIZE = 25;
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

  const getInviteStatus = (contact: Contact): "active" | "used" | null => {
    if (!invitationCodes) return null;
    for (const code of invitationCodes) {
      const nameMatch = code.recipientName && contact.name.trim().toLowerCase() === code.recipientName.trim().toLowerCase();
      const emailMatch = code.recipientEmail && contact.contacts.some(c => c.email.trim().toLowerCase() === code.recipientEmail!.trim().toLowerCase());
      if (nameMatch || emailMatch) return code.status === "used" ? "used" : code.status === "active" ? "active" : null;
    }
    return null;
  };

  // Reset to first page whenever filters change
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

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Fetch next Firestore batch only when user navigates past loaded data
  useEffect(() => {
    if (page * PAGE_SIZE > allLoadedContacts.length && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [page, allLoadedContacts.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const canGoNext = page * PAGE_SIZE < filtered.length || hasNextPage;

  const grouped = useMemo(() => {
    const groups: Record<string, Contact[]> = {};
    for (const p of paginated) {
      const types = Array.isArray(p.type) ? p.type : [p.type];
      for (const t of types) {
        if (!groups[t]) groups[t] = [];
        groups[t].push(p);
      }
    }
    return groups;
  }, [paginated]);

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
              All{filterType === "all" && allLoadedContacts.length > 0 ? ` (${allLoadedContacts.length}${hasNextPage ? "+" : ""})` : ""}
            </Button>
            {allTypes.map(t => {
              const count = allLoadedContacts.filter(p => contactHasType(p, t)).length;
              return (
                <Button key={t} variant={filterType === t ? "default" : "outline"} size="sm" onClick={() => setFilterType(t)}>
                  {contactTypeLabels[t]}{count > 0 ? ` (${count})` : ""}
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
          {allTypes.map(type => {
            const items = grouped[type];
            if (!items || items.length === 0) return null;
            const Icon = typeIcons[type];
            return (
              <div key={type} className="rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b px-6 py-4">
                  <Icon className="h-5 w-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">{contactTypeLabels[type]}</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="divide-y">
                  {items.map(party => {
                  const inviteStatus = getInviteStatus(party);
                  return (
                    <button
                      key={party.id}
                      className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => navigate({ to: "/contacts/$id", params: { id: party.id } })}
                    >
                      <div>
                        <p className="text-sm font-medium">{party.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {party.contacts[0]?.name || "No contact"}
                          {party.contacts.length > 1 && ` +${party.contacts.length - 1}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {inviteStatus === "active" && (
                          <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">Invited</Badge>
                        )}
                        {inviteStatus === "used" && (
                          <Badge variant="outline" className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">Joined</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{contactPrimaryType(party) !== "ticketing" && party.iban ? "IBAN ✓" : ""}</span>
                      </div>
                    </button>
                  );
                })}
                </div>
              </div>
            );
          })}
        </div>

        {contactsLoaded && filtered.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}{hasNextPage ? "+" : ""} contacts
              {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2">Page {page}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={!canGoNext}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
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
                      <Badge variant="secondary" className="text-[10px]">{Array.isArray(p.type) ? p.type.map(t => contactTypeLabels[t]).join(", ") : contactTypeLabels[p.type]}</Badge>
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
    </AppLayout>
  );
}
