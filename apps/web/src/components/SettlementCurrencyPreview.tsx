import { useGetApiV1ExchangeRate, useGetApiV1ExchangeRateCurrencies } from "@showme/api-client";
import { Select } from "@showme/design-system";
import { convertMinorUnits } from "@showme/shared";
import { formatMoney } from "../lib/format";

/**
 * Read a settlement's figures in another currency, WITHOUT ever changing what it
 * settles in.
 *
 * `docs/money.md` draws a hard line here: a deal's payout currency is
 * authoritative and its FX is LOCKED at finalize, while a display currency is
 * cosmetic, live, and "never touches settled amounts". A currency control on a
 * settlement screen is therefore one wrong label away from implying the money
 * itself moved.
 *
 * So this returns a formatter and a banner, and the rule they enforce together is:
 * **the settlement's own currency is on screen at all times, next to the choice.**
 * You cannot look at a converted figure without also seeing what it actually
 * settles in. Picking the base currency back is always available and is the
 * default.
 *
 * The rate comes from `GET /exchange-rate`, the shared display-only cache
 * (refreshed by `apps/jobs`) — the same source every other cosmetic conversion in
 * the product uses. If no rate is cached for the pair, nothing converts and the
 * banner says so: a preview that silently falls back to unconverted figures while
 * claiming another currency would be worse than no preview.
 */
export interface CurrencyPreview {
  /** The currency the settlement is actually denominated in. Never changes. */
  baseCurrency: string;
  /** What the reader chose to look at it in. Equal to `baseCurrency` by default. */
  previewCurrency: string;
  setPreviewCurrency: (currency: string) => void;
  currencies: string[];
  /** True when figures on screen are converted rather than authoritative. */
  isPreviewing: boolean;
  /** The rate used, for the banner. Null when previewing is off or unavailable. */
  rate: string | null;
  /** Set when a preview was asked for and no rate could be found. */
  unavailable: boolean;
  /**
   * Format minor units for display. Converts ONLY when previewing and a rate
   * exists; otherwise it is the ordinary base-currency formatter.
   */
  format: (minorUnits: string) => string;
}

export function useCurrencyPreview(
  baseCurrency: string,
  previewCurrency: string,
  setPreviewCurrency: (currency: string) => void,
  /**
   * Did the reader pick this currency on this screen, or did it come from their
   * account preference? Only a CHOICE deserves a warning when no rate exists —
   * an inherited default falling back to the authoritative currency is the right
   * answer, not a failure. See `useDisplayCurrency` for the full argument.
   *
   * Defaults to `true` so an existing caller that passes nothing keeps the old
   * behaviour: everything is treated as chosen, and nothing goes quiet by
   * accident.
   */
  isExplicitChoice = true,
): CurrencyPreview {
  const wants = previewCurrency !== "" && previewCurrency !== baseCurrency;
  const currencyList = useGetApiV1ExchangeRateCurrencies();
  const rateQuery = useGetApiV1ExchangeRate(
    { from: baseCurrency, to: previewCurrency },
    { query: { enabled: wants && baseCurrency !== "" } },
  );

  const rate = wants ? (rateQuery.data?.rate ?? null) : null;
  const isPreviewing = wants && rate != null;
  const unavailable = wants && !rateQuery.isPending && rate == null && isExplicitChoice;

  const format = (minorUnits: string): string => {
    if (!isPreviewing || rate == null) return formatMoney(minorUnits, baseCurrency);
    const converted = convertMinorUnits(BigInt(minorUnits), baseCurrency, previewCurrency, rate);
    return formatMoney(converted.toString(), previewCurrency);
  };

  return {
    baseCurrency,
    previewCurrency: previewCurrency || baseCurrency,
    setPreviewCurrency,
    currencies: currencyList.data?.currencies?.map((entry) => entry.code) ?? [baseCurrency],
    isPreviewing,
    rate,
    unavailable,
    format,
  };
}

/**
 * The control itself: what it settles in, stated plainly, beside what you are
 * choosing to read it in. The first half is not a label on the selector — it is
 * the fact the selector must never be allowed to obscure.
 */
export function SettlementCurrencyControl({ preview }: { preview: CurrencyPreview }) {
  const options = [
    preview.baseCurrency,
    ...preview.currencies.filter((c) => c !== preview.baseCurrency),
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
        Settles in {preview.baseCurrency}
      </span>
      <div style={{ width: 120 }}>
        <Select
          value={preview.previewCurrency}
          onChange={preview.setPreviewCurrency}
          options={options}
          aria-label="Preview in another currency"
        />
      </div>
    </div>
  );
}

/**
 * The banner that must accompany converted figures.
 *
 * Renders nothing while the figures are authoritative — a permanent notice about
 * a state you are not in is noise. It appears the moment anything on screen stops
 * being the settled number.
 */
export function CurrencyPreviewNotice({ preview }: { preview: CurrencyPreview }) {
  if (preview.unavailable) {
    return (
      <Notice tone="warn">
        {/* Names the CAUSE, not just the effect. The old wording — "No live rate
            for SEK → EUR, so these figures are still in SEK" — was accurate and
            was read as a broken selector (ClickUp 86cbcn1ue: *"Currency selector
            in the top right side doesn't change the settlement's currency —
            Broken"*). It is not broken; it is refusing to convert money it has
            no rate for, which is the only safe thing to do. Saying which rate is
            missing, and that the figures below are the real ones, turns a
            mysterious refusal into a fact about the exchange-rate feed. */}
        We don't have an exchange rate for {preview.baseCurrency} → {preview.previewCurrency}, so
        nothing has been converted. The figures below are the real ones, in {preview.baseCurrency}.
      </Notice>
    );
  }
  if (!preview.isPreviewing) return null;
  return (
    <Notice tone="info">
      Preview only. These figures are converted from {preview.baseCurrency} at a live rate for
      reading — the settlement is denominated in {preview.baseCurrency}, and that is what is owed,
      recorded and paid.
    </Notice>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--shape-fill)",
        color: tone === "warn" ? "var(--brand-amber)" : "var(--muted)",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}
