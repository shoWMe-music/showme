import { type getApiV1Profiles, useGetApiV1Profiles, usePostApiV1Events } from "@showme/api-client";
import { Icon, type IconName, Select, useToast } from "@showme/design-system";
import { currencyOptionsForCountry, defaultCurrencyForCountry } from "@showme/shared";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { setActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { DateTimeField } from "./DateTimeField";
import { EventVenuePicker, type VenueChoice } from "./EventVenuePicker";
import {
  type HoldPlacement,
  HoldPriorityField,
  holdOrdinal,
  useHoldPlacement,
} from "./HoldPlacement";
import { PerformerSearch, type PerformerSelection } from "./PerformerSearch";
import { GlyphButton, GradientButton, XIcon, fieldStyle } from "./eventUi";
import { useEventVenuePrefill } from "./useEventVenuePrefill";

/** A performer chosen in the wizard — an existing profile, a contact, or a plain
 * draft name. Persisted to `extras.performers`; materialized into participants
 * (profile → real; contact/draft → off-platform stub) after the event exists. */
interface WizardPerformer {
  id: string;
  name: string;
  source: "profile" | "contact" | "draft";
  profileId?: string;
  slug?: string;
  contactId?: string;
  email?: string;
}

const SOURCE_LABEL: Record<WizardPerformer["source"], string> = {
  profile: "Performer",
  contact: "Contact",
  draft: "Draft",
};

/**
 * The Create-Event wizard (Your Role → Event Details → Deal Structure), matching
 * the design export. The "Your Role" step lists the operator profiles the user
 * actually owns — one card each; with a single profile the step is skipped
 * entirely and we open on Event Details. Everything captured persists to the
 * real event: step fields map to columns, and role / ticketing / deal-draft to
 * `events.extras` (a passthrough jsonb). Creates the event as the chosen profile
 * (sets `X-Profile-Id`) and hands the new id back so the screen navigates in.
 */
export interface NewEventWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** `YYYY-MM-DD` the Date field starts on. Read once, as initial state: the
   * provider remounts the wizard on every open, so a later change of day always
   * arrives as a fresh mount rather than needing to be synced into the form. */
  initialDate?: string;
  /**
   * What the caller is creating. `on_hold` puts the wizard in HOLD mode — a hold
   * IS an event, so it is the same three steps plus a priority, and the result
   * really is `status = 'on_hold'` (see `./HoldPlacement`). Anything else is the
   * ordinary create, which lands on the `draft` the API defaults to.
   */
  initialStatus?: NewEventInitialStatus;
}

export type NewEventInitialStatus = "draft" | "on_hold";

type Profile = Awaited<ReturnType<typeof getApiV1Profiles>>[number];

/** Icon + human label per operator profile type (drives the role cards). */
const TYPE_META: Record<string, { label: string; icon: IconName }> = {
  venue: { label: "Venue", icon: "building" },
  promoter: { label: "Promoter", icon: "grid" },
  festival: { label: "Festival", icon: "star" },
  agent: { label: "Agent", icon: "users" },
  performer: { label: "Performer", icon: "music" },
};
function typeMeta(type: string | null): { label: string; icon: IconName } {
  const meta = type ? TYPE_META[type] : undefined;
  if (meta) return meta;
  const label = type ? type.charAt(0).toUpperCase() + type.slice(1) : "Operator";
  return { label, icon: "building" };
}

const DEAL_TYPES = [
  { value: "guarantee", label: "Guarantee" },
  { value: "door_split", label: "Door Split" },
  { value: "guarantee_vs_door", label: "Guarantee vs Door" },
  { value: "rental", label: "Rental" },
];
const RENTAL_PAID_BY = [
  { value: "promoter", label: "Promoter" },
  { value: "venue", label: "Venue" },
  { value: "performer", label: "Performer" },
];

type StepKey = "role" | "details" | "deal";
const STEP_LABEL: Record<StepKey, string> = {
  role: "Your Role",
  details: "Event Details",
  deal: "Deal Structure",
};

const labelStyle = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 6,
} as const;
const bigField = {
  ...fieldStyle,
  width: "100%",
  padding: "11px 14px",
  borderRadius: 11,
  fontSize: 14,
};

