import {
  type getApiV1ProfilesIdContacts,
  useGetApiV1ProfilesIdContacts,
  usePostApiV1ProfilesIdContacts,
} from "@showme/api-client";
import {
  Avatar,
  type AvatarTone,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  Modal,
  SearchInput,
  SectionHeader,
  TextField,
  useToast,
} from "@showme/design-system";
import { type FormEvent, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { SegmentedToggle } from "../components";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";

type Contact = Awaited<ReturnType<typeof getApiV1ProfilesIdContacts>>[number];
type ContactPerson = { name?: string; email?: string; phone?: string };
type ViewMode = "grid" | "list";

/** Avatar hue per contact type — falls back to amber for unknown types. */
const TYPE_TONE: Record<string, AvatarTone> = {
  artist: "brand",
  band: "brand",
  performer: "brand",
  agent: "purple",
  agency: "purple",
  venue: "amber",
  crew: "blue",
  supplier: "green",
  authority: "blue",
};

/** Map a raw contact type onto the prototype's directory vocabulary. */
const TYPE_LABEL: Record<string, string> = {
  artist: "Performer",
  band: "Performer",
  performer: "Performer",
  agent: "Agent",
  agency: "Agent",
  venue: "Venue",
  crew: "Crew",
  supplier: "Supplier",
  authority: "Authority",
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

function typeLabel(type: string | null): string {
  if (!type) return "Contact";
  return TYPE_LABEL[type] ?? type.replace(/^\w/, (character) => character.toUpperCase());
}

/** The folded `persons` jsonb is `unknown` on the wire — read it defensively. */
function firstPerson(contact: Contact): ContactPerson | null {
  const persons = contact.persons;
  if (Array.isArray(persons) && persons.length > 0) {
    const person = persons[0] as ContactPerson;
    if (person && typeof person === "object") return person;
  }
  return null;
}

/** A labelled key/value line inside a contact card (label left, value right). */
function CardField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}
    >
      <span style={{ color: "var(--muted)", fontSize: 13 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          textAlign: "right",
          wordBreak: "break-all",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          color: value === "—" ? "var(--muted)" : "var(--text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ContactEntry({ contact }: { contact: Contact }) {
  const person = firstPerson(contact);
  const role = person?.name
    ? `${typeLabel(contact.type)} · ${person.name}`
    : typeLabel(contact.type);
  const verified = Boolean(contact.iban);
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Avatar
          initials={initials(contact.name)}
          tone={(contact.type && TYPE_TONE[contact.type]) || "amber"}
          size={40}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{contact.name}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{role}</div>
        </div>
      </div>
      <CardField label="Email" value={person?.email ?? "—"} />
      <CardField label="IBAN" value={contact.iban ?? "—"} mono />
      <div>
        <Badge status={verified ? "confirmed" : "pending"} dot>
          {verified ? "IBAN verified" : "Unverified"}
        </Badge>
      </div>
    </Card>
  );
}

export function Contacts() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, error, refetch } = useGetApiV1ProfilesIdContacts(profileId, {
    query: { enabled: Boolean(profileId) },
  });

  const contacts = data ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const contact of contacts) if (contact.type) set.add(contact.type);
    return ["all", ...Array.from(set).sort()];
  }, [contacts]);

  const needle = query.trim().toLowerCase();
  const visible = contacts.filter((contact) => {
    if (category !== "all" && contact.type !== category) return false;
    if (needle && !contact.name.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <>
      <SectionHeader
        eyebrow="Directory"
        title="Contacts"
        subtitle="Venues, performers, agents and suppliers — with verified payout details."
        actions={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SegmentedToggle<ViewMode>
              aria-label="Layout"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Grid" },
                { value: "list", label: "List" },
              ]}
            />
            <Button
              variant="primary"
              leftIcon={<Icon name="plus" />}
              onClick={() => setCreating(true)}
              disabled={!profileId}
            >
              Add Contact
            </Button>
          </div>
        }
      />

      {!profileId ? (
        <EmptyState icon={<Icon name="building" />} title="No profile selected" />
      ) : isPending ? (
        <LoadingState label="Loading contacts" />
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load contacts" />
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<Icon name="building" />}
          title="No contacts yet"
          description="People and organizations you work with will appear here."
          action={
            <Button
              variant="primary"
              leftIcon={<Icon name="plus" />}
              onClick={() => setCreating(true)}
            >
              Add Contact
            </Button>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <SearchInput
              value={query}
              onChange={(changeEvent) => setQuery(changeEvent.target.value)}
              placeholder="Search contacts…"
              aria-label="Search contacts"
              style={{ maxWidth: 280 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {categories.map((value) => (
                <Chip key={value} active={category === value} onClick={() => setCategory(value)}>
                  {value === "all" ? "All" : typeLabel(value)}
                </Chip>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<Icon name="search" />}
              title="No matches"
              description="No contacts match this search."
            />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  view === "list" ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
              }}
            >
              {visible.map((contact) => (
                <ContactEntry key={contact.id} contact={contact} />
              ))}
            </div>
          )}
        </div>
      )}

      <AddContactModal
        open={creating}
        profileId={profileId}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void refetch();
        }}
      />
    </>
  );
}

function AddContactModal({
  open,
  profileId,
  onClose,
  onCreated,
}: {
  open: boolean;
  profileId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [personName, setPersonName] = useState("");
  const [email, setEmail] = useState("");
  const [iban, setIban] = useState("");

  const create = usePostApiV1ProfilesIdContacts({
    mutation: {
      onSuccess: () => {
        toast.success("Contact added");
        onCreated();
        setName("");
        setType("");
        setPersonName("");
        setEmail("");
        setIban("");
      },
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't add the contact.")),
    },
  });

  const canSubmit = name.trim().length > 0;

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!canSubmit) return;
    const trimmedPerson = personName.trim();
    const trimmedEmail = email.trim();
    const persons =
      trimmedPerson || trimmedEmail
        ? [
            {
              name: trimmedPerson || name.trim(),
              ...(trimmedEmail ? { email: trimmedEmail } : {}),
            },
          ]
        : undefined;
    create.mutate({
      id: profileId,
      data: {
        name: name.trim(),
        ...(type.trim() ? { type: type.trim().toLowerCase() } : {}),
        ...(iban.trim() ? { iban: iban.trim() } : {}),
        ...(persons ? { persons } : {}),
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add contact"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || create.isPending}
            leftIcon={<Icon name="plus" />}
          >
            {create.isPending ? "Adding…" : "Add contact"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField
          label="Name"
          value={name}
          placeholder="Organization or person"
          onChange={(changeEvent) => setName(changeEvent.target.value)}
          autoFocus
        />
        <TextField
          label="Type"
          value={type}
          placeholder="venue · performer · agent · supplier"
          onChange={(changeEvent) => setType(changeEvent.target.value)}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <TextField
            label="Contact person"
            value={personName}
            placeholder="Full name"
            onChange={(changeEvent) => setPersonName(changeEvent.target.value)}
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            placeholder="name@example.com"
            onChange={(changeEvent) => setEmail(changeEvent.target.value)}
          />
        </div>
        <TextField
          label="IBAN"
          value={iban}
          placeholder="Payout account (verifies the contact)"
          onChange={(changeEvent) => setIban(changeEvent.target.value)}
        />
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
