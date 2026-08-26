import { type CsvColumn, minorToDecimalString, money, toCsv } from "@showme/shared";
import { formatMoney } from "./format";

/**
 * The event as a spreadsheet — the CSV half of Share & Export.
 *
 * Pure string building over rows the screen has already fetched and is already
 * allowed to see; the DOM half (a Blob and an object URL) is `budgetExport.ts`'s
 * `downloadTextFile`, which is where every file this app hands out is born.
 *
 * ONE FILE, WITH A SECTION COLUMN. The old app exported per-section files, which
 * meant an operator wanting the whole show ended up with four downloads and no
 * way to see them together. A single flat table tagged by section sorts and
 * filters in any spreadsheet, and — the reason that matters here — it makes the
 * export mirror the SHARE: the sections in the file are exactly the sections the
 * link would carry, so "what am I sending?" has one answer for both buttons.
 *
 * Money is a plain decimal string in major units with no symbol and no thousands
 * separator, for the same reason `budget-csv.ts` says: a spreadsheet parses
 * "50000.00" as a number and "€50,000.00" as text, and amounts that land as text
 * are amounts nobody can sum. The currency rides in its own column.
 */

/** One line of the export, whatever section it came from. */
export interface ShareExportRow {
  readonly section: string;
  readonly line: string;
  readonly detail: string;
  /** Minor units as a string, or null for a row that is not money. */
  readonly amount: string | null;
  readonly currency: string;
}

const COLUMNS: readonly CsvColumn<ShareExportRow>[] = [
  { header: "Section", key: "section" },
  { header: "Line", key: "line" },
  { header: "Detail", key: "detail" },
  {
    header: "Amount",
    value: (row) =>
      row.amount == null ? "" : minorToDecimalString(money(BigInt(row.amount), row.currency)),
  },
  { header: "Currency", value: (row) => (row.amount == null ? "" : row.currency) },
];

/** What the export can be built from — whatever the dialog managed to fetch. */
export interface ShareExportInput {
  readonly eventTitle: string;
  readonly currency: string;
  readonly event?: {
    readonly status: string;
    readonly eventDate: string | null;
    readonly venueName: string | null;
    readonly capacity: number | null;
  } | null;
  readonly schedule?: readonly {
    readonly localDateTime: string | null;
    readonly label: string;
    readonly category: string;
  }[];
  readonly riders?: readonly {
    readonly type: string;
    readonly name: string;
    readonly description: string | null;
  }[];
  readonly budgetLines?: readonly {
    readonly kind: string;
    readonly label: string;
    readonly amount: string;
    readonly currency?: string | null;
  }[];
  readonly deals?: readonly {
    readonly name: string;
    readonly type: string;
    readonly agreementStatus: string;
    readonly currency?: string | null;
    readonly guaranteeAmount?: string | null;
  }[];
  readonly settlements?: readonly {
    readonly participantId: string | null;
    readonly status: string;
    readonly entitlement: string | null;
    readonly net: string | null;
  }[];
  /** Names for participant ids, so a settlement row says who rather than a uuid. */
  readonly participantNames?: Readonly<Record<string, string>>;
}

/** Build the rows for the chosen sections, in the order the document renders them. */
export function shareExportRows(
  input: ShareExportInput,
  sections: readonly string[],
): ShareExportRow[] {
  const chosen = new Set(sections);
  const rows: ShareExportRow[] = [];
  const currency = input.currency;

  if (chosen.has("event") && input.event) {
    rows.push(
      { section: "Event", line: "Title", detail: input.eventTitle, amount: null, currency },
      { section: "Event", line: "Status", detail: input.event.status, amount: null, currency },
      {
        section: "Event",
        line: "Date",
        detail: input.event.eventDate ?? "",
        amount: null,
        currency,
      },
      {
        section: "Event",
        line: "Venue",
        detail: input.event.venueName ?? "",
        amount: null,
        currency,
      },
      {
        section: "Event",
        line: "Capacity",
        detail: input.event.capacity == null ? "" : String(input.event.capacity),
        amount: null,
        currency,
      },
    );
  }

  if (chosen.has("schedule")) {
    for (const item of input.schedule ?? []) {
      rows.push({
        section: "Schedule",
        line: item.label,
        // Space, not the ISO "T": a spreadsheet reads "2026-04-18 15:00" as a
        // datetime and "2026-04-18T15:00" as text, and the printed sheet reads it
        // as a clock rather than a serialization.
        detail: `${item.category}${
          item.localDateTime ? ` · ${item.localDateTime.replace("T", " ")}` : ""
        }`,
        amount: null,
        currency,
      });
    }
  }

  if (chosen.has("riders")) {
    for (const rider of input.riders ?? []) {
      rows.push({
        section: "Riders",
        line: rider.name,
        detail: [rider.type, rider.description].filter(Boolean).join(" · "),
        amount: null,
        currency,
      });
    }
  }

  if (chosen.has("budget")) {
    for (const line of input.budgetLines ?? []) {
      rows.push({
        section: line.kind === "revenue" ? "Revenue" : "Cost",
        line: line.label,
        detail: line.kind,
        amount: line.amount,
        currency: line.currency ?? currency,
      });
    }
  }

  if (chosen.has("deal")) {
    for (const deal of input.deals ?? []) {
      rows.push({
        section: "Deal",
        line: deal.name,
        detail: `${deal.type} · ${deal.agreementStatus}`,
        amount: deal.guaranteeAmount ?? null,
        currency: deal.currency ?? currency,
      });
    }
  }

  if (chosen.has("settlement")) {
    for (const settlement of input.settlements ?? []) {
      const who =
        (settlement.participantId
          ? input.participantNames?.[settlement.participantId]
          : undefined) ?? "Party";
      rows.push(
        {
          section: "Settlement",
          line: who,
          detail: `entitlement · ${settlement.status}`,
          amount: settlement.entitlement,
          currency,
        },
        {
          section: "Settlement",
          line: who,
          detail: `net · ${settlement.status}`,
          amount: settlement.net,
          currency,
        },
      );
    }
  }

  return rows;
}

