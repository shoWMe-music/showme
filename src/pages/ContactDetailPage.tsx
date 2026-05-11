import { useState, useMemo } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import AppLayout from "@/components/AppLayout";
import CreateContactDialog from "@/components/CreateContactDialog";
import StatusBadge from "@/components/StatusBadge";
import { useContactWithFallback, useEvents, useUpdateContact, useDeleteContact, useAllEventEconomics, useEventsLoaded, useContactsLoaded } from "@/lib/queries";
import { useMyInvitationCodes } from "@/lib/queries/useInvitationCodes";
import type { InvitationCode } from "@/lib/db";
import { Contact, contactTypeLabels, formatCurrency } from "@/lib/models";
import { contactTypeList } from "@/lib/contacts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Pencil, Trash2, Mail, Phone, Building2, CreditCard, FileText, MapPin, StickyNote, Copy } from "lucide-react";
import { copyToast } from "@/hooks/use-toast";

function CopyBtn({ value }: { value: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(value); copyToast("Copied to clipboard"); }}
    >
      <Copy className="h-3 w-3" />
    </Button>
  );
}

export default function ContactDetailPage() {
  const { id } = useParams({ from: "/contacts/$id" });
  const navigate = useNavigate();
  const updateContactMutation = useUpdateContact();
  const deleteContactMutation = useDeleteContact();
  const [editOpen, setEditOpen] = useState(false);

  const dataLoaded = useEventsLoaded() && useContactsLoaded();
  const { contact, isLoading: contactLoading } = useContactWithFallback(id || "");
  const events = useEvents();
  const { data: invitationCodes } = useMyInvitationCodes();

  // Find the invitation code (if any) tied to this contact, by recipient name
  // or email match. Used to surface the invite section in the edit dialog.
  const matchingInvite = useMemo((): { code: string; status: InvitationCode["status"] } | null => {
    if (!contact || !invitationCodes) return null;
    const contactName = contact.name.trim().toLowerCase();
    for (const code of invitationCodes) {
      const nameMatch = code.recipientName && contactName === code.recipientName.trim().toLowerCase();
      const emailMatch = code.recipientEmail && contact.contacts.some(c => c.email.trim().toLowerCase() === code.recipientEmail!.trim().toLowerCase());
      if (nameMatch || emailMatch) return { code: code.code, status: code.status };
    }
    return null;
  }, [contact, invitationCodes]);

  const linkedEvents = useMemo(() => {
    if (!contact) return [];
    const name = contact.name.toLowerCase();
    return events.filter(e =>
      e.artist.toLowerCase() === name ||
      e.venue.toLowerCase() === name ||
      e.operator.toLowerCase() === name ||
      (e.tickets ?? []).some(t => t.provider.toLowerCase() === name)
    );
  }, [contact, events]);

  const linkedEventIds = useMemo(() => linkedEvents.map(e => e.id), [linkedEvents]);
  const economicsMap = useAllEventEconomics(linkedEventIds);

  if (!dataLoaded || contactLoading || !contact) {
    if (dataLoaded && !contactLoading && !contact) {
      return (
        <AppLayout>
          <div className="text-center py-20">
            <p className="text-muted-foreground">Contact not found.</p>
            <Button variant="link" onClick={() => navigate({ to: "/contacts" })}>← Back to Contacts</Button>
          </div>
        </AppLayout>
      );
    }
    return (
      <AppLayout>
        <div className="animate-fade-in">
          {/* Header skeleton */}
          <div className="mb-6 flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-8 w-16 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Info card skeleton */}
            <div className="rounded-xl border bg-card shadow-sm p-6 space-y-5">
              <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                {[1, 2].map(i => (
                  <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </div>

            {/* Linked events skeleton */}
            <div className="rounded-xl border bg-card shadow-sm">
              <div className="border-b px-6 py-4 space-y-1">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="divide-y">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center justify-between px-6 py-3">
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const handleSave = (updated: Contact) => {
    updateContactMutation.mutate({ id: updated.id, updates: updated });
  };

  const handleDelete = () => {
    deleteContactMutation.mutate({ id: contact.id });
    navigate({ to: "/contacts" });
  };

  return (
    <AppLayout>
      <div className="animate-fade-in">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/contacts" })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{contact.name}</h1>
            <p className="text-sm text-muted-foreground">
              {contactTypeList(contact).map(t => contactTypeLabels[t] || t).join(", ")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Info Card */}
          <div className="rounded-xl border bg-card shadow-sm p-6 space-y-5">
            {/* Contacts */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">Contact Persons</h3>
              <div className="space-y-3">
                {contact.contacts.map((c, i) => (
                  <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <p className="text-sm font-medium">{c.name || "—"}</p>
                    {c.email && (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" /> {c.email}
                        <CopyBtn value={c.email} />
                      </p>
                    )}
                    {c.phone && (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" /> {c.phone}
                        <CopyBtn value={c.phone} />
                      </p>
                    )}
                  </div>
                ))}
                {contact.contacts.length === 0 && <p className="text-xs text-muted-foreground">No contacts added</p>}
              </div>
            </div>

            {/* Bank Details — hidden for ticketing providers */}
            {!(Array.isArray(contact.type) ? contact.type.includes("ticketing") : contact.type === "ticketing") && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">Bank Details</h3>
                <div className="space-y-1 text-sm">
                  <p className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{contact.iban || "—"}</span>
                    {contact.iban && <CopyBtn value={contact.iban} />}
                  </p>
                  <p className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {contact.bankName || "—"}
                    {contact.bankName && <CopyBtn value={contact.bankName} />}
                  </p>
                </div>
              </div>
            )}

            {/* VAT & Address */}
            <div className="grid grid-cols-2 gap-4">
              {contact.vatId && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-1">VAT / Tax ID</h3>
                  <p className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" /> {contact.vatId}
                    <CopyBtn value={contact.vatId} />
                  </p>
                </div>
              )}
              {contact.address && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-1">Address</h3>
                  <p className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" /> {contact.address}
                    <CopyBtn value={contact.address} />
                  </p>
                </div>
              )}
            </div>

            {contact.notes && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-1">Notes</h3>
                <p className="flex items-start gap-2 text-sm">
                  <StickyNote className="h-4 w-4 text-muted-foreground mt-0.5" /> {contact.notes}
                </p>
              </div>
            )}
          </div>

          {/* Linked Events */}
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Linked Events</h3>
              <p className="text-xs text-muted-foreground">{linkedEvents.length} event{linkedEvents.length !== 1 ? "s" : ""}</p>
            </div>
            <div className="divide-y">
              {linkedEvents.length === 0 && (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">No linked events found</p>
              )}
              {linkedEvents.map(event => {
                const settlement = economicsMap[event.id]?.settlement;
                return (
                  <button
                    key={event.id}
                    className="flex w-full items-center justify-between px-6 py-3 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => navigate({ to: "/events/$id", params: { id: event.id } })}
                  >
                    <div>
                      <p className="text-sm font-medium">{event.name}</p>
                      <p className="text-xs text-muted-foreground">{event.date} · {event.venue}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {economicsMap[event.id] ? (
                        settlement ? (
                          <span className="text-xs font-medium">
                            {formatCurrency(settlement.artistPayout + settlement.promoterPayout + settlement.venuePayout)}
                          </span>
                        ) : null
                      ) : (
                        <Skeleton className="h-4 w-16" />
                      )}
                      <StatusBadge status={event.status} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <CreateContactDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleSave}
        editingContact={contact}
        invitation={matchingInvite}
      />
    </AppLayout>
  );
}
