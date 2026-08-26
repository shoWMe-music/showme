import { useEffect, useState } from "react";

/**
 * The state and the rules behind the VAT tab (`VatSettingsCard`) — kept out of the
 * component so the screen stays dumb.
 *
 * The whole point of this hook is that **"VAT registered" is not a decoration**:
 * it decides whether a VAT identity exists at all. When it is off there is no ID
 * and no rate, and `payload` says so explicitly (empty id, zero rate) rather than
 * quietly leaving stale values behind in `profiles.billing` — a profile that
 * switched off VAT registration but kept "DE123456789 / 19%" on file would be
 * lying about its tax status.
 */

/** `profiles.billing` is jsonb — read defensively, it is `unknown` on the wire. */
export interface VatBilling {
  vatId?: unknown;
  vatRegistered?: unknown;
  vatRate?: unknown;
}

export interface VatSettingsView {
  registered: boolean;
  setRegistered: (next: boolean) => void;
  vatId: string;
  setVatId: (next: string) => void;
  /** Held as a string so the field can be empty while being typed. */
  rate: string;
  setRate: (next: string) => void;
  /** The one thing stopping a save, or `null`. */
  problem: string | null;
  isDirty: boolean;
  payload: { vatRegistered: boolean; vatId: string; vatRate: number };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRate(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function useVatSettings(billing: unknown): VatSettingsView {
  const [registered, setRegistered] = useState(false);
  const [vatId, setVatId] = useState("");
  const [rate, setRate] = useState("");
  /** What the server last told us — the baseline `isDirty` compares against. */
  const [saved, setSaved] = useState({ registered: false, vatId: "", rate: "" });

  useEffect(() => {
    const value = (billing ?? {}) as VatBilling;
    const next = {
      registered: value.vatRegistered === true,
      vatId: readString(value.vatId),
      rate: readRate(value.vatRate),
    };
    setRegistered(next.registered);
    setVatId(next.vatId);
    setRate(next.rate);
    setSaved(next);
  }, [billing]);

  const parsedRate = Number(rate);
  const rateIsValid =
    rate.trim() !== "" && Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 100;

  let problem: string | null = null;
  if (registered && vatId.trim() === "")
    problem = "Enter the VAT ID this account is registered under.";
  else if (registered && !rateIsValid) problem = "Enter a default VAT rate between 0 and 100.";

  const isDirty =
    registered !== saved.registered || vatId.trim() !== saved.vatId || rate.trim() !== saved.rate;

  // Off means OFF: the identity is cleared, not merely hidden.
  const payload = registered
    ? { vatRegistered: true, vatId: vatId.trim(), vatRate: rateIsValid ? parsedRate : 0 }
    : { vatRegistered: false, vatId: "", vatRate: 0 };

  return {
    registered,
    setRegistered,
    vatId,
    setVatId,
    rate,
    setRate,
    problem,
    isDirty,
    payload,
  };
}
