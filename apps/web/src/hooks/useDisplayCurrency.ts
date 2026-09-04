import { useGetApiV1Me } from "@showme/api-client";
import { useState } from "react";

/**
 * WHICH CURRENCY THE READER SEES FIGURES IN — their standing preference, and any
 * override they make on the screen in front of them.
 *
 * `users.currency` has existed since the schema did and was read by **nothing**
 * (ClickUp 123qy9rnfz0). Every money screen kept its own `useState("")` and
 * defaulted to the event's base currency, so choosing a display currency in
 * Settings changed precisely nothing anywhere in the product. This is the hook
 * that makes the preference mean something.
 *
 * It is COSMETIC and stays cosmetic (`docs/money.md`, PLAN.md): the payout
 * currency on a deal is authoritative and the FX is locked at finalize. Nothing
 * here touches what is owed, recorded or paid — it only decides what a figure is
 * rendered as.
 *
 * ── The distinction this hook exists to carry ────────────────────────────────
 *
 * A preview currency can arrive two ways, and they deserve different behaviour
 * when no exchange rate can be found:
 *
 * - **Chosen** — the reader picked it from the selector on this screen. If there
 *   is no rate, they must be told: they asked a question and the answer is "we
 *   cannot". Silently showing base-currency figures under the heading they chose
 *   would be a lie about money.
 * - **Inherited** — nobody picked anything here; it came from their account
 *   preference. If there is no rate, falling back to the settlement's own
 *   currency is not a failure, it is the correct and authoritative reading. A
 *   warning would be scolding them for a default they never set on this page.
 *
 * That difference is not hypothetical. `exchange_rate_cache` is empty in
 * production today — the ExchangeRate-API key has not been bought and the job
 * that fills it has never run — so without this rule, applying the preference
 * would light a "no live rate" warning on every money screen in the app for
 * every user whose currency differs from the event's. Correct, and unusable.
 */
export interface DisplayCurrency {
  /** What to render figures in, or "" for "the base currency of this thing". */
  previewCurrency: string;
  /** The reader picking one on this screen. Always counts as an explicit choice. */
  setPreviewCurrency: (currency: string) => void;
  /**
   * Whether the current value was chosen HERE rather than inherited from the
   * account preference — which is what decides whether a missing rate is worth
   * saying out loud.
   */
  isExplicitChoice: boolean;
}

export function useDisplayCurrency(): DisplayCurrency {
  const me = useGetApiV1Me();
  // "" is not "no preference" — it is "not chosen on this screen". The account
  // preference fills that gap, and null there genuinely means never chosen.
  const [chosen, setChosen] = useState("");
  const preferred = me.data?.currency ?? "";

  return {
    previewCurrency: chosen || preferred,
    setPreviewCurrency: setChosen,
    isExplicitChoice: chosen !== "",
  };
}