export function NewEventWizard({
  open,
  onClose,
  onCreated,
  initialDate,
  initialStatus = "draft",
}: NewEventWizardProps) {
  const toast = useToast();
  const isHold = initialStatus === "on_hold";
  const profilesQuery = useGetApiV1Profiles();
  // Only operator profiles can host events, so those are the "roles" on offer.
  const operatorProfiles = (profilesQuery.data ?? []).filter(
    (profile) => profile.kind === "operator",
  );
  // A single profile means there's nothing to choose — skip the role step.
  const showRoleStep = operatorProfiles.length > 1;
  const stepKeys: readonly StepKey[] = showRoleStep
    ? ["role", "details", "deal"]
    : ["details", "deal"];

  const [stepIndex, setStepIndex] = useState(0);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [multiPerformer, setMultiPerformer] = useState(false);
  const [performers, setPerformers] = useState<WizardPerformer[]>([]);
  const [artist, setArtist] = useState("");
  const [venue, setVenue] = useState("");
  // The venue PROFILE behind the name, when one was picked rather than typed.
  // It is what carries the room's own capacity, curfew, amenities and city onto
  // the event — the venue wrote them down once, on its profile.
  const [venueProfileId, setVenueProfileId] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [date, setDate] = useState(initialDate ?? "");
  const [cap, setCap] = useState("");
  const [ticketing, setTicketing] = useState("");
  // `null` = the operator hasn't chosen, so the picker follows the acting
  // profile's country (decisions #17). Not seeded with a literal: the profile
  // isn't loaded on the first render, and a default written once would keep a
  // Stockholm venue on EUR forever after.
  const [currency, setCurrency] = useState<string | null>(null);
  const [dealType, setDealType] = useState("guarantee_vs_door");
  const [guarantee, setGuarantee] = useState("");
  const [artistSplit, setArtistSplit] = useState("70");
  const [promoterSplit, setPromoterSplit] = useState("20");
  const [venueSplit, setVenueSplit] = useState("10");
  const [venueRental, setVenueRental] = useState("");
  const [rentalPaidBy, setRentalPaidBy] = useState("promoter");

  // Declared above the early return (and above the hook below) so the hook order
  // is identical on every render — the wizard's own rule, see the Escape effect.
  const selectedProfile =
    operatorProfiles.find((profile) => profile.id === selectedProfileId) ?? operatorProfiles[0];

  // The event's base currency is a per-COUNTRY fact, read off the profile that
  // will host it (decisions #17) — so switching role on the first step moves the
  // picker with it, right up until the operator overrides it by hand.
  const homeCountry = selectedProfile?.location?.country ?? null;
  const currencyOptions = currencyOptionsForCountry(homeCountry);
  const effectiveCurrency = currency ?? defaultCurrencyForCountry(homeCountry);

  // Hold mode only: the queue for the chosen date, the plan's slot counter, and
  // the create → on_hold → rank sequence. Idle (`enabled: false`) otherwise, so
  // an ordinary create fires not one extra request.
  const holdPlacement = useHoldPlacement({
    enabled: open && isHold,
    eventDate: date,
    hostProfileId: selectedProfile?.id,
  });

  // The chosen venue's own record of itself. Offered ONLY into fields the
  // operator has left blank, and offered into the VISIBLE form rather than
  // written behind their back — so a capacity they disagree with is one they can
  // see and change before the event exists. (The API applies the same
  // fill-a-blank rule server-side, for every other caller.)
  const venueDefaults = useEventVenuePrefill(venueProfileId);
  useEffect(() => {
    if (!venueDefaults) return;
    if (venueDefaults.city) {
      setCity((current) => (current.trim() === "" ? (venueDefaults.city ?? "") : current));
    }
    if (venueDefaults.capacity != null) {
      setCap((current) => (current.trim() === "" ? String(venueDefaults.capacity) : current));
    }
  }, [venueDefaults]);

  const selectVenueProfile = (choice: VenueChoice | null) => {
    setVenueProfileId(choice?.profileId ?? null);
    // The search row already carries the city, so the commonest suggestion lands
    // at once instead of a request later — still only into an empty field.
    if (choice?.city) {
      setCity((current) => (current.trim() === "" ? (choice.city ?? "") : current));
    }
  };

  const create = usePostApiV1Events({
    mutation: {
      onSuccess: async (event) => {
        if (!isHold) {
          toast.success(`"${event.title}" created`);
          reset();
          onCreated(event.id);
          return;
        }
        // The event exists as a draft at this point. Whatever the second step
        // does, the outcome is stated in the operator's own terms and the event
        // is opened — a half-placed hold must never end as a silent draft.
        const outcome = await holdPlacement.placeOnHold({ id: event.id, version: event.version });
        if (outcome.kind === "on_hold") {
          toast.success(`"${event.title}" is on hold — ${holdOrdinal(outcome.holdRank)} hold`);
        } else if (outcome.kind === "on_hold_without_rank") {
          toast.warning(
            `"${event.title}" is on hold, but its priority couldn't be set (${outcome.message}) — it counts as the 1st hold until you rank it.`,
            { duration: 12000 },
          );
        } else {
          toast.error(
            `"${event.title}" was created but couldn't be put on hold (${outcome.message}). It is saved as a draft — set its status to On hold when you're ready.`,
            { duration: 12000 },
          );
        }
        reset();
        onCreated(event.id);
      },
      onError: (mutationError) =>
        toast.error(
          errorMessage(
            mutationError,
            isHold ? "Couldn't place the hold." : "Couldn't create the event.",
          ),
        ),
    },
  });

  const reset = () => {
    setStepIndex(0);
    setSelectedProfileId("");
    setMultiPerformer(false);
    setPerformers([]);
    setArtist("");
    setVenue("");
    setVenueProfileId(null);
    setCity("");
    setDate("");
    setCap("");
    setTicketing("");
    setCurrency(null);
    setDealType("guarantee_vs_door");
    setGuarantee("");
    setArtistSplit("70");
    setPromoterSplit("20");
    setVenueSplit("10");
    setVenueRental("");
    setRentalPaidBy("promoter");
  };

  // Escape closes it, like any modal with `aria-modal`. Registered before the
  // early return so the hook order never changes between renders.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.stopPropagation();
        // Not `close()` — that is declared below the early return, so calling it
        // here would read as a forward reference. Same two steps.
        reset();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (!open) return null;
  // Rendered through a portal to <body>: the app's `.content__page` sets
  // `will-change: transform`, which makes it a containing block for
  // position:fixed — so an in-tree overlay would clip to the content column.

  const clampedIndex = Math.min(stepIndex, stepKeys.length - 1);
  const currentKey = stepKeys[clampedIndex];
  const isLast = clampedIndex === stepKeys.length - 1;

  const dealIsGuarantee = dealType === "guarantee";
  const splitTotal = Number(artistSplit) + Number(promoterSplit) + Number(venueSplit);
  const artistLabel = multiPerformer ? "Festival / event name" : "Artist / performer";
  // A hold is a claim on a DATE — the API pools competing holds by
  // `(event_date, venue, stage)`, so a dateless hold competes with nothing and
  // means nothing. That is why hold mode requires the date the ordinary create
  // leaves optional, and why it waits for the queue to load: a rank picked
  // before the pool is known would be a guess, and submitting it could demote
  // someone else's hold on evidence we did not have.
  const stepValid =
    currentKey === "role"
      ? Boolean(selectedProfile)
      : currentKey === "details"
        ? artist.trim() !== "" &&
          venue.trim() !== "" &&
          (!multiPerformer || performers.length > 0) &&
          (!isHold || (date !== "" && !holdPlacement.poolIsPending))
        : true;

  // Hold mode stays busy through BOTH writes (create, then the status move), so
  // the button never reads "done" while the second half is still in flight.
  const isSubmitting = create.isPending || holdPlacement.isPlacing;
  const submitLabel = isHold
    ? isSubmitting
      ? "Placing hold…"
      : "Place Hold"
    : isSubmitting
      ? "Creating…"
      : "Create Event";

  const addSelection = (selection: PerformerSelection) => {
    setPerformers((list) => {
      const duplicate = list.some((performer) =>
        selection.source === "profile"
          ? performer.profileId === selection.profileId
          : selection.source === "contact"
            ? performer.contactId === selection.contactId
            : performer.source === "draft" &&
              performer.name.toLowerCase() === selection.name.toLowerCase(),
      );
      if (duplicate) return list;
      const id = `${selection.source}-${list.length}-${Date.now()}`;
      const entry: WizardPerformer =
        selection.source === "profile"
          ? {
              id,
              name: selection.name,
              source: "profile",
              profileId: selection.profileId,
              slug: selection.slug,
            }
          : selection.source === "contact"
            ? {
                id,
                name: selection.name,
                source: "contact",
                contactId: selection.contactId,
                email: selection.email,
              }
            : { id, name: selection.name, source: "draft" };
      return [...list, entry];
    });
  };
  const removePerformer = (id: string) =>
    setPerformers((list) => list.filter((performer) => performer.id !== id));

  const close = () => {
    reset();
    onClose();
  };

  const advance = () => {
    if (!stepValid) return;
    if (isLast) submit();
    else setStepIndex((index) => index + 1);
  };

  const submit = () => {
    // Create AS the chosen profile — the api-client sends the active profile id
    // as `X-Profile-Id`, so point it at the selection before firing.
    if (selectedProfile) setActiveProfileId(selectedProfile.id);
    create.mutate({
      data: {
        title: artist.trim(),
        baseCurrency: effectiveCurrency,
        ...(date ? { eventDate: date } : {}),
        ...(venue.trim() ? { venueName: venue.trim() } : {}),
        ...(venueProfileId ? { venueProfileId } : {}),
        ...(cap && Number.isFinite(Number(cap)) ? { capacity: Number(cap) } : {}),
        extras: {
          createdAsRole: selectedProfile?.type ?? "operator",
          createdAsProfileId: selectedProfile?.id,
          multiPerformer,
          ...(multiPerformer
            ? {
                performers: performers.map((performer) => ({
                  name: performer.name,
                  source: performer.source,
                  ...(performer.profileId ? { profileId: performer.profileId } : {}),
                  ...(performer.slug ? { slug: performer.slug } : {}),
                  ...(performer.contactId ? { contactId: performer.contactId } : {}),
                  ...(performer.email ? { email: performer.email } : {}),
                })),
              }
            : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(ticketing.trim() ? { ticketing: { provider: ticketing.trim() } } : {}),
          dealDraft: {
            dealType,
            guarantee: guarantee ? Number(guarantee) : null,
            artistSplit: Number(artistSplit),
            promoterSplit: Number(promoterSplit),
            venueSplit: Number(venueSplit),
            venueRental: venueRental ? Number(venueRental) : null,
            venueRentalPaidBy: rentalPaidBy,
          },
        },
      },
    });
  };

  const overlay = (
    // biome-ignore lint/a11y/useSemanticElements: overlay modal needs a positioned backdrop div, not <dialog>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isHold ? "Place a hold" : "Create new event"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(10,6,4,.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 20px",
        overflowY: "auto",
      }}
      onMouseDown={(clickEvent) => clickEvent.target === clickEvent.currentTarget && close()}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 22,
          boxShadow: "0 30px 80px rgba(0,0,0,.4)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "22px 26px 0",
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 21,
                margin: 0,
                color: "var(--text)",
                letterSpacing: "-.02em",
              }}
            >
              {isHold ? "Place a Hold" : "Create New Event"}
            </h2>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 0" }}>
              {isHold
                ? "A hold is an event you pencil in — the act confirms or declines the date."
                : "Set up an event in three quick steps."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--muted)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <WizardStepper steps={stepKeys} current={clampedIndex} />

        <div style={{ padding: "20px 26px 4px", minHeight: 230 }}>
          {profilesQuery.isPending ? (
            <div
              style={{
                color: "var(--muted)",
                fontSize: 13,
                padding: "40px 0",
                textAlign: "center",
              }}
            >
              Loading your profiles…
            </div>
          ) : operatorProfiles.length === 0 ? (
            <div
              style={{
                color: "var(--muted)",
                fontSize: 13,
                padding: "40px 0",
                textAlign: "center",
              }}
            >
              You need an operator profile to create events.
            </div>
          ) : (
            <>
              {currentKey === "role" && (
                <RoleStep
                  profiles={operatorProfiles}
                  selectedId={selectedProfile?.id ?? ""}
                  onPick={setSelectedProfileId}
                />
              )}
              {currentKey === "details" && (
                <DetailsStep
                  multiPerformer={multiPerformer}
                  onToggleMulti={() => setMultiPerformer((value) => !value)}
                  artistLabel={artistLabel}
                  artist={artist}
                  setArtist={setArtist}
                  performers={performers}
                  contactsProfileId={selectedProfile?.id}
                  onAddPerformer={addSelection}
                  onRemovePerformer={removePerformer}
                  venue={venue}
                  setVenue={setVenue}
                  venueProfileId={venueProfileId}
                  onSelectVenueProfile={selectVenueProfile}
                  city={city}
                  setCity={setCity}
                  date={date}
                  setDate={setDate}
                  cap={cap}
                  setCap={setCap}
                  ticketing={ticketing}
                  setTicketing={setTicketing}
                  currency={effectiveCurrency}
                  currencyOptions={currencyOptions}
                  setCurrency={setCurrency}
                  holdPlacement={isHold ? holdPlacement : undefined}
                />
              )}
              {currentKey === "deal" && (
                <DealStep
                  dealType={dealType}
                  setDealType={setDealType}
                  dealIsGuarantee={dealIsGuarantee}
                  guarantee={guarantee}
                  setGuarantee={setGuarantee}
                  artistSplit={artistSplit}
                  setArtistSplit={setArtistSplit}
                  promoterSplit={promoterSplit}
                  setPromoterSplit={setPromoterSplit}
                  venueSplit={venueSplit}
                  setVenueSplit={setVenueSplit}
                  splitTotal={splitTotal}
                  venueRental={venueRental}
                  setVenueRental={setVenueRental}
                  rentalPaidBy={rentalPaidBy}
                  setRentalPaidBy={setRentalPaidBy}
                />
              )}
            </>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 26px 24px",
            borderTop: "1px solid var(--border)",
            marginTop: 8,
          }}
        >
          {clampedIndex > 0 ? (
            <button
              type="button"
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              style={footerGhost}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={close} style={footerGhost}>
              Cancel
            </button>
            <GradientButton
              onClick={advance}
              disabled={
                !stepValid ||
                create.isPending ||
                holdPlacement.isPlacing ||
                operatorProfiles.length === 0
              }
              style={{ padding: "11px 20px", borderRadius: 11, fontSize: 13.5 }}
            >
              {isLast ? submitLabel : "Continue"}
            </GradientButton>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(overlay, document.body);
}

const footerGhost = {
  padding: "11px 18px",
  borderRadius: 11,
  border: "1px solid var(--border)",
  background: "var(--button-surface)",
  color: "var(--muted)",
  fontSize: 13.5,
  fontWeight: 500,
  cursor: "pointer",
} as const;

function WizardStepper({ steps, current }: { steps: readonly StepKey[]; current: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "22px 26px 4px" }}>
      {steps.map((key, index) => {
        const active = index === current;
        const done = index < current;
        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              flex: index === steps.length - 1 ? "0 0 auto" : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: active || done ? "#fff" : "var(--dim)",
                  background:
                    active || done ? "linear-gradient(135deg,#EE5746,#F4A046)" : "var(--elevated)",
                  border: active || done ? "none" : "1px solid var(--border)",
                }}
              >
                {index + 1}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text)" : "var(--muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {STEP_LABEL[key]}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span style={{ flex: 1, height: 1, margin: "0 14px", background: "var(--border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoleStep({
  profiles,
  selectedId,
  onPick,
}: {
  profiles: Profile[];
  selectedId: string;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--dim)",
          marginBottom: 14,
        }}
      >
        Which profile are you creating this event as?
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {profiles.map((profile) => {
          const active = selectedId === profile.id;
          const meta = typeMeta(profile.type);
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onPick(profile.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                textAlign: "left",
                padding: 14,
                borderRadius: 13,
                cursor: "pointer",
                border: active ? "1px solid #EE5746" : "1px solid var(--border)",
                background: active ? "color-mix(in srgb,#EE5746 8%,transparent)" : "var(--card)",
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  borderRadius: 11,
                  display: "grid",
                  placeItems: "center",
                  background: active
                    ? "color-mix(in srgb,#EE5746 16%,transparent)"
                    : "var(--elevated)",
                  color: active ? "#EE5746" : "var(--muted)",
                }}
              >
                <Icon name={meta.icon} size={20} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{ display: "block", fontWeight: 600, fontSize: 14, color: "var(--text)" }}
                >
                  {profile.name}
                </span>
                <span
                  style={{
                    display: "block",
                    color: "var(--muted)",
                    fontSize: 11.5,
                    marginTop: 2,
                    lineHeight: 1.35,
                  }}
                >
                  {meta.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function DetailsStep(props: {
  multiPerformer: boolean;
  onToggleMulti: () => void;
  artistLabel: string;
  artist: string;
  setArtist: (v: string) => void;
  performers: WizardPerformer[];
  contactsProfileId?: string;
  onAddPerformer: (selection: PerformerSelection) => void;
  onRemovePerformer: (id: string) => void;
  venue: string;
  setVenue: (v: string) => void;
  venueProfileId: string | null;
  onSelectVenueProfile: (choice: VenueChoice | null) => void;
  city: string;
  setCity: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  cap: string;
  setCap: (v: string) => void;
  ticketing: string;
  setTicketing: (v: string) => void;
  currency: string;
  /** Interpretable currencies, the host country's own one first (see lib/currency). */
  currencyOptions: string[];
  setCurrency: (v: string) => void;
  /** Present only in hold mode — the queue for the date and the plan's truth. */
  holdPlacement?: HoldPlacement;
}) {
  const dateFieldId = useId();
  const venueFieldId = useId();
  const isHold = Boolean(props.holdPlacement);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          border: "1px solid var(--border)",
          borderRadius: 11,
          background: "var(--elevated)",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Multi-performer event
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Festival or event with multiple artists
          </div>
        </div>
        <MiniToggle checked={props.multiPerformer} onChange={props.onToggleMulti} />
      </div>

      <label>
        <span style={labelStyle}>{props.artistLabel} *</span>
        <input
          value={props.artist}
          onChange={(e) => props.setArtist(e.target.value)}
          placeholder={props.multiPerformer ? "e.g. Nordic Synth Festival" : "e.g. Nils Frahm"}
          style={bigField}
        />
      </label>

      {props.multiPerformer && (
        <div>
          <span style={labelStyle}>Performers *</span>
          <PerformerSearch
            contactsProfileId={props.contactsProfileId}
            onSelect={props.onAddPerformer}
          />
          {props.performers.length === 0 ? (
            <div style={{ color: "var(--dim)", fontSize: 12, marginTop: 10 }}>
              Add at least one performer.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {props.performers.map((performer) => (
                <div
                  key={performer.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: 11,
                    padding: "10px 14px",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, color: "var(--text)", fontSize: 14 }}>
                    {performer.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9.5,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {SOURCE_LABEL[performer.source]}
                  </span>
                  <GlyphButton
                    ariaLabel={`Remove ${performer.name}`}
                    onClick={() => props.onRemovePerformer(performer.id)}
                  >
                    <XIcon size={15} />
                  </GlyphButton>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* `htmlFor` rather than a wrapping label: the input now lives inside
            `EventVenuePicker`, and a label that wraps a component cannot reach
            the control it is meant to name. */}
        <div>
          <label htmlFor={venueFieldId} style={labelStyle}>
            Venue *
          </label>
          <EventVenuePicker
            inputId={venueFieldId}
            value={props.venue}
            onChangeText={props.setVenue}
            onSelectProfile={props.onSelectVenueProfile}
            selectedProfileId={props.venueProfileId}
            inputStyle={bigField}
          />
        </div>
        <label>
          <span style={labelStyle}>City</span>
          <input
            value={props.city}
            onChange={(e) => props.setCity(e.target.value)}
            placeholder="e.g. Berlin"
            style={bigField}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* The one field here that is not a bare <input>: its calendar is the
            app's own popover, not the browser's. `bigField` keeps the box
            identical to its neighbours, and the label is wired by `htmlFor`
            rather than by wrapping, so the popover's trigger button never sits
            inside a <label> that could forward its click to the input. */}
        <div>
          <label htmlFor={dateFieldId} style={labelStyle}>
            {isHold ? "Date *" : "Date"}
          </label>
          <DateTimeField
            id={dateFieldId}
            type="date"
            value={props.date}
            onChange={(e) => props.setDate(e.target.value)}
            style={bigField}
          />
        </div>
        <label>
          <span style={labelStyle}>Capacity</span>
          <input
            type="number"
            value={props.cap}
            onChange={(e) => props.setCap(e.target.value)}
            placeholder="1500"
            style={{ ...bigField, fontFamily: "var(--font-mono)" }}
          />
        </label>
      </div>

      {props.holdPlacement && (
        <HoldPriorityField placement={props.holdPlacement} eventDate={props.date} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label>
          <span style={labelStyle}>Ticketing provider</span>
          <input
            value={props.ticketing}
            onChange={(e) => props.setTicketing(e.target.value)}
            placeholder="e.g. DICE, Eventbrite"
            style={bigField}
          />
        </label>
        <div>
          <span style={labelStyle}>Currency</span>
          <Select
            value={props.currency}
            onChange={props.setCurrency}
            options={props.currencyOptions}
          />
        </div>
      </div>
    </div>
  );
}

function DealStep(props: {
  dealType: string;
  setDealType: (v: string) => void;
  dealIsGuarantee: boolean;
  guarantee: string;
  setGuarantee: (v: string) => void;
  artistSplit: string;
  setArtistSplit: (v: string) => void;
  promoterSplit: string;
  setPromoterSplit: (v: string) => void;
  venueSplit: string;
  setVenueSplit: (v: string) => void;
  splitTotal: number;
  venueRental: string;
  setVenueRental: (v: string) => void;
  rentalPaidBy: string;
  setRentalPaidBy: (v: string) => void;
}) {
  const splitField = {
    ...fieldStyle,
    width: "100%",
    textAlign: "center" as const,
    fontFamily: "var(--font-mono)",
    opacity: props.dealIsGuarantee ? 0.5 : 1,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      <div>
        <span style={labelStyle}>Deal type</span>
        <Select value={props.dealType} onChange={props.setDealType} options={DEAL_TYPES} />
      </div>

      <label>
        <span style={labelStyle}>Performer guarantee</span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid var(--border)",
            background: "var(--elevated)",
            borderRadius: 11,
            padding: "0 14px",
          }}
        >
          <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>€</span>
          <input
            type="number"
            value={props.guarantee}
            onChange={(e) => props.setGuarantee(e.target.value)}
            placeholder="0"
            style={{
              flex: 1,
              border: 0,
              background: "transparent",
              color: "var(--text)",
              fontSize: 14,
              padding: "11px 8px",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
        </div>
      </label>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span style={{ ...labelStyle, marginBottom: 0 }}>Revenue split %</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: props.splitTotal === 100 ? "#6FC97A" : "#F4A046",
            }}
          >
            Total {props.splitTotal}%
          </span>
        </div>
        {props.dealIsGuarantee && (
          <div
            style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, fontStyle: "italic" }}
          >
            Revenue split is not applicable for Guarantee deals.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label>
            <span
              style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}
            >
              Performer
            </span>
            <input
              type="number"
              value={props.artistSplit}
              disabled={props.dealIsGuarantee}
              onChange={(e) => props.setArtistSplit(e.target.value)}
              style={splitField}
            />
          </label>
          <label>
            <span
              style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}
            >
              Promoter
            </span>
            <input
              type="number"
              value={props.promoterSplit}
              disabled={props.dealIsGuarantee}
              onChange={(e) => props.setPromoterSplit(e.target.value)}
              style={splitField}
            />
          </label>
          <label>
            <span
              style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}
            >
              Venue
            </span>
            <input
              type="number"
              value={props.venueSplit}
              disabled={props.dealIsGuarantee}
              onChange={(e) => props.setVenueSplit(e.target.value)}
              style={splitField}
            />
          </label>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <label>
          <span style={labelStyle}>Venue rental</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid var(--border)",
              background: "var(--elevated)",
              borderRadius: 11,
              padding: "0 14px",
            }}
          >
            <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>€</span>
            <input
              type="number"
              value={props.venueRental}
              onChange={(e) => props.setVenueRental(e.target.value)}
              placeholder="0"
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                background: "transparent",
                color: "var(--text)",
                fontSize: 14,
                padding: "11px 8px",
                outline: "none",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        </label>
        <div>
          <span style={labelStyle}>Rental paid by</span>
          <Select
            value={props.rentalPaidBy}
            onChange={props.setRentalPaidBy}
            options={RENTAL_PAID_BY}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "color-mix(in srgb,#6FC97A 10%,transparent)",
          border: "1px solid color-mix(in srgb,#6FC97A 26%,transparent)",
          borderRadius: 11,
          padding: "11px 14px",
          color: "#5aa568",
          fontSize: 12.5,
        }}
      >
        <Icon name="check" size={15} />
        Creating this event also sets up its settlement once the deal is confirmed.
      </div>
    </div>
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: 0,
        cursor: "pointer",
        padding: 0,
        position: "relative",
        background: checked ? "linear-gradient(135deg,#EE5746,#F4A046)" : "var(--border-strong)",
        transition: "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
        }}
      />
    </button>
  );
}
