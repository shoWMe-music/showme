/**
 * Getting the address book out as a file, and a file back in as contacts.
 *
 * ONE column list serves both directions (`CONTACT_CSV_FIELDS`), so a file this
 * app exported can be edited in a spreadsheet and fed straight back — the
 * mapping step auto-matches every header without the operator touching it.
 *
 * The export is built client-side from what `GET /profiles/:id/contacts` already
 * returned, which is how it honours the field-level serializer for free: the
 * only fields that can reach the file are the fields the API chose to send this
 * caller. There is no export endpoint to keep in step with the serializer, and
 * so no way for the two to drift apart.
 *
 * The import's rules — dedupe on email, skip rather than overwrite, an imported
 * IBAN is never verified — live on the server (`routes/contacts.ts`). This hook
 * does not re-implement them: the preview is the SAME endpoint called with
 * `commit: false`, so what the operator approves is what lands.
 */
import { customFetch, type getApiV1ProfilesIdContacts } from "@showme/api-client";
import { type CsvColumn, parseCsv, toCsv } from "@showme/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { downloadTextFile } from "../lib/budgetExport";

export type Contact = Awaited<ReturnType<typeof getApiV1ProfilesIdContacts>>[number];
export type ContactPerson = { name?: string; email?: string; phone?: string };

/**
 * The folded `persons` jsonb is `unknown` on the wire — read it defensively.
 *
 * Only the FIRST person is exported. The column set is flat, and the app itself
 * only ever writes one (the Add Contact form has a single person), so this is
 * lossless in practice; a hand-crafted record with several would export its
 * primary one.
 */
export function firstContactPerson(contact: Contact): ContactPerson | null {
  const persons = contact.persons;
  if (Array.isArray(persons) && persons.length > 0) {
    const person = persons[0] as ContactPerson;
    if (person && typeof person === "object") return person;
  }
  return null;
}

/**
 * The exchange format. Every field a contact carries that a human typed —
 * everything the card shows plus the notes it does not. Left out deliberately:
 * `id`, `ownerProfileId` and the timestamps, which are ours rather than theirs
 * and mean nothing in a spreadsheet or on the way back in.
 */
export const CONTACT_CSV_FIELDS = [
  { field: "name", header: "Name" },
  { field: "type", header: "Type" },
  { field: "personName", header: "Contact person" },
  { field: "email", header: "Email" },
  { field: "phone", header: "Phone" },
  { field: "iban", header: "IBAN" },
  { field: "bankName", header: "Bank" },
  { field: "vatId", header: "VAT ID" },
  { field: "address", header: "Address" },
  { field: "notes", header: "Notes" },
] as const;

export type ContactCsvField = (typeof CONTACT_CSV_FIELDS)[number]["field"];

/** Header spellings we accept for each field, beyond its own header above. */
const HEADER_ALIASES: Record<ContactCsvField, readonly string[]> = {
  name: ["name", "company", "organization", "organisation", "contact"],
  type: ["type", "category", "kind"],
  personName: ["contactperson", "person", "contactname", "attention"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "telephone", "tel", "mobile", "phonenumber"],
  iban: ["iban", "bankaccount", "account"],
  bankName: ["bank", "bankname"],
  vatId: ["vat", "vatid", "vatnumber", "taxid", "orgnumber"],
  address: ["address", "postaladdress", "street"],
  notes: ["notes", "note", "comment", "comments"],
};

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Where each field's value sits in the file, by column index. */
export type ContactColumnMapping = Partial<Record<ContactCsvField, number>>;

/** Read one contact's value for a CSV field, folding the person fields in. */
function contactFieldValue(contact: Contact, field: ContactCsvField): string {
  const person = firstContactPerson(contact);
  switch (field) {
    case "personName":
      return person?.name ?? "";
    case "email":
      return person?.email ?? "";
    case "phone":
      return person?.phone ?? "";
    default:
      return contact[field] ?? "";
  }
}

/**
 * Hand the operator their address book as a file.
 *
 * Datestamped, because this is the export people take before a change they are
 * nervous about, and three files called `contacts (2).csv` in a downloads folder
 * are indistinguishable at the moment one of them is needed.
 */
