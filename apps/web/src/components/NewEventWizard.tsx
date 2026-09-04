import {
  type getApiV1Profiles,
  useGetApiV1Profiles,
  useGetApiV1ProfilesId,
  usePostApiV1Events,
} from "@showme/api-client";
import { Icon, type IconName, Select, useToast } from "@showme/design-system";
import {
  DEAL_STRUCTURE_OPTIONS,
  type DealDraft,
  type DealStructure,
  amenityLabel,
  createDealPayload,
  currencyOptionsForCountry,
  dealDraftProblems,
  dealTypeLabel,
  defaultCurrencyForCountry,
  profileTypeLabel,
  structureNeedsGuarantee,
  structureNeedsSplit,
} from "@showme/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDateConflicts } from "../hooks/useDateConflicts";
import { useDealAutoSend } from "../hooks/useDealAutoSend";
import { setActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { DateTimeField } from "./DateTimeField";
import { EventRoomPicker } from "./EventRoomPicker";
import { EventVenuePicker, type VenueChoice } from "./EventVenuePicker";
import {
  type HoldPlacement,
  HoldPriorityField,
  holdOrdinal,
  useHoldPlacement,
} from "./HoldPlacement";
import { PerformerSearch, type PerformerSelection } from "./PerformerSearch";
import { GlyphButton, GradientButton, XIcon, fieldStyle } from "./eventUi";
import { suggestedDealName } from "./useDealComposer";
import { useEventVenuePrefill } from "./useEventVenuePrefill";

/** A performer chosen in the wizard — an existing profile, a contact, or a plain
 * draft name. A PROFILE becomes a real `event_participants` row when the deal
 * step names it as a party (`POST /events` writes both in one transaction); a
 * contact or a typed draft is recorded in `extras.performers` and joined later,
 * because neither is yet somebody the settlement can pay. */
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
 * entirely and we open on Event Details (which is why the header counts the
 * steps rather than claiming three).
 *
 * Everything captured persists to the real event: step fields map to columns,
 * role / ticketing / city to `events.extras` (a passthrough jsonb), and the deal
 * step to REAL `deals` + `deal_parties` rows written in the same transaction as
 * the event. It used to go to `extras.dealDraft`, which nothing read — the
 * operator stated terms and the app threw them away (ClickUp 86cbaxu52).
 *
 * That deal then SENDS ITSELF (86cbaxv2a) — the operator states the terms once
 * and the other parties are asked to confirm, with no second trip to the Deals
 * tab. `useDealAutoSend` owns the few seconds of Undo in front of the send, and
 * the reasoning for putting the window there rather than behind it.
 *
 * Creates the event as the chosen profile (sets `X-Profile-Id`) and hands the
 * new id back so the screen navigates in.
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
  // Not a local capitalise: a multi-word key such as `dance_company` came out of
  // that as "Dance_company". `profileTypeLabel` knows the vocabulary and
  // de-slugifies anything it does not.
  return { label: profileTypeLabel(type) || "Operator", icon: "building" };
}

/**
 * The shapes the settlement engine can actually reconcile — read off the closed
 * set in `@showme/shared/deal-terms`, never re-typed here. The paper-only option
 * is left out: this step exists to state figures, and an agreement with none is
 * composed on the event's own Agreement tab where its body text can be written.
 */
const DEAL_STRUCTURES = DEAL_STRUCTURE_OPTIONS.filter(
  (option): option is typeof option & { value: DealStructure } => option.value !== null,
).map((option) => ({ value: option.value, label: option.label }));

/**
 * The agreement the deal step states, in the vocabulary the engine settles.
 *
 * `deal_parties` is 1..N and kind-agnostic, so the two ends are named by what
 * they DO — not by "artist / promoter / venue", the fixed vocabulary this
 * rebuild deleted (CLAUDE.md on `settlementParties.ts`). The host FUNDS a
 * booking and IS PAID for a rental, which is why `rental` is the one structure
 * that turns the two roles around.
 *
 * Every party is named by PROFILE id: participants do not exist until the event
 * does, and `POST /events` resolves each profile to the participant row it
 * creates for it in the same transaction.
 */
