/**
 * Bringing an address book in from a spreadsheet: pick → map → preview → commit.
 *
 * The preview is not a guess. It is the import endpoint called with
 * `commit: false`, so the verdict beside each row is the verdict that row will
 * get — there is no second implementation of the rules here to drift from the
 * server's. All this file decides is how to say them.
 */
import { Badge, Button, DataTable, Icon, Modal, Select } from "@showme/design-system";
import { useRef } from "react";
import {
  CONTACT_CSV_FIELDS,
  type ContactImportResult,
  useContactsImport,
} from "../hooks/useContactsCsv";
import { errorMessage } from "../lib/errors";

const NO_COLUMN = "";

/** Result hue and wording — a preview says what WILL happen, a report what did. */
const OUTCOME_BADGE: Record<
  ContactImportResult["outcome"],
  { status: "confirmed" | "pending" | "cancelled"; preview: string; done: string }
> = {
  imported: { status: "confirmed", preview: "Will import", done: "Imported" },
  skipped: { status: "pending", preview: "Will skip", done: "Skipped" },
  rejected: { status: "cancelled", preview: "Rejected", done: "Rejected" },
};

function ResultTable({
  results,
  committed,
}: {
  results: ContactImportResult[];
  committed: boolean;
}) {
  return (
    <DataTable<ContactImportResult>
      rows={results}
      getRowKey={(result) => String(result.index)}
      columns={[
        {
          header: "Row",
          width: "56px",
          render: (result) => <span style={{ color: "var(--muted)" }}>{result.index + 1}</span>,
        },
        {
          header: "Name",
          width: "1.4fr",
          render: (result) => result.name || <span style={{ color: "var(--muted)" }}>—</span>,
        },
        {
          header: "Email",
          width: "1.6fr",
          render: (result) => <span style={{ wordBreak: "break-all" }}>{result.email ?? "—"}</span>,
        },
        {
          header: "Result",
          width: "116px",
          render: (result) => {
            const badge = OUTCOME_BADGE[result.outcome];
            return (
              <Badge status={badge.status} dot>
                {committed ? badge.done : badge.preview}
              </Badge>
            );
          },
        },
        {
          header: "Why",
          width: "2fr",
          render: (result) => (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{result.reason ?? ""}</span>
          ),
        },
      ]}
    />
  );
}

export function ContactImportModal({
  open,
  profileId,
  onClose,
  onImported,
}: {
  open: boolean;
  profileId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const contactsImport = useContactsImport(profileId, onImported);
  const { fileName, headers, rowCount, mapping, preview, report, fileError } = contactsImport;

  const close = () => {
    contactsImport.reset();
    onClose();
  };

  const columnOptions = [
    { value: NO_COLUMN, label: "Not in this file" },
    ...headers.map((header, index) => ({
      value: String(index),
      label: header.trim() || `Column ${index + 1}`,
    })),
  ];

  const footer = report ? (
    <Button variant="primary" onClick={close}>
      Done
    </Button>
  ) : (
    <>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      {preview ? (
        <Button
          variant="primary"
          leftIcon={<Icon name="upload" />}
          onClick={contactsImport.commit}
          disabled={contactsImport.isPending || preview.imported === 0}
        >
          {contactsImport.isPending
            ? "Importing…"
            : `Import ${preview.imported} contact${preview.imported === 1 ? "" : "s"}`}
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={contactsImport.runPreview}
          disabled={rowCount === 0 || mapping.name == null || contactsImport.isPending}
        >
          {contactsImport.isPending ? "Checking…" : "Preview"}
        </Button>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={close} title="Import contacts" width={760} footer={footer}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(changeEvent) => {
            const file = changeEvent.target.files?.[0];
            // Clearing the input lets the same file be re-picked after a reset;
            // otherwise the second pick fires no change event at all.
            changeEvent.target.value = "";
            if (file) void contactsImport.readFile(file);
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            leftIcon={<Icon name="file" />}
            onClick={() => fileInput.current?.click()}
          >
            {fileName ? "Choose another file" : "Choose a CSV file"}
          </Button>
          {fileName && (
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              {fileName} · {rowCount} row{rowCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* Said before anything is picked, because these are the two things an
            operator would otherwise only discover afterwards. */}
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          A row whose email is already in your contacts is <strong>skipped</strong>, never merged —
          nothing you already have is overwritten. An imported IBAN arrives{" "}
          <strong>unverified</strong>: a file cannot vouch for a bank account.
        </p>

        {fileError && <div style={{ color: "#EE5746", fontSize: 13 }}>{fileError}</div>}
        {contactsImport.error != null && (
          <div style={{ color: "#EE5746", fontSize: 13 }}>
            {errorMessage(contactsImport.error, "Couldn't read that import.")}
          </div>
        )}

        {headers.length > 0 && !report && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Columns</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {CONTACT_CSV_FIELDS.map(({ field, header }) => (
                <Select
                  key={field}
                  label={field === "name" ? `${header} (required)` : header}
                  value={mapping[field] == null ? NO_COLUMN : String(mapping[field])}
                  options={columnOptions}
                  searchable={false}
                  onChange={(value) =>
                    contactsImport.setColumnFor(field, value === NO_COLUMN ? null : Number(value))
                  }
                />
              ))}
            </div>
            {mapping.name == null && (
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                Point Name at a column — a contact without one cannot be found again.
              </div>
            )}
          </div>
        )}

        {(report ?? preview) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {report
                ? `${report.imported} imported · ${report.skipped} skipped · ${report.rejected} rejected`
                : `${preview?.imported} to import · ${preview?.skipped} duplicate · ${preview?.rejected} rejected`}
            </div>
            <ResultTable results={(report ?? preview)?.results ?? []} committed={Boolean(report)} />
          </div>
        )}
      </div>
    </Modal>
  );
}