/** The whole export as one RFC-4180 CSV string. */
export function shareExportCsv(input: ShareExportInput, sections: readonly string[]): string {
  return toCsv(COLUMNS, shareExportRows(input, sections));
}

/** A filename that survives every filesystem — no slashes, colons or spaces. */
export function shareExportFileName(eventTitle: string): string {
  const slug = eventTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "event"}-export.csv`;
}

/**
 * The same rows, as a PRINTABLE document.
 *
 * `window.print()` on the app was not an export. It printed the event screen —
 * sidebar, tab strip, the open dialog and all — because the app has no print
 * stylesheet anywhere (`@media print` appears in no file in this repo). What came
 * out was a screenshot of a browser, and the operator's counterparty was expected
 * to accept it as the show's paperwork.
 *
 * So the print is built the way the CSV is built: from `shareExportRows`, for the
 * sections the operator ticked. All three doors — print, file, link — then say the
 * same thing about the same show, which is the property this file was written to
 * have.
 *
 * PAPER IS NOT A THEME. The colours below are literals rather than tokens, and
 * that is the point: `--text` is near-white in dark mode, and ink is not something
 * the reader's OS setting gets to choose. Everything a screen renders keeps using
 * the tokens; this one sheet is the only surface in the app whose medium is paper.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PRINT_STYLES = `
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #16130f; }
  h1 { margin: 0 0 2px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  .meta { color: #6b625a; font-size: 11px; margin-bottom: 22px; }
  section { margin-bottom: 20px; break-inside: avoid; }
  h2 { margin: 0 0 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6b625a; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 0; border-bottom: 1px solid #e3ddd5; vertical-align: top; }
  td.line { font-weight: 500; width: 38%; }
  td.detail { color: #6b625a; }
  td.amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 22%; }
  .empty { color: #6b625a; }
`;

/** The chosen sections as one standalone HTML document, ready for a print dialog. */
export function shareExportDocumentHtml(
  input: ShareExportInput,
  sections: readonly string[],
): string {
  const rows = shareExportRows(input, sections);
  const grouped: { section: string; rows: ShareExportRow[] }[] = [];
  for (const row of rows) {
    const last = grouped.at(-1);
    if (last && last.section === row.section) last.rows.push(row);
    else grouped.push({ section: row.section, rows: [row] });
  }

  const body = grouped
    .map(
      (group) =>
        `<section><h2>${escapeHtml(group.section)}</h2><table>${group.rows
          .map(
            (row) =>
              `<tr><td class="line">${escapeHtml(row.line)}</td><td class="detail">${escapeHtml(
                row.detail,
              )}</td><td class="amount">${
                row.amount == null ? "" : escapeHtml(formatMoney(row.amount, row.currency))
              }</td></tr>`,
          )
          .join("")}</table></section>`,
    )
    .join("");

  const printedOn = new Date().toLocaleDateString("en-IE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    input.eventTitle,
  )}</title><style>${PRINT_STYLES}</style></head><body><h1>${escapeHtml(
    input.eventTitle,
  )}</h1><div class="meta">Shared from shoWMe · ${escapeHtml(printedOn)}</div>${
    body || '<p class="empty">Nothing selected to print.</p>'
  }</body></html>`;
}

/**
 * Hand the chosen sections to the browser's print dialog — which is where "Save
 * as PDF" lives, and therefore what the PDF button has always meant here.
 *
 * A hidden same-origin iframe rather than `window.open()`: a popup is blocked by
 * default in enough browsers that the button would silently do nothing for some
 * operators, and a popup blocked is indistinguishable from a feature broken. The
 * frame is removed once the dialog closes (`afterprint`), with a timeout behind it
 * because Safari does not always fire it.
 */
export function printShareExport(input: ShareExportInput, sections: readonly string[]): void {
  const html = shareExportDocumentHtml(input, sections);
  const frame = window.document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.srcdoc = html;

  const remove = () => frame.remove();
  frame.onload = () => {
    const view = frame.contentWindow;
    if (!view) {
      remove();
      return;
    }
    view.addEventListener("afterprint", remove);
    window.setTimeout(remove, 60_000);
    view.focus();
    view.print();
  };

  window.document.body.appendChild(frame);
}