function stateDeal(input: {
  host: { profileId: string; name: string };
  performer: { profileId: string; name: string };
  structure: DealStructure;
  currency: string;
  guaranteeAmount: string;
  splitPercent: string;
}): DealDraft {
  const hostIsPaid = input.structure === "rental";
  const parties: DealDraft["parties"] = [
    {
      key: "host",
      participantId: input.host.profileId,
      roleInDeal: hostIsPaid ? "payee" : "payer",
      sharePercent: "",
    },
    {
      key: "performer",
      participantId: input.performer.profileId,
      roleInDeal: hostIsPaid ? "payer" : "payee",
      sharePercent: "",
    },
  ];
  return {
    // "Deal naming uses the name of the person or entity on the agreement"
    // (2026-08 settlements meeting) — the same helper the composer names by.
    name: suggestedDealName(parties, [
      { id: input.host.profileId, label: input.host.name },
      { id: input.performer.profileId, label: input.performer.name },
    ]),
    type: hostIsPaid ? "rental" : "performance",
    structure: input.structure,
    currency: input.currency,
    guaranteeAmount: structureNeedsGuarantee(input.structure) ? input.guaranteeAmount : "",
    splitPercent: structureNeedsSplit(input.structure) ? input.splitPercent : "",
    // Neither is asked for here: an advance is a payment plan and a cost split
    // starts empty by decision (#16.3). Both are set on the event's Deals tab.
    advanceAmount: "",
    paymentTiming: "at_settlement",
    parties,
  };
}

/**
 * What the chosen venue is about to lend this show, in plain words.
 *
 * The copy happens server-side whether or not this sentence is printed
 * (`apps/api/src/routes/events.ts`, "Venue-profile prefill"), so the point here
 * is not the mechanism — it is that a value which appears on an event out of
 * nowhere is a value nobody can explain. Naming it before the event exists is
 * cheaper than explaining it afterwards.
 *
 * It lists only what the venue ACTUALLY has: a room with no catering note must
 * not be advertised as lending one.
 */
function describeVenueCarryOver(
  details: {
    amenities?: string[];
    soundSystem?: string | null;
    curfew?: string | null;
    cateringNotes?: string | null;
    accommodationNotes?: string | null;
    artistLogisticsNotes?: string | null;
  } | null,
): string[] {
  if (!details) return [];
  const carried: string[] = [];
  const amenities = details.amenities ?? [];
  if (amenities.length > 0) {
    carried.push(amenities.map(amenityLabel).join(", "));
  }
  if (details.soundSystem?.trim()) carried.push(details.soundSystem.trim());
  if (details.curfew?.trim()) carried.push(`curfew ${details.curfew.trim()}`);
  if (details.cateringNotes?.trim()) carried.push("catering notes");
  if (details.accommodationNotes?.trim()) carried.push("accommodation notes");
  if (details.artistLogisticsNotes?.trim()) carried.push("artist load-in notes");
  return carried;
}

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
/**
 * Every two-up field row in this wizard, and `minmax(0, 1fr)` rather than `1fr`
 * on purpose. A bare `1fr` is `minmax(auto, 1fr)`: the track refuses to go below
 * its content's min-content width, and an `<input>`'s min-content is its
 * intrinsic size — the browser's own `size="20"` default, measured in whatever
 * font actually rendered. So the row had a hard floor that no `width: 100%` on
 * the field could lower, and this panel is `overflow: hidden`, so what the floor
 * produced was not a scrollbar but a field cut off at the panel's edge.
 *
 * MEASURED, because this is the bug that only CI could see. At 360px the
 * Venue/City row resolved to `204px 48px` in a 266px box — a dead-exact fit,
 * zero headroom. Re-measured with the self-hosted woff2 blocked so the fallback
 * face renders (8.2% wider on the same string), the same row resolved to
 * `211px 41px`: still 266, still fitting, but only because City had room left to
 * give up. On Ubuntu CI the same row overhung the panel by 17px and the fix
 * "make it just fit" would have been fitted to the wrong machine's font metrics.
 * `minmax(0, …)` removes the floor outright, so the row cannot overhang at any
 * font width on any machine. Above the width where the fields already clear
 * their min-content — every desktop layout — the two forms resolve identically.
 */
const TWO_COLUMNS = "minmax(0, 1fr) minmax(0, 1fr)";

