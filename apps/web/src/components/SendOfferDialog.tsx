import { useGetApiV1Representations, usePostApiV1Offers } from "@showme/api-client";
import { Button, Modal, Select, TextField, useToast } from "@showme/design-system";
import { currencyForCountry, majorToMinor } from "@showme/shared";
import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { errorMessage } from "../lib/errors";
import { DateTimeField } from "./DateTimeField";
import { EventVenuePicker } from "./EventVenuePicker";
import { type OfferDraft, offerBody, offerProblem, offerProblemMessage } from "./offerDraft";
import { Eyebrow } from "./primitives";

/**
 * SENDING AN OFFER — the caller `POST /offers` never had (QA sweep run 7, QA7-5).
 *
 * The route, its entitlement gate (a `free_artist` is capped at 50 performer-offers a
 * month, decisions #4), its fee range, its pitch and its agent-on-behalf-of rule (#14)
 * have all existed and been tested at the API since they were written. **The generated
 * `usePostApiV1Offers` had no caller anywhere in `apps/web`.** So a signed-in act's only
 * route to a venue was to leave the app, find that venue's public page and fill in a
 * stranger's form — writing `source: public_form`, `sender_profile_id: null`, no fee
 * range and no agency attribution — and the Outgoing tab listed seeded `performer_offer`
 * rows no user of this build could produce.
 *
 * Dumb by construction, like every other dialog here: the rule is `offerDraft.ts`, the
 * money conversion is `toMinorUnits`, and the only thing this file decides is what a
 * person sees.
 *
 * THE VENUE PICKER IS THE EVENT'S. `EventVenuePicker` already searches operator profiles
 * and answers with the profile behind the name, which is exactly what `targetProfileId`
 * needs — and reusing it means an act picks a room the same way an operator does. A
 * typed name with no profile behind it cannot be sent, and the rule says so rather than
 * this silently posting nothing.
 */
export interface SendOfferDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a 201, so the inbox can refetch its Outgoing list. */
  onSent: () => void;
}

const EMPTY: OfferDraft = {
  targetProfileId: "",
  wantedDate: "",
  feeMin: "",
  feeMax: "",
  pitch: "",
  onBehalfOfProfileId: "",
};