export function exportContactsCsv(contacts: readonly Contact[]): void {
  const columns: CsvColumn<Contact>[] = CONTACT_CSV_FIELDS.map(({ field, header }) => ({
    header,
    value: (contact) => contactFieldValue(contact, field),
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`contacts-${stamp}.csv`, toCsv(columns, contacts), "text/csv;charset=utf-8");
}

/** Best guess at which column holds which field, from the header row. */
export function guessContactColumnMapping(headers: readonly string[]): ContactColumnMapping {
  const mapping: ContactColumnMapping = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    for (const { field } of CONTACT_CSV_FIELDS) {
      if (mapping[field] != null) continue;
      if (HEADER_ALIASES[field].includes(normalized)) {
        mapping[field] = index;
        return;
      }
    }
  });
  return mapping;
}

/** What the API says happened (or would happen) to one row. */
export interface ContactImportResult {
  index: number;
  name: string;
  email: string | null;
  outcome: "imported" | "skipped" | "rejected";
  reason: string | null;
  contactId: string | null;
}

export interface ContactImportReport {
  committed: boolean;
  imported: number;
  skipped: number;
  rejected: number;
  results: ContactImportResult[];
}

/** Matches the server's `MAX_IMPORT_ROWS` — caught here so the file is refused
 *  with a sentence rather than a 400 from a request that never had a chance. */
const MAX_IMPORT_ROWS = 500;

export interface ContactsImport {
  fileName: string | null;
  headers: string[];
  rowCount: number;
  mapping: ContactColumnMapping;
  setColumnFor: (field: ContactCsvField, column: number | null) => void;
  preview: ContactImportReport | null;
  report: ContactImportReport | null;
  fileError: string | null;
  error: unknown;
  isPending: boolean;
  readFile: (file: File) => Promise<void>;
  runPreview: () => void;
  commit: () => void;
  reset: () => void;
}

/**
 * The import, one file at a time: pick → map → preview → commit.
 *
 * Changing a column after previewing drops the preview, because a preview of a
 * different mapping is worse than none — it would have the operator approving
 * verdicts for rows the commit will never see.
 */
export function useContactsImport(profileId: string, onCommitted: () => void): ContactsImport {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ContactColumnMapping>({});
  const [preview, setPreview] = useState<ContactImportReport | null>(null);
  const [report, setReport] = useState<ContactImportReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const importRows = () =>
    dataRows.map((cells) => {
      const row: Partial<Record<ContactCsvField, string>> = {};
      for (const { field } of CONTACT_CSV_FIELDS) {
        const column = mapping[field];
        if (column == null) continue;
        const value = cells[column];
        if (value != null && value.trim() !== "") row[field] = value.trim();
      }
      return row;
    });

  const submit = useMutation({
    mutationFn: (commit: boolean) =>
      customFetch<ContactImportReport>({
        url: `/api/v1/profiles/${profileId}/contacts/import`,
        method: "POST",
        data: { rows: importRows(), commit },
      }),
    onSuccess: (result) => {
      if (result.committed) {
        setReport(result);
        onCommitted();
      } else {
        setPreview(result);
      }
    },
  });

  function reset() {
    setFileName(null);
    setHeaders([]);
    setDataRows([]);
    setMapping({});
    setPreview(null);
    setReport(null);
    setFileError(null);
    submit.reset();
  }

  async function readFile(file: File) {
    reset();
    const rows = parseCsv(await file.text());
    const [headerRow, ...rest] = rows;
    setFileName(file.name);
    if (!headerRow || rest.length === 0) {
      setFileError("That file has no rows under its header.");
      return;
    }
    if (rest.length > MAX_IMPORT_ROWS) {
      setFileError(`That file has ${rest.length} rows. One import takes ${MAX_IMPORT_ROWS}.`);
      return;
    }
    setHeaders(headerRow);
    setDataRows(rest);
    setMapping(guessContactColumnMapping(headerRow));
  }

  return {
    fileName,
    headers,
    rowCount: dataRows.length,
    mapping,
    setColumnFor: (field, column) => {
      setPreview(null);
      setMapping((current) => {
        const next = { ...current };
        if (column == null) delete next[field];
        else next[field] = column;
        return next;
      });
    },
    preview,
    report,
    fileError,
    error: submit.error,
    isPending: submit.isPending,
    readFile,
    runPreview: () => submit.mutate(false),
    commit: () => submit.mutate(true),
    reset,
  };
}