const bigField = {
  ...fieldStyle,
  width: "100%",
  // 10px, not 11: 11 + 11 + the 18px line box + 2px of border is 42, which
  // OVERSHOOTS --control-height and puts these fields 2px above the Select
  // beside them on the same row. At 10 the token binds and the row lines up.
  padding: "10px 14px",
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
  const dealAutoSend = useDealAutoSend();
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
  /** The "you have unsaved work" dialog is up. See `requestClose`. */
  const [confirmingExit, setConfirmingExit] = useState(false);
  const exitTitleId = useId();
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [multiPerformer, setMultiPerformer] = useState(false);
  const [performers, setPerformers] = useState<WizardPerformer[]>([]);
  const [artist, setArtist] = useState("");
  const [venue, setVenue] = useState("");
  // The venue PROFILE behind the name, when one was picked rather than typed.
  // It is what carries the room's own capacity, curfew, amenities and city onto
  // the event — the venue wrote them down once, on its profile.
  const [venueProfileId, setVenueProfileId] = useState<string | null>(null);
  /** Which ROOM of that venue — `events.stage_id`, blank at creation until now. */
  const [stageId, setStageId] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [date, setDate] = useState(initialDate ?? "");
  const [cap, setCap] = useState("");
  const [ticketing, setTicketing] = useState("");
  // `null` = the operator hasn't chosen, so the picker follows the acting
  // profile's country (decisions #17). Not seeded with a literal: the profile
  // isn't loaded on the first render, and a default written once would keep a
  // Stockholm venue on EUR forever after.
  const [currency, setCurrency] = useState<string | null>(null);
  const [dealStructure, setDealStructure] = useState<DealStructure>("guarantee_vs_door");
  const [guarantee, setGuarantee] = useState("");
  /** The performer's share OF THE POOL, as a percent — the deal's own split. */
  const [performerSplit, setPerformerSplit] = useState("70");
  /** Which linked performer this agreement is with (the others get their own). */
  const [dealWithPerformerId, setDealWithPerformerId] = useState("");

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
  // The same venue profile, read for what it SAYS rather than for what it fills
  // in: which deal shapes it will sign, and which of its house notes are about
  // to be copied onto this show. `useEventVenuePrefill` above supplies the
  // values that land in form fields; this is the sentence printed beside them,
  // off the same cached query.
  const venueProfile = useGetApiV1ProfilesId(venueProfileId ?? "", {
    query: { enabled: Boolean(venueProfileId) },
  });
  const venueDetails = venueProfile.data?.venueDetails ?? null;
  const venueCarries = describeVenueCarryOver(venueDetails);
  const venueDealTypes = venueDetails?.dealTypes ?? [];
  /**
   * Exactly what the linked room LENT this event, so unlinking it can take back
   * its own facts and nothing else (ClickUp 86cbaxyjy).
   *
   * A ref rather than state: it records what a fill did, it never draws
   * anything, and re-rendering on it would be a render nobody asked for. The
   * writes below sit inside the state updaters because that is the only place
   * that knows whether the field was blank enough to fill — they write the same
   * value every time, so a double-invoked updater changes nothing.
   */
  const lentByVenue = useRef<{ city: string | null; capacity: string | null }>({
    city: null,
    capacity: null,
  });
  useEffect(() => {
    if (!venueDefaults) return;
    const lentCity = venueDefaults.city;
    if (lentCity) {
      setCity((current) => {
        if (current.trim() !== "") return current;
        lentByVenue.current.city = lentCity;
        return lentCity;
      });
    }
    const lentCapacity = venueDefaults.capacity;
    if (lentCapacity != null) {
      setCap((current) => {
        if (current.trim() !== "") return current;
        lentByVenue.current.capacity = String(lentCapacity);
        return String(lentCapacity);
      });
    }
  }, [venueDefaults]);

  /**
   * Choosing a room moves the capacity with it, on the same fill-a-blank terms
   * as everything else the venue lends: a figure the operator typed is theirs
   * and stands, but the building's 400 sitting under a show in the 80-capacity
   * Back Room would cap the ticket inventory and draw the break-even line for a
   * room this show is not in.
   *
   * The decision is taken OUT HERE, against this render's `cap`, rather than
   * inside a `setCap` updater. React may invoke an updater twice, and this one
   * would not survive it: the first pass moves what the venue is recorded as
   * having lent, so the second pass reads its own footprint, decides the figure
   * was the operator's, and puts 400 back. Measured live, 2026-08-27.
   */
  const selectRoom = (room: { id: string; capacity: number | null } | null) => {
    setStageId(room?.id ?? null);
    if (room?.capacity == null) return;
    if (cap.trim() !== "" && cap !== lentByVenue.current.capacity) return;
    lentByVenue.current.capacity = String(room.capacity);
    setCap(String(room.capacity));
  };

  const selectVenueProfile = (choice: VenueChoice | null) => {
    // A room belongs to ONE venue, so it cannot survive the venue changing —
    // and the API refuses the pair outright ("That room does not belong to this
    // venue"), which is a 400 nobody should have to read to understand this.
    setStageId(null);
    if (!choice) {
      // Taking the chip off gives the room its facts back. A figure the operator
      // typed over is theirs and stays — but a capacity that arrived with The
      // Lantern Hall must not still be sitting there under a different name,
      // capping the ticket inventory and drawing the break-even line for a room
      // this show is no longer in.
      const { city: lentCity, capacity: lentCapacity } = lentByVenue.current;
      setCity((current) => (lentCity !== null && current === lentCity ? "" : current));
      setCap((current) => (lentCapacity !== null && current === lentCapacity ? "" : current));
      lentByVenue.current = { city: null, capacity: null };
      setVenueProfileId(null);
      return;
    }
    setVenueProfileId(choice.profileId);
    // The search row already carries the city, so the commonest suggestion lands
    // at once instead of a request later — still only into an empty field.
    const offeredCity = choice.city;
    if (offeredCity) {
      setCity((current) => {
        if (current.trim() !== "") return current;
        lentByVenue.current.city = offeredCity;
        return offeredCity;
      });
    }
  };

  /**
   * The draft save's own mutation, deliberately separate from `create` below.
   *
   * react-query runs the hook-level and call-level callbacks BOTH, so reusing
   * `create` would fire its deal auto-send and its hold placement for a save
   * that has neither, and toast "created" over the top of "saved as a draft".
   * Two intents, two mutations.
   */
  const saveDraftMutation = usePostApiV1Events({
    mutation: {
      onSuccess: (event) => {
        toast.success(
          isHold
            ? `"${event.title}" saved as a draft. It is not on hold yet — set its status when you're ready.`
            : `"${event.title}" saved as a draft.`,
        );
        setConfirmingExit(false);
        reset();
        onCreated(event.id);
      },
      onError: (mutationError) =>
        toast.error(errorMessage(mutationError, "Couldn't save this as a draft.")),
    },
  });

  const create = usePostApiV1Events({
    mutation: {
      onSuccess: async (event, variables) => {
        // The agreement is on its way the moment the event exists — the operator
        // has nothing left to press (86cbaxv2a). It is HELD for a few seconds
        // first, and the hold is what the Undo in that toast cancels; see
        // `useDealAutoSend` for why the window sits in front of the send rather
        // than behind it. Started before the hold branch below, so a deal stated
        // while placing a hold is not waiting on the hold's own round trip.
        if (variables.data.deal) {
          dealAutoSend.sendAfterUndoWindow(event.id, dealPerformer?.name ?? "the other party");
        }
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
    setStageId(null);
    lentByVenue.current = { city: null, capacity: null };
    setCity("");
    setDate("");
    setCap("");
    setTicketing("");
    setCurrency(null);
    setDealStructure("guarantee_vs_door");
    setGuarantee("");
    setPerformerSplit("70");
    setDealWithPerformerId("");
  };

  // Escape closes it, like any modal with `aria-modal`. Registered before the
  // early return so the hook order never changes between renders.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.stopPropagation();
      // Escape used to `reset()` immediately, which destroyed the form just as
      // surely as the backdrop did — the same bug through a different gesture.
      // It now goes through the same guard.
      //
      // With the confirm already up, Escape dismisses THAT and leaves the wizard
      // standing: the reader asked to back out of the question, not to answer it
      // with the destructive option.
      if (confirmingExit) {
        setConfirmingExit(false);
        return;
      }
      if (isDirty) {
        setConfirmingExit(true);
        return;
      }
      reset();
      onClose();
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

  const artistLabel = multiPerformer ? "Festival / event name" : "Artist / performer";

  // The agreement can only be stated once the wizard knows WHO it is with. That
  // is a linked performer profile: a typed name is nobody the settlement can
  // pay, and minting a profile for someone who never asked for one is not a
  // decision this wizard takes on its own (old-app-analysis-flows-creation, Q5).
  const linkedPerformers = performers.filter(
    (performer): performer is WizardPerformer & { profileId: string } =>
      Boolean(performer.profileId),
  );
  const dealPerformer =
    linkedPerformers.find((performer) => performer.profileId === dealWithPerformerId) ??
    linkedPerformers[0];
  const dealDraft =
    dealPerformer && selectedProfile
      ? stateDeal({
          host: { profileId: selectedProfile.id, name: selectedProfile.name },
          performer: { profileId: dealPerformer.profileId, name: dealPerformer.name },
          structure: dealStructure,
          currency: effectiveCurrency,
          guaranteeAmount: guarantee,
          splitPercent: performerSplit,
        })
      : null;
  // The composer's own validator, unchanged: a draft it refuses is one the
  // engine would settle as nothing, so the wizard refuses it here rather than
  // sending it and reading back a 400.
  const dealProblems = dealDraft ? dealDraftProblems(dealDraft) : [];
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
        : dealProblems.length === 0;

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
      // One act unless this is a multi-performer bill: a single-performer event
      // has exactly one, and choosing again is correcting the choice.
      return multiPerformer ? [...list, entry] : [entry];
    });
    // The act's name is the obvious title of a single-performer show — offered
    // only into a BLANK field, the same rule the venue prefill follows, so a
    // title the operator typed is never overwritten by a later pick.
    setArtist((current) => (!multiPerformer && current.trim() === "" ? selection.name : current));
  };
  const removePerformer = (id: string) =>
    setPerformers((list) => list.filter((performer) => performer.id !== id));

  const close = () => {
    reset();
    onClose();
  };

  /**
   * HAS ANYTHING BEEN ENTERED THAT CLOSING WOULD DESTROY?
   *
   * Compared against what the wizard OPENS with, not against empty: `date` is
   * seeded when the wizard is opened from a calendar cell, and the role step is
   * skipped (pre-selecting the profile) for an operator with one profile. Neither
   * is the operator's typing, and treating them as such would make the confirm
   * fire on a wizard nobody had touched — which teaches people to click through
   * it, and then it protects nothing.
   */
  const isDirty =
    stepIndex > 0 ||
    artist.trim() !== "" ||
    venue.trim() !== "" ||
    city.trim() !== "" ||
    cap.trim() !== "" ||
    ticketing.trim() !== "" ||
    guarantee.trim() !== "" ||
    performers.length > 0 ||
    multiPerformer ||
    venueProfileId !== null ||
    stageId !== null ||
    currency !== null ||
    dealWithPerformerId !== "" ||
    performerSplit !== "70" ||
    dealStructure !== "guarantee_vs_door" ||
    date !== (initialDate ?? "");

  /**
   * The way OUT of the wizard, for every gesture that is not the finish button:
   * the backdrop, the X, Cancel, and Escape.
   *
   * Until 2026-09-04 all four ran `reset()` immediately. Clicking a millimetre
   * outside the panel discarded everything typed, with no warning and no way
   * back — reported twice (ClickUp 123qy9rnfyw, *"We had this issue before"*).
   * An empty wizard still closes instantly; there is nothing to protect and a
   * dialog would just be in the way.
   */
  const requestClose = () => {
    if (isDirty) {
      setConfirmingExit(true);
      return;
    }
    close();
  };

  /**
   * "Save draft" — create the event NOW with whatever has been filled in, and
   * open it.
   *
   * Ran asked for this alongside Leave and Continue, and it is the option that
   * makes the other two safe: without it, "are you sure?" only offers a choice
   * between losing the work and not being allowed to leave.
   *
   * It writes a real event at `draft`, which is the API's default status — the
   * same state the wizard's own finish button lands on. The AGREEMENT is left
   * behind on purpose: a half-stated deal is not a deal, and writing one from an
   * incomplete step would put figures on a settlement nobody agreed. The deal
   * step is still there when they come back to the event.
   */
  const saveDraft = () => {
    if (selectedProfile) setActiveProfileId(selectedProfile.id);
    saveDraftMutation.mutate({ data: eventPayload() });
  };

  const advance = () => {
    if (!stepValid) return;
    if (isLast) submit();
    else setStepIndex((index) => index + 1);
  };

  /**
   * The event itself, without the agreement — everything the wizard has been
   * told about WHAT is happening and WHERE.
   *
   * Split out of `submit` so "Save draft" can send exactly the same event with
   * exactly the same shape. A draft that recorded a subtly different event from
   * the one the finish button would have created is worse than no draft at all:
   * the operator would come back to a record they did not make.
   *
   * `title` falls back, because it is the one field the API requires and the
   * operator may be saving from step one having typed only a date. An "Untitled
   * event" they can rename beats a refusal to save what they have.
   */
  const eventPayload = () => ({
    title: artist.trim() || venue.trim() || (date ? `Event on ${date}` : "Untitled event"),
    baseCurrency: effectiveCurrency,
    ...(date ? { eventDate: date } : {}),
    ...(venue.trim() ? { venueName: venue.trim() } : {}),
    ...(venueProfileId ? { venueProfileId } : {}),
    ...(stageId ? { stageId } : {}),
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
    },
  });

  const submit = () => {
    // Create AS the chosen profile — the api-client sends the active profile id
    // as `X-Profile-Id`, so point it at the selection before firing.
    if (selectedProfile) setActiveProfileId(selectedProfile.id);
    // The stated agreement, and the party it is with. Both travel WITH the
    // create so the deal is written in the same transaction as the event —
    // until 2026-08-27 this step's figures went into `extras.dealDraft`, which
    // nothing read, and `select count(*) from deals` answered 0 (86cbaxu52).
    const statedDeal = dealDraft && dealProblems.length === 0 ? createDealPayload(dealDraft) : null;
    const withDeal =
      statedDeal && dealPerformer
        ? {
            participants: [{ profileId: dealPerformer.profileId, role: "performer" as const }],
            deal: {
              ...statedDeal,
              // The parties are named by PROFILE: no participant row exists
              // until this request creates one, and the API resolves each
              // profile to the row it makes for it.
              parties: statedDeal.parties.map(({ participantId, ...line }) => ({
                ...line,
                profileId: participantId,
              })),
            },
          }
        : {};
    create.mutate({
      data: {
        ...eventPayload(),
        // The finish button states the title the operator typed, not the
        // fallback — `eventPayload` only invents one for a half-filled draft.
        title: artist.trim(),
        ...withDeal,
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
        background: "color-mix(in srgb, var(--ink-1000) 55%, transparent)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 20px",
        overflowY: "auto",
      }}
      onMouseDown={(clickEvent) => clickEvent.target === clickEvent.currentTarget && requestClose()}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 22,
          boxShadow: "var(--shadow-lg)",
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
                : // The count follows the stepper, which is two steps for an
                  // operator with one profile and three for one who has to pick
                  // which of theirs is hosting. The copy said "three" for
                  // everyone, and a stepper showing two made a liar of it.
                  `Set up an event in ${stepKeys.length === 3 ? "three" : "two"} quick steps.`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            // Touch: 34px square. The wizard draws its own panel rather than
            // using the shared `Modal` shell, so it missed the overlay that
            // shell's close button already carries. It grows instead of taking
            // one: it sits in the panel's top-right corner, where half of a
            // 44px halo would hang outside the panel entirely.
            className="touch-target"
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
                  stageId={stageId}
                  onSelectRoom={selectRoom}
                  venueCarries={venueCarries}
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
                  structure={dealStructure}
                  setStructure={setDealStructure}
                  guarantee={guarantee}
                  setGuarantee={setGuarantee}
                  performerSplit={performerSplit}
                  setPerformerSplit={setPerformerSplit}
                  currency={effectiveCurrency}
                  hostName={selectedProfile?.name ?? ""}
                  performers={linkedPerformers}
                  dealPerformerId={dealPerformer?.profileId ?? ""}
                  setDealPerformerId={setDealWithPerformerId}
                  venueName={venue}
                  venueDealTypes={venueDealTypes}
                  problems={dealProblems}
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
            <button type="button" onClick={requestClose} style={footerGhost}>
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

      {/* The unsaved-work question, drawn INSIDE the wizard's own backdrop and
          above its panel. Its own scrim rather than a second portal: the wizard
          is already the top layer, and a nested portal would let a click land on
          the wizard behind the question it is asking. */}
      {confirmingExit && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={exitTitleId}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 110,
            background: "color-mix(in srgb, var(--ink-1000) 62%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          // Clicking outside the QUESTION is the least destructive answer, not
          // the most: it puts the reader back where they were. A confirm whose
          // backdrop discards the work would be the original bug wearing a
          // dialog.
          onMouseDown={(clickEvent) =>
            clickEvent.target === clickEvent.currentTarget && setConfirmingExit(false)
          }
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: "22px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <h2 id={exitTitleId} style={{ margin: 0, fontSize: 16.5, fontWeight: 640 }}>
              {isHold ? "Leave without placing this hold?" : "Leave without creating this event?"}
            </h2>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
              Everything you have filled in will be lost. You can save it as a draft instead and
              finish it later from the event.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {/* Continue is FIRST and is the default action — the reader almost
                  certainly clicked outside by accident, and the safe answer
                  should be the one under their hand. */}
              <GradientButton
                onClick={() => setConfirmingExit(false)}
                style={{ padding: "10px 18px", borderRadius: 11, fontSize: 13.5 }}
              >
                Keep editing
              </GradientButton>
              <button
                type="button"
                onClick={saveDraft}
                disabled={saveDraftMutation.isPending}
                style={footerGhost}
              >
                {saveDraftMutation.isPending ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={close}
                style={{ ...footerGhost, color: "var(--brand-red)" }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
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
              // A flex item is `min-width: auto` by default, which floors this
              // step at the width of its own label. Three nowrap labels, three
              // numbered circles and two connectors then added up to more than a
              // 318px panel and the last step was clipped away. Zero lets the
              // rail give ground; the circle below keeps its size explicitly.
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  // The one part of a step that must not shrink: a squashed
                  // circle is a visibly broken control, and 28px is the design.
                  flexShrink: 0,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: active || done ? "#fff" : "var(--dim)",
                  background:
                    active || done
                      ? "linear-gradient(135deg,var(--brand-red),var(--brand-amber))"
                      : "var(--shape-fill)",
                  border: active || done ? "none" : "1px solid var(--border)",
                }}
              >
                {index + 1}
              </span>
              {/* Was `white-space: nowrap`, which is why the rail could not
                  narrow. It wraps only where it has to — every desktop width
                  puts each label on one line exactly as before. */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text)" : "var(--muted)",
                  minWidth: 0,
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
      <div style={{ display: "grid", gridTemplateColumns: TWO_COLUMNS, gap: 10 }}>
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
                border: active ? "1px solid var(--brand-red)" : "1px solid var(--border)",
                background: active
                  ? "color-mix(in srgb,var(--brand-red) 8%,transparent)"
                  : "var(--card)",
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
                    ? "color-mix(in srgb,var(--brand-red) 16%,transparent)"
                    : "var(--shape-fill)",
                  color: active ? "var(--brand-red)" : "var(--muted)",
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
  stageId: string | null;
  onSelectRoom: (room: { id: string; capacity: number | null } | null) => void;
  /** What the chosen venue will copy onto this show, in plain words. */
  venueCarries: string[];
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

  // "Is this night already taken?" — asked live as the venue, room and date are
  // chosen, and answered only for a venue the caller runs (ClickUp 86cbceux0).
  // It WARNS; nothing here can stop the wizard advancing.
  const conflicts = useDateConflicts({
    venueProfileId: props.venueProfileId,
    date: props.date,
    stageId: props.stageId,
  });

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
          background: "var(--card)",
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

      {/* Who is actually playing — asked in BOTH modes now, because a linked
          performer PROFILE is what the deal step needs to have another party to
          agree with. Optional for a single act (a name on its own is a fine
          booking), required for a bill. */}
      <div>
        <span style={labelStyle}>
          {props.multiPerformer ? "Performers *" : "Performer profile"}
        </span>
        {(props.multiPerformer || props.performers.length === 0) && (
          <PerformerSearch
            contactsProfileId={props.contactsProfileId}
            onSelect={props.onAddPerformer}
          />
        )}
        {props.performers.length === 0 ? (
          <div style={{ color: "var(--dim)", fontSize: 12, marginTop: 10 }}>
            {props.multiPerformer
              ? "Add at least one performer."
              : "Optional — link the act's shoWMe profile and the deal you set next is recorded against them."}
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
                  background: "var(--card)",
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

      <div style={{ display: "grid", gridTemplateColumns: TWO_COLUMNS, gap: 14 }}>
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

      {/* Draws itself only when the chosen venue actually has rooms listed. */}
      <EventRoomPicker
        venueProfileId={props.venueProfileId}
        value={props.stageId}
        onChange={props.onSelectRoom}
        labelStyle={labelStyle}
      />

      {props.venueCarries.length > 0 && (
        <VenueCarryOverPreview venueName={props.venue} carries={props.venueCarries} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: TWO_COLUMNS, gap: 14 }}>
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
          {/* Under the date, not at the top of the step: it is an answer about
              THIS field, and a banner elsewhere would be read as being about the
              form. Amber rather than red — nothing is wrong, and the operator is
              allowed to proceed. */}
          {conflicts.message && (
            <output
              style={{
                display: "block",
                margin: "6px 0 0",
                fontSize: 12,
                lineHeight: 1.45,
                color: "var(--brand-amber)",
              }}
            >
              {conflicts.message}
            </output>
          )}
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

      <div style={{ display: "grid", gridTemplateColumns: TWO_COLUMNS, gap: 14 }}>
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

/**
 * "This room will also bring …" — said before the event exists, not discovered
 * afterwards. The values themselves are copied by the API; what this adds is
 * that nobody has to wonder where they came from, and the promise that they
 * stop being the venue's the moment the show is created.
 */
function VenueCarryOverPreview({ venueName, carries }: { venueName: string; carries: string[] }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "11px 14px",
        border: "1px solid var(--border)",
        borderRadius: 11,
        background: "var(--card)",
      }}
    >
      <Icon name="building" size={15} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
        {venueName || "This venue"} also brings <strong>{carries.join(" · ")}</strong> onto the
        event. They are copied once, and yours to edit or remove afterwards — changing the
        venue&rsquo;s profile later will not change this show.
      </div>
    </div>
  );
}

/**
 * The deal step — the terms, and the two parties they are between.
 *
 * It states ONE agreement: the host and one act. A bill with several acts is
 * several agreements, not one four-way split, and the event's Deals tab is where
 * the others (and any rental, commission or shared pot) are composed. What this
 * step will not do is show a figure it cannot record: with no linked performer
 * profile there is nobody to agree with, so it says so instead of collecting
 * numbers that would go nowhere.
 */
function DealStep(props: {
  structure: DealStructure;
  setStructure: (value: DealStructure) => void;
  guarantee: string;
  setGuarantee: (value: string) => void;
  performerSplit: string;
  setPerformerSplit: (value: string) => void;
  /** The event's base currency, chosen on the previous step. */
  currency: string;
  hostName: string;
  performers: { profileId: string; name: string }[];
  dealPerformerId: string;
  setDealPerformerId: (value: string) => void;
  /** The room, and the deal shapes it advertises. Shown, never applied — see below. */
  venueName: string;
  venueDealTypes: string[];
  /** What is still wrong with the terms, in the composer's own words. */
  problems: string[];
}) {
  const isRental = props.structure === "rental";
  const performer = props.performers.find(
    (candidate) => candidate.profileId === props.dealPerformerId,
  );

  if (!performer) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ ...labelStyle, marginBottom: 0 }}>Deal</div>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--card)",
            padding: "16px 18px",
            color: "var(--muted)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          A deal is an agreement <em>between parties</em>, so it needs the other side named. Link
          the act&rsquo;s shoWMe profile on the previous step and the terms you set here are
          recorded as a real deal on the event. Without one, the event is created on its own and the
          deal is composed later, from its Deals tab.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      <div>
        <span style={labelStyle}>Deal with</span>
        {props.performers.length > 1 ? (
          <Select
            value={props.dealPerformerId}
            onChange={props.setDealPerformerId}
            options={props.performers.map((candidate) => ({
              value: candidate.profileId,
              label: candidate.name,
            }))}
          />
        ) : (
          <div style={{ fontSize: 14, color: "var(--text)" }}>{performer.name}</div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          {isRental
            ? `${performer.name} pays ${props.hostName || "you"} for the room.`
            : props.hostName
              ? `${props.hostName} pays ${performer.name} under this agreement.`
              : `You pay ${performer.name} under this agreement.`}
        </div>
      </div>

      <div>
        <span style={labelStyle}>Deal structure</span>
        <Select
          value={props.structure}
          onChange={(value) => props.setStructure(value as DealStructure)}
          options={DEAL_STRUCTURES}
        />
        {/* The venue's advertised shapes are shown here and go no further. They
            are a PREFERENCE, not terms (`venue_details.deal_types`: "advertised
            preference, never terms"), and the two vocabularies are not the same
            one: the profile offers "Guarantee + Door Split" — a guarantee and a
            share on top — where the engine settles `guarantee_vs_door`, the
            GREATER of the two. Defaulting one to the other would be the app
            quietly choosing what a show settles as, on a hint the venue wrote
            for promoters to read. So it informs the operator's choice and never
            makes it. */}
        {props.venueDealTypes.length > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            {props.venueName || "This venue"} says it signs{" "}
            {props.venueDealTypes.map(dealTypeLabel).join(", ")}.
          </div>
        )}
      </div>

      {structureNeedsGuarantee(props.structure) && (
        <label>
          <span style={labelStyle}>{isRental ? "Room rental fee" : "Performer guarantee"}</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid var(--control-border)",
              background: "var(--control-surface)",
              borderRadius: 11,
              // A currency field is a control, so it wears the one control height
              // rather than whatever its inner <input> line box makes it.
              minHeight: "var(--control-height)",
              padding: "0 14px",
            }}
          >
            {/* The event's own currency, not a hardcoded euro (86cbaxz0z). The
                CODE rather than the symbol, as the deal composer does: "kr" is
                three different currencies and the wrong one is worse than none. */}
            <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {props.currency}
            </span>
            <input
              type="number"
              value={props.guarantee}
              onChange={(changeEvent) => props.setGuarantee(changeEvent.target.value)}
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
      )}

      {structureNeedsSplit(props.structure) && (
        <label>
          <span style={labelStyle}>{performer.name}&rsquo;s share of the pool</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid var(--control-border)",
              background: "var(--control-surface)",
              borderRadius: 11,
              minHeight: "var(--control-height)",
              padding: "0 14px",
            }}
          >
            <input
              type="number"
              value={props.performerSplit}
              onChange={(changeEvent) => props.setPerformerSplit(changeEvent.target.value)}
              placeholder="70"
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
            <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>%</span>
          </div>
          {/* No "promoter %" and no "venue %" beside it. The pool is revenue less
              external costs, the deals come out of it, and whatever is left IS the
              operator's — the engine pays it as the residual (settlement skill).
              A second percentage box would be the operator dividing their own
              remainder with themselves. */}
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            Of revenue less the costs paid to outside suppliers. What is left over is yours.
          </div>
        </label>
      )}

      {props.problems.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: "color-mix(in srgb,#F4A046 10%,transparent)",
            border: "1px solid color-mix(in srgb,#F4A046 26%,transparent)",
            borderRadius: 11,
            padding: "11px 14px",
            color: "#b97a2a",
            fontSize: 12.5,
          }}
        >
          {props.problems.map((problem) => (
            <span key={problem}>{problem}</span>
          ))}
        </div>
      ) : (
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
          Saved with the event as a draft deal — the settlement reads it once both sides confirm.
        </div>
      )}
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
      // Touch: 42x24, and 44 in both directions would double the height of a
      // switch that is supposed to read as a small one — the same call the
      // design system's `Toggle` makes, with the same utility. It sits alone at
      // the right end of a bordered row whose only other content is its label,
      // so the halo has nothing to steal.
      className="touch-target-overlay"
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        border: 0,
        cursor: "pointer",
        padding: 0,
        position: "relative",
        background: checked
          ? "linear-gradient(135deg,var(--brand-red),var(--brand-amber))"
          : "var(--border-strong)",
        transition: "background var(--duration-base) var(--ease-out)",
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
          transition: "left var(--duration-base) var(--ease-out)",
        }}
      />
    </button>
  );
}
