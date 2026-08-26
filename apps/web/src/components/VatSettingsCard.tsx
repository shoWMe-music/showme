import { useGetApiV1ProfilesId, usePatchApiV1ProfilesIdBilling } from "@showme/api-client";
import { Button, Card, TextField, Toggle, useToast } from "@showme/design-system";
import { errorMessage } from "../lib/errors";
import { useVatSettings } from "./VatSettingsState";
import { Eyebrow } from "./primitives";
import { ErrorState, LoadingState } from "./states";

/**
 * The VAT tab of Settings — the profile's tax identity (decisions #5:
 * `vat_registered`, `vat_id`, `vat_rate` on `profiles.billing`).
 *
 * **Why the "VAT registered" toggle exists at all.** It shipped from the design
 * prototype writing `billing.vatRegistered` into jsonb that NOTHING read, and
 * nothing else on the screen changed when you flipped it — a dead affordance, and
 * the user said so. It is kept rather than deleted because it is a real
 * distinction a booking business makes (a registered company charges VAT and has
 * an ID; a small performer below the threshold has neither), and decisions #5
 * names it as part of the payout identity.
 *
 * What it now DOES: it governs the VAT identity beneath it. Off, there is no VAT
 * ID and no rate — and saving CLEARS both, because "not VAT registered" and "VAT
 * ID DE123456789 at 19%" cannot both be true. On, the ID and the default rate are
 * required and saved. `vat_rate` had never been exposed by any screen before this,
 * despite the API accepting it since decisions #5.
 *
 * What it deliberately does NOT do yet: compute VAT onto invoice documents.
 * `docs/money.md` explicitly defers invoice VAT rounding (per-line vs total,
 * jurisdiction-dependent) to the invoice/payments phase, so this screen states the
 * limit plainly instead of implying an automation that does not exist.
 */
export function VatSettingsCard({ profileId }: { profileId: string }) {
  const profile = useGetApiV1ProfilesId(profileId, { query: { enabled: Boolean(profileId) } });
  const toast = useToast();
  const patch = usePatchApiV1ProfilesIdBilling({
    mutation: {
      onSuccess: () => toast.success("VAT details saved"),
      onError: (mutationError) => toast.error(errorMessage(mutationError, "Couldn't save.")),
    },
  });
  const vat = useVatSettings(profile.data?.billing);

  if (!profileId) return null;
  if (profile.isPending) return <LoadingState label="Loading VAT details" />;
  if (profile.isError)
    return <ErrorState error={profile.error} title="Couldn't load VAT details" />;

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Eyebrow>VAT</Eyebrow>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, color: "var(--text)" }}>VAT registered</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: 460 }}>
            {vat.registered
              ? "This account charges VAT. Its VAT ID and rate belong on the invoices it issues."
              : "This account does not charge VAT. Turning this on asks for the VAT ID and rate; turning it off clears both."}
          </span>
        </div>
        <Toggle
          checked={vat.registered}
          onChange={vat.setRegistered}
          label="VAT registered"
          id="vat-registered"
        />
      </div>

      {vat.registered && (
        <>
          <TextField
            label="VAT ID"
            value={vat.vatId}
            placeholder="e.g. DE123456789"
            onChange={(changeEvent) => vat.setVatId(changeEvent.target.value)}
          />
          <TextField
            label="Default VAT rate (%)"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={vat.rate}
            placeholder="e.g. 25"
            onChange={(changeEvent) => vat.setRate(changeEvent.target.value)}
          />
        </>
      )}

      {vat.problem && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
          {vat.problem}
        </p>
      )}

      {/* Honest about the boundary: this is the tax IDENTITY, not an invoice
          engine. money.md defers VAT computation to the payments phase. */}
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
        VAT is not yet calculated onto invoice documents automatically — enter the amount on the
        invoice itself. These details are what shoWMe will use once it is.
      </p>

      <div>
        <Button
          variant="primary"
          onClick={() => patch.mutate({ id: profileId, data: vat.payload })}
          disabled={patch.isPending || !vat.isDirty || vat.problem !== null}
        >
          {patch.isPending ? "Saving…" : "Save VAT details"}
        </Button>
      </div>
    </Card>
  );
}
