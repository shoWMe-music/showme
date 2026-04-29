import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { Contact, ContactType, ContactPerson, contactTypeLabels } from "@/lib/models";
import { contactTypeList } from "@/lib/contacts";
import AddressAutocomplete from "@/components/AddressAutocomplete";

const presetTypes: ContactType[] = ["promoter", "venue", "performer", "ticketing", "agent", "manager", "production"];

interface CreateContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (contact: Contact) => void;
  editingContact?: Contact | null;
  /** All unique custom types from existing contacts (non-preset). */
  customTypes?: string[];
}

const emptyContact: ContactPerson = { name: "", email: "", phone: "" };

export default function CreateContactDialog({ open, onOpenChange, onSave, editingContact, customTypes = [] }: CreateContactDialogProps) {
  const [name, setName] = useState("");
  const [types, setTypes] = useState<ContactType[]>(["promoter"]);
  const [customTypeInput, setCustomTypeInput] = useState("");
  const [contacts, setContacts] = useState<ContactPerson[]>([{ ...emptyContact }]);
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [vatId, setVatId] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const toggleType = (t: ContactType) => {
    setTypes(prev => prev.includes(t) ? (prev.length > 1 ? prev.filter(x => x !== t) : prev) : [...prev, t]);
  };

  const addCustomType = () => {
    const trimmed = customTypeInput.trim().toLowerCase();
    if (!trimmed) return;
    if (!types.includes(trimmed)) {
      setTypes(prev => [...prev, trimmed]);
    }
    setCustomTypeInput("");
  };

  useEffect(() => {
    if (editingContact) {
      setName(editingContact.name);
      // Normalize legacy types (e.g. "artist" → "performer") and dedupe.
      const normalized = Array.from(new Set(contactTypeList(editingContact)));
      setTypes(normalized.length > 0 ? normalized : ["promoter"]);
      setContacts(editingContact.contacts.length > 0 ? [...editingContact.contacts] : [{ ...emptyContact }]);
      setIban(editingContact.iban);
      setBankName(editingContact.bankName);
      setVatId(editingContact.vatId);
      setAddress(editingContact.address);
      setNotes(editingContact.notes);
    } else {
      setName(""); setTypes(["promoter"]); setCustomTypeInput(""); setContacts([{ ...emptyContact }]);
      setIban(""); setBankName(""); setVatId(""); setAddress(""); setNotes("");
    }
  }, [editingContact, open]);

  const updateContact = (index: number, field: keyof ContactPerson, value: string) => {
    setContacts(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const contact: Contact = {
      id: editingContact?.id || `P-${Date.now()}`,
      name: name.trim(),
      type: types.length === 1 ? types[0] : types,
      contacts: contacts.filter(c => c.name || c.email || c.phone),
      iban, bankName, vatId, address, notes,
    };
    onSave(contact);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingContact ? "Edit Contact" : "Add New Contact"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Name */}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Contact name" />
          </div>

          {/* Type(s) */}
          <div className="space-y-2">
            <Label>Contact Type(s)</Label>
            <div className="flex flex-wrap gap-1.5">
              {presetTypes.map(k => (
                <Button
                  key={k}
                  type="button"
                  variant={types.includes(k) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleType(k)}
                >
                  {contactTypeLabels[k] || k}
                </Button>
              ))}
              {customTypes.map(ct => (
                <Button
                  key={ct}
                  type="button"
                  variant={types.includes(ct) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleType(ct)}
                >
                  {ct.charAt(0).toUpperCase() + ct.slice(1)}
                </Button>
              ))}
              {/* Show any currently selected types not in presets or customTypes */}
              {types.filter(t => !presetTypes.includes(t) && !customTypes.includes(t)).map(t => (
                <Button
                  key={t}
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => toggleType(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Button>
              ))}
            </div>
            <div className="flex gap-1.5 items-center">
              <Input
                placeholder="Custom type..."
                value={customTypeInput}
                onChange={e => setCustomTypeInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomType(); } }}
                className="max-w-[180px] h-8 text-sm"
              />
              <Button type="button" variant="outline" size="sm" onClick={addCustomType} disabled={!customTypeInput.trim()}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
          </div>

          {/* Contact Persons */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Contact Person(s)</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setContacts(prev => [...prev, { ...emptyContact }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <Input placeholder="Name" value={c.name} onChange={e => updateContact(i, "name", e.target.value)} />
                <Input placeholder="Email" type="email" value={c.email} onChange={e => updateContact(i, "email", e.target.value)} />
                <Input placeholder="Phone" value={c.phone} onChange={e => updateContact(i, "phone", e.target.value)} />
                {contacts.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setContacts(prev => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Bank Details — hidden for ticketing providers */}
          {!types.includes("ticketing") && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>IBAN</Label>
                <Input value={iban} onChange={e => setIban(e.target.value)} placeholder="NL91ABNA0417164300" />
              </div>
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="ABN AMRO" />
              </div>
            </div>
          )}

          {/* VAT & Address */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>VAT / Tax ID</Label>
              <Input value={vatId} onChange={e => setVatId(e.target.value)} placeholder="NL123456789B01" />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <AddressAutocomplete value={address} onChange={(val) => setAddress(val)} placeholder="Street, City" />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes…" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {editingContact ? "Save Changes" : "Add Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
