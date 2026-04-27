import { useContacts } from "@/lib/queries";
import type { ContactType } from "@/lib/models";
import { Combobox, ComboboxOption } from "@/components/ui/combobox";
import { useState, useEffect } from "react";

interface ContactComboboxProps {
  contactType: ContactType | ContactType[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function ContactCombobox({ contactType, value, onChange, placeholder, disabled }: ContactComboboxProps) {
  const contacts = useContacts();
  const [search, setSearch] = useState(value);

  const types = Array.isArray(contactType) ? contactType : [contactType];
  const filtered = contacts
    .filter(c => types.includes(c.type))
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => { setSearch(value); }, [value]);

  return (
    <Combobox
      value={search}
      onValueChange={(v) => {
        setSearch(v);
        onChange(v);
      }}
      placeholder={placeholder}
      disabled={disabled}
    >
      {filtered.map(c => (
        <ComboboxOption
          key={c.id}
          selected={c.name === value}
          onSelect={() => {
            onChange(c.name);
            setSearch(c.name);
          }}
        >
          {c.name}
        </ComboboxOption>
      ))}
    </Combobox>
  );
}
