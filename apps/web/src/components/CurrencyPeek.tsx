import { Icon, Select } from "@showme/design-system";
import type { CurrencyPreview } from "./SettlementCurrencyPreview";

/**
 * Look at money in another currency for a moment, without ever changing what it
 * is denominated in.
 *
 * The rule this encodes, from Ran: **figures are always in the transaction
 * currency**, and a currency selector is a way to *check* what that comes to
 * somewhere else — never a way to restate the sheet. So the event's own currency
 * is on screen at all times, peeking or not, and a peeked figure is marked `≈`.
 * It should be impossible to look at a number here and be unsure whether it is
 * the real one.
 *
 * The model is the eye on a password field: one obvious control, one click back,
 * and what it reveals is for READING. That last part is load-bearing rather than
 * decorative — see `BudgetPlanner`'s `readMoneyAs`, where peeking turns the money
 * fields into readouts, because an editable field showing a converted number
 * cannot answer "which currency did you just type?". Relabelling inputs without
 * converting them was the bug that started this (ClickUp 123qy9rnjb8).
 *
 * DELIBERATELY SMALLER THAN `SettlementCurrencyControl`, which does the same job
 * on the settlement screen with a full banner. That screen is showing figures
 * that are owed, recorded and paid, and a paragraph saying so earns its space
 * there. A budget is a forecast nobody is owed, so the same warning would be
 * noise on every visit. Same hook, same conversion, same missing-rate refusal —
 * only the volume differs.
 */
export function CurrencyPeekControl({ preview }: { preview: CurrencyPreview }) {
  const others = preview.currencies.filter((code) => code !== preview.baseCurrency);
  const peeking = preview.isPreviewing || preview.unavailable;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {/* The fact the control must never obscure. First, and always present. */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted)",
          whiteSpace: "nowrap",
        }}
      >
        {preview.baseCurrency}
      </span>

      <div style={{ width: 132 }}>
        <Select
          value={preview.isPreviewing ? preview.previewCurrency : ""}
          onChange={preview.setPreviewCurrency}
          options={others}
          // Not "Display currency". That name is what the removed selector
          // promised and did not do; this one only ever shows you a conversion.
          placeholder="View in…"
          aria-label="View these figures in another currency"
        />
      </div>

      {peeking && (
        <button
          type="button"
          onClick={() => preview.setPreviewCurrency(preview.baseCurrency)}
          aria-label={`Back to ${preview.baseCurrency}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 9px",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--button-surface)",
            color: "var(--muted)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <Icon name="eye-off" size={13} />
          Back to {preview.baseCurrency}
        </button>
      )}

      {preview.isPreviewing && (
        // The marker that travels with the figures. `≈` is doing real work: every
        // number on the sheet is now an approximation of one denominated
        // elsewhere, and the reader has to be able to tell at a glance.
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Showing <strong>≈ {preview.previewCurrency}</strong> at a live rate — the budget is in{" "}
          {preview.baseCurrency}.
        </span>
      )}

      {preview.unavailable && (
        // Says WHICH rate is missing and that the figures are the real ones. The
        // settlement screen learned this wording the hard way: a bare refusal to
        // convert reads as a broken selector (ClickUp 86cbcn1ue).
        <span style={{ fontSize: 12, color: "var(--brand-amber)" }}>
          No rate for {preview.baseCurrency} → {preview.previewCurrency}, so nothing was converted.
          These figures are the real ones.
        </span>
      )}
    </div>
  );
}