export function SendOfferDialog({ open, onClose, onSent }: SendOfferDialogProps) {
  const { session } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<OfferDraft>(EMPTY);
  /** The venue's NAME as typed, which the picker owns; the id is on the draft. */
  const [venueName, setVenueName] = useState("");

  /**
   * An agent must name the act (#14), and the roster is the representation list — which
   * had no reader in this app at all until this dialog, and now carries both names so a
   * picker needs one request rather than an N+1 of profile reads.
   *
   * ACTIVE only: a terminated or unconfirmed representation is not authority to offer on
   * somebody's behalf, and the route would refuse it — a picker that offers it is a
   * 400 waiting to happen.
   */
  const isAgent = session?.kind === "agent";
  const representations = useGetApiV1Representations({ query: { enabled: open && isAgent } });
  const acts = useMemo(
    () =>
      (representations.data ?? [])
        .filter((row) => row.status === "active")
        .map((row) => ({
          value: row.performerProfileId,
          label: row.performerName ?? "An act whose profile is gone",
        })),
    [representations.data],
  );

  /**
   * THE FEE IS IN THE VENUE'S CURRENCY, not the sender's (`venueCurrency` in
   * `routes/inbound.ts`: *"the target VENUE's currency, derived from its primary
   * location's country — currency is a per-country fact, decisions.md #17"*, stamped once
   * at creation).
   *
   * So the fields are labelled and converted in that currency, derived the same way the
   * server derives it, from the same fact — and from the country the PICKER hands over,
   * because a performer or an agent gets a 404 on `GET /profiles/:id` for a venue they are
   * not a member of. The search result the picker already holds is the only place this is
   * readable to them, which is worth knowing before reaching for the profile route.
   *
   * WHEN THE VENUE HAS NO COUNTRY the server stores the fee with `currency: null` and it
   * *"renders bare"* — a number with no currency on it. So the fee fields are withheld
   * rather than offered: this app has already learned once that a figure under the wrong
   * symbol, or none, is a statement about somebody's money that happens to be false
   * (`Invoices.tsx`, QA6-17). The date and the pitch still send.
   */
  const [venueCountry, setVenueCountry] = useState<string | null>(null);
  const feeCurrency = useMemo(
    () => (venueCountry ? (currencyForCountry(venueCountry) ?? null) : null),
    [venueCountry],
  );

  const problem = offerProblem(draft, {
    // The reader's own day, so "that date has already passed" means their tonight.
    today: new Date().toLocaleDateString("en-CA"),
    senderIsAnAgent: isAgent,
  });

  const send = usePostApiV1Offers({
    mutation: {
      onSuccess: () => {
        toast.success("Offer sent.");
        setDraft(EMPTY);
        setVenueName("");
        onSent();
        onClose();
      },
      // The entitlement refusal names the plan and the cap, which is the only thing that
      // tells the sender what to do next — so it is shown rather than replaced.
      onError: (error) => toast.error(errorMessage(error, "Couldn't send the offer.")),
    },
  });

  const change = (patch: Partial<OfferDraft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send an offer"
      // Holds typed input, so a click a millimetre outside must not discard it — the same
      // rule the decline dialog follows (ClickUp 123qy9rnfyw).
      dismissOnScrim={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={problem !== null || send.isPending}
            onClick={() =>
              send.mutate({
                // `majorToMinor` asks the CURRENCY how many minor units a major one holds
                // rather than assuming two places — the fault QA6-17 found in the invoice
                // form, and `feeCurrency` is non-null wherever a fee can be typed at all.
                data: offerBody(draft, (major) =>
                  majorToMinor(major, feeCurrency ?? "SEK").toString(),
                ) as never,
              })
            }
          >
            {send.isPending ? "Sending…" : "Send offer"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
          Your offer arrives in the venue's Incoming requests, under your own name — with the fee
          range and the note you give here.
        </p>

        {isAgent && (
          <div>
            <Eyebrow>Offering for</Eyebrow>
            <Select
              value={draft.onBehalfOfProfileId}
              onChange={(onBehalfOfProfileId) => change({ onBehalfOfProfileId })}
              options={acts}
              placeholder={acts.length === 0 ? "No acts you represent yet" : "Choose an act…"}
            />
          </div>
        )}

        <div>
          <Eyebrow>Venue</Eyebrow>
          <EventVenuePicker
            value={venueName}
            onChangeText={(next) => {
              setVenueName(next);
              setVenueCountry(null);
              // A name typed over a chosen venue is no longer that venue: the id goes
              // with it, and the rule then refuses to send until one is picked again.
              change({ targetProfileId: "" });
            }}
            onSelectProfile={(choice) => {
              setVenueName(choice?.name ?? "");
              setVenueCountry(choice?.country ?? null);
              change({ targetProfileId: choice?.profileId ?? "" });
            }}
            selectedProfileId={draft.targetProfileId === "" ? null : draft.targetProfileId}
            inputAriaLabel="Venue you are offering to"
          />
        </div>

        <DateTimeField
          label="Date you want"
          type="date"
          value={draft.wantedDate}
          onChange={(event) => change({ wantedDate: event.target.value })}
        />

        {feeCurrency !== null ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <TextField
              label={`Fee from (${feeCurrency})`}
              value={draft.feeMin}
              placeholder="Optional"
              onChange={(event) => change({ feeMin: event.target.value })}
            />
            <TextField
              label={`Fee to (${feeCurrency})`}
              value={draft.feeMax}
              placeholder="Optional"
              onChange={(event) => change({ feeMax: event.target.value })}
            />
          </div>
        ) : (
          draft.targetProfileId !== "" && (
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              This venue has not said which country it is in, so there is no currency to put a fee
              in yet. Say what you are asking for in the note below.
            </p>
          )
        )}

        <TextField
          label="Why this night"
          value={draft.pitch}
          placeholder="Optional: what you would bring, and who you draw"
          onChange={(event) => change({ pitch: event.target.value })}
        />

        {/* The reason the button is off, where the button is — a disabled control whose
            explanation lives in a tooltip is the shape this codebase has fixed twice. */}
        {problem !== null && (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            {offerProblemMessage(problem)}
          </p>
        )}
      </div>
    </Modal>
  );
}
