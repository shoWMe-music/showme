import {
  type getApiV1EventsId,
  type getApiV1EventsIdInvitations,
  type getApiV1EventsIdParticipants,
  type getApiV1EventsIdRiders,
  type getApiV1EventsIdSchedule,
  getGetApiV1EventsIdInvitationsQueryKey,
  getGetApiV1EventsIdQueryKey,
  useGetApiV1EventsId,
  useGetApiV1EventsIdInvitations,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdRiders,
  useGetApiV1EventsIdSchedule,
  useGetApiV1EventsIdSettlements,
  usePatchApiV1EventsId,
} from "@showme/api-client";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  type Status,
  TabPanels,
  useToast,
} from "@showme/design-system";
import { eventParticipantRoleLabel, humanizeEnumValue } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BudgetPlanner,
  type CrewMember,
  type DetailsPerformer,
  type DetailsRider,
  type DetailsScheduleEntry,
  EventDetailsTab,
  type EventExtras,
  EventHistoryTab,
  EventMessagesTab,
  EventTodoTab,
  type ScheduleEntry,
} from "../components";
import { BudgetCustomFieldModal, type CustomFieldKind } from "../components/BudgetCustomFieldModal";
import { BudgetTemplateDialogs } from "../components/BudgetTemplateDialogs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CostSplitModal } from "../components/CostSplitModal";
import { CurrencyPeekControl } from "../components/CurrencyPeek";
import { DateText } from "../components/DateText";
import { EventCancelModal } from "../components/EventCancelModal";
import { EventChangeRequestBanner } from "../components/EventChangeRequestBanner";
import { EventCollaboratorEditModal } from "../components/EventCollaboratorEditModal";
import { EventCollaboratorInviteModal } from "../components/EventCollaboratorInviteModal";
import { EventCrewPanel } from "../components/EventCrewPanel";
import { EventDealsTab } from "../components/EventDealsTab";
import { EventHoldPanel } from "../components/EventHoldPanel";
import { EventRowMenu } from "../components/EventRowMenu";
import { EventSetlistTab } from "../components/EventSetlistTab";
import { EventSettlementTab } from "../components/EventSettlementTab";
import { ProfileFace } from "../components/ProfileFace";
import { useCurrencyPreview } from "../components/SettlementCurrencyPreview";
import { ShareExportModal } from "../components/ShareExportModal";
import { budgetPlannerViewFrom, carryRevealedHeading } from "../components/budgetPlannerView";
import {
  type EventTab,
  EventTabsBar,
  Eyebrow,
  STATUS_STAGE_INDEX,
  StageRail,
} from "../components/eventUi";
import { ErrorState, LoadingState } from "../components/states";
import { useBudgetEditor } from "../components/useBudgetEditor";
import { type EventTicketTier, useBudgetSeed } from "../components/useBudgetSeed";
import { useBudgetToolbar } from "../components/useBudgetToolbar";
import { publicEventPageUrl } from "../components/useEventPublishing";
import { usePerformingRightsTerritory } from "../components/usePerformingRightsTerritory";
import { useEventChangeRequest } from "../hooks/useEventChangeRequest";
import { useEventCollaborators } from "../hooks/useEventCollaborators";
import { useEventPermissionSets } from "../hooks/useEventPermissionSets";
import { useEventRowActions } from "../hooks/useEventRowActions";
import { getActiveProfileId } from "../lib/activeProfile";
import { formatDay } from "../lib/format";
import { toMinorUnits } from "../lib/moneyUnits";
import { eventDisplayStatus } from "../lib/status";

type EventDetailData = Awaited<ReturnType<typeof getApiV1EventsId>>;
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];
type EventInvitation = Awaited<ReturnType<typeof getApiV1EventsIdInvitations>>[number];
type ScheduleItem = Awaited<ReturnType<typeof getApiV1EventsIdSchedule>>[number];
type Rider = Awaited<ReturnType<typeof getApiV1EventsIdRiders>>[number];

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** A participant's display name — real profile name, else its role tag. */
function participantName(participant: Participant): string {
  return (
    participant.name ?? participant.performerTag ?? eventParticipantRoleLabel(participant.role)
  );
}

export function EventDetail() {
  const { eventId } = useParams({ from: "/events/$eventId" });
  // Which panel a link asked for (`?tab=budget`). The initial value only — the tab
  // the reader is looking at lives in state, and `selectTab` below keeps the URL in
  // step with it WITHOUT pushing a history entry.
  const requestedTab = useSearch({ from: "/events/$eventId" }).tab;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(requestedTab ?? "details");

  /**
   * CHANGING A TAB WRITES `?tab=`, WITH `replace` (QA sweep run 5, QA5-9).
   *
   * Not writing it at all was a decision, stated here: *"the workspace still behaves as
   * one screen rather than pushing a history entry per tab"* — and the sweep's second
   * symptom, `history.back()` leaving the event, is exactly what that decision buys.
   * `replace: true` keeps every bit of it: no entry is pushed, so Back still leaves the
   * workspace.
   *
   * What it removes is the decision's one real cost. A reload landed on Event Details
   * whatever the reader was looking at, and the URL of the panel in front of them could
   * not be copied to anybody. The read path has always worked — `?tab=messages` typed by
   * hand opens the right panel — so only the write was missing.
   *
   * The DEFAULT panel writes no parameter, so the bare `/events/:id` stays bare and
   * nothing puts `?tab=details` in front of a reader who never chose it.
   */
  const selectTab = useCallback(
    (next: string) => {
      setTab(next);
      void navigate({
        to: "/events/$eventId",
        params: { eventId },
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          tab: next === "details" ? undefined : next,
        }),
        replace: true,
      });
    },
    [eventId, navigate],
  );

  /**
   * ARRIVING FROM A NOTIFICATION SHOULD LAND ON THE PANEL (ClickUp `86cbcgq5f`:
   * *"the navigation doesn't lead to the specific tab and place in the event
   * manager (including scroll)"*).
   *
   * Selecting the right tab is only half of it. The workspace opens with a
   * breadcrumb, a title, a hold panel and a status rail above the tab bar, so a
   * reader sent to the Deals panel still arrives looking at the event's name with
   * the thing they were told about somewhere below the fold. This scrolls the tab
   * bar to the top of the viewport, which puts the bar and its panel in view
   * together — the bar has to stay visible, or landing deep in a panel reads as a
   * different screen rather than a tab of this one.
   *
   * ONLY WHEN A LINK ASKED FOR A TAB. Opening the workspace normally must not
   * move the page out from under anybody, and clicking between tabs afterwards
   * must not either, which is why this keys off the initial `?tab=` rather than
   * off `tab`. `requestedTab` is a search param and does not change while the
   * screen is mounted, so this runs once.
   */
  const tabsBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!requestedTab) return;
    // After the panel has rendered — the tab bar's position depends on what is
    // above it, and the hold panel resolves asynchronously.
    const timer = window.setTimeout(() => {
      tabsBarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [requestedTab]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Which role the invite modal opens on. The header's button asks the open
  // question; the Team / Crew tab's "+ Add Member" has already answered it.
  const [inviteRole, setInviteRole] = useState<string | undefined>(undefined);
  const openInvite = (role?: string) => {
    setInviteRole(role);
    setInviteOpen(true);
  };

  const { data: event, isPending, isError, error } = useGetApiV1EventsId(eventId);
  const participants = useGetApiV1EventsIdParticipants(eventId);
  // ABOVE the loading/error guards below, because it is a hook: called after an
  // early return it would run on some renders and not others, which is the
  // "rendered more hooks than during the previous render" crash. `?? []` covers
  // the render before `event` arrives — no capabilities, so the query stays
  // disabled and asks nothing until the caller is known to hold the capability.
  const permissionSets = useEventPermissionSets(
    eventId,
    (event?.capabilities ?? []).includes("participants.manage"),
  );
  const patchEvent = usePatchApiV1EventsId({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdQueryKey(eventId) }),
    },
  });

  /**
   * An open proposal to move this booking (ClickUp 86cbcftg3). Null nearly
   * always — the banner only draws when there is a question outstanding.
   *
   * ABOVE the early returns, and it has to be: the two lines below return before
   * the rest of the component runs, so a hook placed after them is called on some
   * renders and not others. React counts hooks, not names — placing this lower
   * crashed the whole page with "Rendered more hooks than during the previous
   * render" the moment the event finished loading.
   */
  const changeRequest = useEventChangeRequest(eventId);

  const detailToast = useToast();
  const rowActions = useEventRowActions({
    onDeleted: () => navigate({ to: "/events" }),
  });

  /** The public page's address, copied without leaving the screen. */
  const copyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(publicEventPageUrl(eventId));
      detailToast.success("Link copied");
    } catch {
      // Clipboard access can be refused (permissions, an insecure origin). Say so
      // rather than failing silently — the address is also on the Event Information card.
      detailToast.error("Couldn't copy. The link is on the Event Information card.");
    }
  };

  if (isPending) return <LoadingState label="Loading event" />;
  if (isError) return <ErrorState error={error} title="Couldn't load this event" />;

  // ClickUp `123qy9rng4z`: the header chip reads "Show day" and glows for the 24h
  // of the event's own local date. The INLINE status field below deliberately does
  // not — it is an editable control, and offering a value nobody can pick (or
  // showing one that changes back to "Confirmed" the moment you open the select)
  // would read as a bug.
  const display = eventDisplayStatus(event);
  /**
   * THE EVENT'S OWN CURRENCY, and there is no picker any more.
   *
   * This screen used to carry a "Display currency" select whose only effect was
   * to change the SYMBOL — nothing on this workspace converts, so picking EUR on
   * a SEK event drew SEK figures with a euro sign (ClickUp 123qy9rnjb8).
   *
   * It was not fixed by making it convert, because on this screen it cannot be.
   * The Budget Planner is an EDITOR: `currencySymbol` is the leftIcon on the
   * money fields an operator types into. A converted input has no answer to
   * "which currency did you just type?" — the value would have to be converted
   * back at a rate that can move between render and save, and a typed figure is
   * the one thing that must survive a round trip exactly. So the honest
   * conversion of an editable money field is no conversion at all.
   *
   * What replaced it is a PEEK, on the Budget tab where the money is
   * (`CurrencyPeekControl`). Ran's rule: figures are always in the transaction
   * currency, and a selector is for checking what that comes to somewhere else —
   * so the event's currency stays on screen throughout and a converted figure is
   * marked `≈`. While peeking, the planner's money fields become readouts, which
   * is what makes the paragraph above stop being a reason not to have the
   * feature: nothing converted is ever typed into.
   */
  const currency = event.baseCurrency;
  const roster = participants.data ?? [];
  // Each of these is the capability the route behind the button actually
  // authorizes. They replace a single `canEdit = event.holdAutoPromote !==
  // undefined`, which inferred authority from the PRESENCE of an operator-only
  // field — the exact disguise `serialize/event.ts` says `capabilities[]` exists
  // to remove: it read TRUE for a host and FALSE for an agent, who nonetheless
  // holds `deal.edit` and `agreement.manage` (decisions #14). `?? []` covers an
  // API older than the field: no capabilities means no action is offered, which
  // is the safe reading.
  const capabilities = event.capabilities ?? [];
  const canEditEvent = capabilities.includes("event.edit");

  // The admin-grade permission set "Full control" grants, from the real list
  // (`GET /events/:id/permission-sets`, fetched above). It used to be scraped off
  // the HOST's participant row, because no route listed the sets — which meant the
  // app could name exactly one bundle and had to decide who held full control by
  // comparing ids against it. Two rows can carry identical capabilities, so that
  // misread the co-host (ClickUp 86cbazcc7, item 2). `useEventPermissionSets`
  // picks by what a set GRANTS, and `null` (the caller may not read the list)
  // hides the option.
  const fullControlPermissionSetId = permissionSets.fullControlSet?.id ?? null;

  const performerParty =
    roster.find((party) => party.role === "performer") ??
    roster.find((party) => party.role === "support");
  // EVERY act on the bill, not just the headliner: a support act's guarantee is
  // still a performance deal, and the Budget Planner seeds its "Performer fee"
  // from whichever of them the deal actually names as payee.
  //
  // Passed as a joined STRING rather than an array because `roster` is rebuilt
  // on every render: a fresh array would be a new dependency each time and the
  // seed downstream would never settle. The string is stable while the ids are.
  const performerIdsKey = roster
    .filter((party) => party.role === "performer" || party.role === "support")
    .map((party) => party.id)
    .join(",");
  /*
   * WHO SHARES THE RESIDUAL — the host and every co-host, for the planner's rental question
   * (decisions §25.7.1, QA sweep run 10 QA10-1). Joined as a string for the same reason
   * `performerIdsKey` is: a fresh array each render would never let the seed settle.
   */
  const operatorIdsKey = roster
    .filter((party) => party.role === "host" || party.role === "co_host")
    .map((party) => party.id)
    .join(",");
  /*
   * WHOSE BOOK the planner is showing — the acting profile's own rows (QA10-11). Without it, a room
   * hire the reader is OWED arrived as their "Venue cost" and the private book opened at a loss for
   * money coming in.
   */
  const ownIdsKey = roster
    .filter((party) => party.profileId === getActiveProfileId())
    .map((party) => party.id)
    .join(",");
  const hostParty =
    roster.find((party) => party.role === "host") ??
    roster.find((party) => party.role === "co_host");
  /*
   * NULL when no act is on the bill — never the event's own title (QA sweep run 9, QA9-15).
   *
   * The header's first chip is the slot the ACT occupies on every other event, so filling it
   * with `event.title` invented one: a night created with no PERFORMER PROFILE linked read
   * `QN QA9 Regression Night · TH The Lantern Hall`, two inches above an Event Information panel
   * correctly saying `Performer —` and a Details tab saying `No performers added yet`. One screen,
   * three answers, and the most prominent was the fabricated one.
   *
   * The chip is dropped rather than shown empty: a night with no act yet is an ordinary state —
   * a hold, a date being held open — and the two panels below already say so in words.
   */
  const performerName = performerParty ? participantName(performerParty) : null;
  const venueLabel = event.venueName ?? "Venue";
  const operatorName = hostParty ? participantName(hostParty) : "—";

  const crew: CrewMember[] = roster
    .filter((party) => party.role === "crew" || party.role === "crew_lead")
    .map((party) => {
      const name = participantName(party);
      return {
        id: party.id,
        name,
        initials: initials(name),
        avatarUrl: party.avatarUrl,
        publicSlug: party.publicSlug,
        role: eventParticipantRoleLabel(party.role),
      };
    });

  const stageIndex = STATUS_STAGE_INDEX[event.status] ?? 0;

  // The planner is operator-only — `budget.view` is a ceiling in the auth engine
  // and `GET /events/:id/budgets` 403s for everyone else, so offering the tab to a
  // performer offered a door onto an error. (design-handoff-budget-planner §Scope:
  // "the whole screen is operator-only… there is no redacted variant to design".)
  const canSeeBudget = capabilities.includes("budget.view");
  // Who may change the roster. `participants.manage` is the exact capability both
  // the PATCH and the DELETE on `/events/:id/participants/:pid` authorize.
  const canManageParticipants = capabilities.includes("participants.manage");

  /**
   * The row menu's actions, reused whole (`123qy9rng56`). `onDeleted` is the one thing
   * this screen needs that the list does not: the workspace is standing on the event it
   * just destroyed, so it has to leave rather than re-render into a wall of 404s.
   *
   * ABOVE the `isPending` / `isError` guards below, with every other hook. Written under
   * them first, which React answered with *"Rendered more hooks than during the previous
   * render"* the moment the event finished loading — the screen renders twice, and the
   * second pass reached two hooks the first had returned before. Caught by opening the
   * page; neither the typecheck nor the unit suite can see it.
   */
  const tabs: EventTab[] = [
    { key: "todo", label: "To Do" },
    ...(canSeeBudget ? [{ key: "budget", label: "Budget Planner" }] : []),
    { key: "details", label: "Event Details" },
    // One tab for every specific financial and contractual arrangement on the
    // event — agreements, what each one costs, and what the parties are given
    // (2026-08 settlements meeting, 01:53:36/01:57:22). Event Details keeps the
    // general information; the old "Agreement" tab is folded in here.
    { key: "deals", label: "Deals" },
    { key: "crew", label: "Team / Crew" },
    // The act's running order, on the show it is about — the half Ran asked for
    // on 2026-08-31: "the setlists from performers will be connected to their
    // event managers". Offered to everyone who can reach the event because the
    // tab shows three different things depending on who is reading (own set,
    // every act's set, a shared set) and only the server knows which; the panel
    // says so plainly when there is nothing for this reader. See
    // `routes/setlists.ts` for the three standings and why the operator holds one.
    { key: "setlist", label: "Setlist" },
    { key: "settlement", label: "Settlement" },
    { key: "messages", label: "Messages" },
    { key: "collaborators", label: "Collaborators" },
    { key: "history", label: "Event History" },
  ];
  // A `?tab=` the reader may not have. "Budget Planner" is drawn only for someone
  // holding `budget.view`, so a link to it followed by a performer would otherwise
  // select a panel that renders nothing at all — a blank workspace, which is worse
  // than the tab they can see.
  const activeTab = tabs.some((entry) => entry.key === tab) ? tab : "details";

  const saveExtras = (next: EventExtras) => {
    patchEvent.mutate({ id: eventId, data: { extras: next, expectedVersion: event.version } });
  };

  return (
    <>
      {/* ABOVE everything, including the breadcrumb: it is the one thing on this
          page that is a question rather than information — everything below
          describes a booking that may be about to change.

          NOT on the Messages tab, which draws its own copy next to the thread
          the negotiation is recorded in (86cbcftg3). Two identical banners on one
          screen is not twice the prompt — it reads as a rendering bug and makes
          the reader wonder whether there are two changes pending. */}
      {changeRequest.proposal && activeTab !== "messages" && (
        <EventChangeRequestBanner
          proposal={changeRequest.proposal}
          isAnswering={changeRequest.isAnswering}
          onConfirm={changeRequest.confirm}
          onDecline={changeRequest.decline}
        />
      )}
      {/* Breadcrumb + bell */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <Icon name="calendar" size={15} />
          <button
            type="button"
            onClick={() => navigate({ to: "/events" })}
            // Touch: 50x18. An overlay: the breadcrumb is a line of text and
            // growing it to 44px would set the crumb apart from the title it
            // names. The only things near it are the calendar glyph and the "/"
            // separator, neither of which is interactive.
            className="touch-target-overlay"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Events
          </button>
          <span style={{ color: "var(--dim)" }}>/</span>
          <span style={{ color: "var(--text)", fontWeight: 500 }}>{event.title}</span>
        </div>
      </div>

      {/* Title + controls */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: 26,
                letterSpacing: "-.02em",
                margin: 0,
                color: "var(--text)",
              }}
            >
              {event.title}
            </h1>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--dim)",
                letterSpacing: ".04em",
              }}
            >
              {shortCode(event.id)}
            </span>
            <Badge status={display.status} dot>
              {display.label}
            </Badge>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              color: "var(--muted)",
              fontSize: 13.5,
              marginTop: 8,
              flexWrap: "wrap",
            }}
          >
            {performerName !== null && (
              <>
                <IdentityChip
                  initials={initials(performerName)}
                  label={performerName}
                  avatarUrl={performerParty?.avatarUrl}
                  tone="brand"
                />
                {/* The separator belongs to the chip before it, or an act-less event opens with
                    a stray middot. */}
                <span style={{ color: "var(--dim)" }}>·</span>
              </>
            )}
            <IdentityChip initials={initials(venueLabel)} label={venueLabel} tone="amber" />
            <span style={{ color: "var(--dim)" }}>·</span>
            {/* The one date on this screen a reader wants to LEAVE for: it is
                the night itself, so it carries the hop to the calendar. */}
            <DateText value={event.eventDate} style={{ fontFamily: "var(--font-mono)" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {canManageParticipants && (
            <Button
              variant="secondary"
              leftIcon={<Icon name="user" size={14} />}
              onClick={() => openInvite()}
            >
              Invite Collaborator
            </Button>
          )}
          {/* This button existed and printed the page. The share API behind it
              (create · read · OTP · verify · comment) had been complete the whole
              time with no door in; this is the door, and print became a choice
              inside the dialog rather than the whole feature. (The prop that
              originally carried it lived on `EventDetailHeader`, a component
              nothing ever rendered — deleted 2026-08-31.) */}
          <Button
            variant="secondary"
            leftIcon={<Icon name="share" size={14} />}
            onClick={() => setShareOpen(true)}
          >
            Share &amp; Export
          </Button>
          {/* THE ⋮ RAN ASKED FOR (ClickUp `123qy9rng56`: *"add the three dots UI on the
              top right side of the event manager"*).
              
              It draws the SAME menu the events list row draws, from the same hook — so
              archive, cancel, delete and publish cannot mean one thing in the list and
              another here, and each is offered only to a reader who holds the capability
              for it. Two of his five entries are missing on purpose and the loop doc says
              why: Duplicate and Make recurring are features (a copy rule plus a date
              flow; a recurrence model the schema has no column for), not menu items.
              
              "Share event link" is here rather than in the shared menu because it is the
              only entry that is about this SCREEN's event rather than about a row — and
              the list has the link in its own column already. */}
          <EventRowMenu
            label={`Actions for ${event.title}`}
            items={[
              ...rowActions.menuItems({
                id: event.id,
                title: event.title,
                status: event.status,
                published: event.published,
                capabilities,
              }),
              {
                key: "share-link",
                label: "Share event link",
                onSelect: () => void copyPublicLink(),
                hint: event.published
                  ? "Copies the public page's address."
                  : "Copies the address the public page WILL have. It is not up yet.",
              },
            ]}
          />
        </div>
      </div>

      <StageRail currentIndex={stageIndex} status={event.status} />
      {/* Renders nothing unless this event is a hold AND the reader has a say in
          it, so it costs a confirmed show no space. The rank inside is
          operator-only — the serializer omits `hold_rank` for everyone else, so
          an act sees the confirm/decline half and never learns where it ranks. */}
      <EventHoldPanel eventId={eventId} />
      {/* The rail SHOWS where the booking stands. SETTING it is one of the
          event's facts, so it is a row on the Event Information card with the
          rest of them — not a second control above the tabs. */}
      <div ref={tabsBarRef}>
        <EventTabsBar tabs={tabs} value={activeTab} onChange={selectTab} />
      </div>

      {/* One wrapper for all nine panels: the content scoots in from whichever
          side the tab moved and cross-fades, instead of flipping while the tab
          bar slides. Nothing inside changes — each panel is still the same bare
          `{activeTab === "x" && <X/>}` it always was, and the panel that is not
          rendered still is not rendered. `order` is the tab array, so the
          direction always agrees with the bar (see `useTabPanelMotion`). */}
      <TabPanels activeKey={tab} order={tabs.map((entry) => entry.key)}>
        {activeTab === "todo" && <EventTodoTab eventId={eventId} />}
        {activeTab === "budget" && canSeeBudget && (
          <BudgetTab
            eventId={eventId}
            currency={currency}
            eventTitle={event.title}
            capacity={event.capacity ?? null}
            /* `extras` is operator-only and the serializer omits the KEY entirely
               for anyone else, so this is [] for a reader who may not see it —
               which is the same answer as "the event lists no tiers". */
            eventTicketTiers={(event.extras?.ticketTiers ?? []) as EventTicketTier[]}
            performerIdsKey={performerIdsKey}
            operatorIdsKey={operatorIdsKey}
            ownIdsKey={ownIdsKey}
          />
        )}
        {activeTab === "details" && (
          <DetailsTab
            event={event}
            operatorName={operatorName}
            performers={performersFrom(roster, event)}
            currency={currency}
            canEdit={canEditEvent}
            onSaveExtras={saveExtras}
          />
        )}
        {activeTab === "deals" && (
          <EventDealsTab
            eventId={eventId}
            eventTitle={event.title}
            eventDate={event.eventDate}
            eventStatusLabel={display.label}
            // `?? []` only for an API older than this field (a dev server left
            // running across the change): no capabilities means no action is
            // offered, which is the safe reading, rather than a crash.
            capabilities={event.capabilities ?? []}
            baseCurrency={event.baseCurrency}
            venueLabel={venueLabel}
            operatorName={operatorName}
            event={{
              id: event.id,
              version: event.version,
              extras: event.extras as Record<string, unknown> | null | undefined,
            }}
            canEdit={canEditEvent}
          />
        )}
        {activeTab === "crew" && (
          <EventCrewPanel
            eventId={eventId}
            crew={crew}
            canManage={
              capabilities.includes("crew.manage") ||
              capabilities.includes("participants.manage") ||
              capabilities.includes("crew.submit")
            }
            canManageCrew={(event.capabilities ?? []).includes("crew.manage")}
            onInviteCrew={() => openInvite("crew")}
          />
        )}
        {activeTab === "setlist" && <EventSetlistTab eventId={eventId} />}
        {activeTab === "settlement" && (
          <EventSettlementTab
            eventId={eventId}
            currency={event.baseCurrency}
            capabilities={event.capabilities ?? []}
          />
        )}
        {activeTab === "messages" && <MessagesTab eventId={eventId} roster={roster} />}
        {activeTab === "collaborators" && (
          <CollaboratorsTab
            eventId={eventId}
            hostProfileId={event.hostProfileId}
            roster={roster}
            isPending={participants.isPending}
            isError={participants.isError}
            error={participants.error}
            // The caller's OWN capabilities, not the operator-field tell: both
            // writes behind this tab authorize `participants.manage`, so gating
            // on anything else offers a button whose click is a 403 (or hides one
            // that would have worked — see `serialize/event.ts`).
            canManage={canManageParticipants}
            fullControlPermissionSetId={fullControlPermissionSetId}
            onInvite={canManageParticipants ? () => openInvite() : undefined}
          />
        )}
        {activeTab === "history" && <EventHistoryTab eventId={eventId} />}
      </TabPanels>

      <ShareExportModal open={shareOpen} onClose={() => setShareOpen(false)} eventId={eventId} />

      <EventCollaboratorInviteModal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          // The invitation the operator just sent is the thing they will look
          // for next, so the Collaborators tab must not still be holding the
          // list from before they opened this modal.
          queryClient.invalidateQueries({
            queryKey: getGetApiV1EventsIdInvitationsQueryKey(eventId),
          });
        }}
        eventId={eventId}
        eventTitle={event.title}
        fullControlPermissionSetId={fullControlPermissionSetId}
        initialRole={inviteRole}
      />

      {/* The ⋮'s own two dialogs (`123qy9rng56`): the delete confirmation and the cancel
          reason, both raised by the same hook the events list uses — so the wording of
          the most destructive question in the product is written once. */}
      <ConfirmDialog {...rowActions.confirmDialogProps} />
      <EventCancelModal {...rowActions.cancelModalProps} />
    </>
  );
}

function shortCode(id: string): string {
  return `EVT-${id
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 6)
    .toUpperCase()}`;
}

function IdentityChip({
  initials: text,
  label,
  avatarUrl,
  tone,
}: {
  initials: string;
  label: string;
  /** The performer's own picture when the roster carried one. The venue chip has
   * none: a venue is named on the event row, not joined as a participant, so
   * there is no profile behind it to take a face from. */
  avatarUrl?: string | null;
  tone: "brand" | "amber";
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Avatar
        src={avatarUrl ?? undefined}
        alt=""
        initials={text}
        tone={tone}
        shape="square"
        size={18}
      />
      {label}
    </span>
  );
}

/** Map the roster's performer/support participants to the Details performer rows. */
function performersFrom(roster: Participant[], event: EventDetailData): DetailsPerformer[] {
  const sub = [
    event.venueName,
    event.capacity != null ? `${event.capacity.toLocaleString("en-US")} cap.` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  return roster
    .filter((party) => party.role === "performer" || party.role === "support")
    .map((party) => {
      const name = participantName(party);
      return {
        id: party.id,
        name,
        initials: initials(name),
        avatarUrl: party.avatarUrl,
        // The act's own public page, for the "Go to profile" menu on their name
        // (ClickUp `123qy9rnfab`). Already on the wire and needing no API change:
        // `serialize/participant.ts` publishes `publicSlug` only for a PUBLISHED
        // profile — a slug without `is_public` points at a 404 — so the menu is
        // offered exactly when there is a page at the other end of it.
        slug: party.publicSlug,
        sub,
        /**
         * WHAT KIND OF ACT THIS IS (ClickUp `86cbcf6gr`).
         *
         * The act's own `details.genres`, read off their profile by the roster rather
         * than restated on the booking: a genre is the performer's word about
         * themselves, and the event is not the place it gets a second, editable copy.
         * Empty for anyone who has named none, which renders nothing at all.
         */
        genres: party.genres ?? [],
        connected: party.status === "confirmed" || party.status === "accepted",
      };
    });
}

/** Details tab: fetches schedule / deals / riders and composes the section stack. */
function DetailsTab({
  event,
  operatorName,
  performers,
  currency,
  canEdit,
  onSaveExtras,
}: {
  event: EventDetailData;
  operatorName: string;
  performers: DetailsPerformer[];
  currency: string;
  canEdit: boolean;
  onSaveExtras: (next: EventExtras) => void;
}) {
  const schedule = useGetApiV1EventsIdSchedule(event.id);
  const riders = useGetApiV1EventsIdRiders(event.id);

  const scheduleEntries: DetailsScheduleEntry[] = toScheduleEntries(schedule.data ?? []);
  const riderRows: DetailsRider[] = (riders.data ?? []).map((rider: Rider) => ({
    id: rider.id,
    name: rider.name,
    type: humanizeEnumValue(rider.type),
    description: rider.description,
    // Present only when a document is really attached — `null` is what the API
    // says about a rider that was written down instead of uploaded.
    file: rider.file
      ? {
          name: rider.file.name,
          contentType: rider.file.contentType,
          sizeBytes: rider.file.sizeBytes,
        }
      : null,
  }));

  return (
    <EventDetailsTab
      event={{
        id: event.id,
        title: event.title,
        status: event.status,
        eventDate: event.eventDate,
        doorTime: event.doorTime,
        startTime: event.startTime,
        endTime: event.endTime,
        curfew: event.curfew,
        venueName: event.venueName,
        venueProfileId: event.venueProfileId,
        // ClickUp `123qy9rnfab` — the venue's address and country, shown beside
        // its name. This mapping is field-by-field, so a new field is invisible
        // until it is named here: the API returned it and the card rendered
        // nothing, which reads exactly like a backend bug.
        venueLocation: event.venueLocation,
        venueSlug: event.venueSlug,
        hostProfileId: event.hostProfileId,
        imageUrl: event.imageUrl,
        capacity: event.capacity,
        stageId: event.stageId,
        // r3:165 — the room's NAME, so the field can say "Main Room" to a reader who
        // may not enumerate the venue's rooms. The warning above is why this line
        // exists: leaving it out is exactly the silent, backend-looking failure.
        stageName: event.stageName,
        version: event.version,
        extras: event.extras as EventExtras | null | undefined,
      }}
      operatorName={operatorName}
      performers={performers}
      riders={riderRows}
      schedule={scheduleEntries}
      currency={currency}
      canEdit={canEdit}
      onSaveExtras={onSaveExtras}
    />
  );
}

function toScheduleEntries(items: ScheduleItem[]): ScheduleEntry[] {
  return items
    .slice()
    .sort((a, b) => (a.localDateTime ?? "").localeCompare(b.localDateTime ?? ""))
    .map((item) => ({
      time: item.localDateTime
        ? new Date(item.localDateTime).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
      label: item.label,
    }));
}

/**
 * The Budget Planner tab. Reads and WRITES the event's budget lines through
 * `useBudgetEditor` — it used to edit them into local state and discard them,
 * on a budget that on a new event did not exist at all.
 */
function BudgetTab({
  eventId,
  currency,
  eventTitle,
  capacity,
  eventTicketTiers,
  performerIdsKey,
  operatorIdsKey,
  ownIdsKey,
}: {
  eventId: string;
  currency: string;
  eventTitle: string;
  capacity: number | null;
  /** `events.extras.ticketTiers` — what the operator wrote on Event Details. */
  eventTicketTiers: EventTicketTier[];
  /** Comma-joined participant ids — see `performerIdsKey` above. */
  performerIdsKey: string;
  /** Comma-joined host + co-host participant ids — who shares the residual (§25.7.1). */
  operatorIdsKey: string;
  /** Comma-joined participant ids of the ACTING profile — whose book this is (QA10-11). */
  ownIdsKey: string;
}) {
  // What the event already knows, offered into the planner's blank fields — the
  // rest of the app was holding a capacity and a guarantee while this screen
  // showed an empty sheet. A suggestion, never an overwrite (`useBudgetSeed`).
  const seedSources = useMemo(
    () => ({
      capacity,
      ticketTiers: eventTicketTiers,
      performerParticipantIds: performerIdsKey === "" ? [] : performerIdsKey.split(","),
      operatorParticipantIds: operatorIdsKey === "" ? [] : operatorIdsKey.split(","),
      ownParticipantIds: ownIdsKey === "" ? [] : ownIdsKey.split(","),
    }),
    [capacity, eventTicketTiers, performerIdsKey, operatorIdsKey, ownIdsKey],
  );
  const seed = useBudgetSeed(eventId, seedSources);
  /**
   * HAS THIS NIGHT BEEN SETTLED? — which decides whether the planner is still the
   * night's plan or a document the settlement has stopped reading.
   *
   * `ensureSettlementLines` takes the settlement's copy of the budget on the FIRST
   * compute and is sealed from it thereafter, so "any settlement has been computed"
   * is exactly "the copy is taken". The query is the same one the settlement
   * workspace uses and is served from cache when the reader has been there.
   */
  const settlementsForSeal = useGetApiV1EventsIdSettlements(eventId);
  const budgetIsSealed = (settlementsForSeal.data?.settlements ?? []).some(
    (settlement) => settlement.computed != null,
  );
  // `?budgetScope=mine` opens the private book instead of the shared ledger
  // (r3:173). Read as an INITIAL value, like `?tab=` above it; switching books
  // afterwards writes it back with `replace`, so a reload stays on the book you
  // were reading without a history entry per click.
  const budgetScope = useSearch({ from: "/events/$eventId" }).budgetScope;
  const navigateFromBudget = useNavigate();
  const editor = useBudgetEditor(eventId, seed, budgetScope);
  /**
   * The currency peek. State lives here rather than in the control so it resets
   * when the tab unmounts — a peek is a glance, not a preference, and coming back
   * to a budget you last looked at in euros and finding it still in euros is the
   * silent-relabel bug wearing a memory.
   *
   * `isExplicitChoice` is true because everything reaching this hook came from
   * the select: on a budget there is no inherited account default to fall back
   * to quietly, so a missing rate is always worth saying out loud.
   */
  const [peekCurrency, setPeekCurrency] = useState("");
  const preview = useCurrencyPreview(currency, peekCurrency, setPeekCurrency, true);
  /**
   * Convert one of the planner's MAJOR-unit draft strings for reading.
   *
   * The route is major string → minor string → convert → format, and every step
   * of it is exact except the rate multiply itself, which `convertMinorUnits`
   * owns. `toMinorUnits` shifts the decimal point TEXTUALLY for exactly this
   * reason — `Math.round(Number("4.015") * 100)` is 401, and that float was
   * losing money on this screen until it was removed.
   *
   * Undefined unless a peek is actually converting, which is what leaves the
   * fields editable the rest of the time.
   */
  /**
   * EVERY PEEKED FIGURE CARRIES `≈`, and that one character is the whole
   * safeguard rather than a decoration.
   *
   * Found by scrolling. The control says "the budget is in SEK" and sits at the
   * top of a sheet about 3 500px tall, so by the time a reader reaches the cost
   * breakdown the only thing on screen saying which currency they are looking at
   * has scrolled away — and `€7,163` on its own reads as the real figure. Ran's
   * rule is that it must be clear a number is NOT the actual currency unless it
   * is the original, and a notice you have scrolled past does not clear that bar.
   *
   * A marker that travels with the number does, at every scroll position, on all
   * forty of them, in a screenshot somebody pastes into a chat. `≈` is also
   * honest about the second thing wrong with a converted figure: it is an
   * approximation at a rate that moved this morning.
   */
  // `preview.format` carries the `≈` itself now — see `useCurrencyPreview`. Wrapping
  // it again would print two.
  const peek = preview.isPreviewing ? preview.format : undefined;
  const readMoneyAs = peek ? (draft: string) => peek(toMinorUnits(draft)) : undefined;
  // The same function in the shape `budgetPlannerViewFrom` wants: its figures are
  // already minor units, so they need no shifting.
  const peekFormat = peek;
  // Which PRO rate governs THIS show. The API resolves the show's country from
  // the venue and looks up what a platform admin configured for it; the fee
  // itself is computed here, against the live draft, because the ticket revenue
  // it is charged on changes with every keystroke.
  const performingRightsTerritory = usePerformingRightsTerritory(eventId);
  const toolbar = useBudgetToolbar(editor, eventTitle, currency);
  // Which card the "+ Add Field" modal is adding to, or null when it is closed.
  const [customFieldKind, setCustomFieldKind] = useState<CustomFieldKind>(null);
  // The cost row whose split is being written, or null when the dialog is closed.
  const [splitTargetKey, setSplitTargetKey] = useState<string | null>(null);
  // The standing cost headings asked back onto the sheet (`splitCostRows`). View
  // state, not budget state: a heading with no figure has no row to persist, so
  // there is nothing here for the editor hook to own or the API to store — the
  // moment a revealed heading is given a figure it stays by itself.
  const [revealedCostHeadings, setRevealedCostHeadings] = useState<string[]>([]);
  // Clearing a standing heading has to take back the reveal as well as the line,
  // or the row it just deleted comes straight back as a blank one nobody asked
  // for. A CUSTOM row has no heading to return to, so it only deletes.
  // Renaming a revealed heading carries the reveal to the new name — without it the
  // row left the table on the first keystroke (`carryRevealedHeading`, r3:178).
  const changeCostLabel = (key: string, label: string) => {
    const row = editor.costs.find((cost) => cost.key === key);
    if (row && !row.isCustom) {
      setRevealedCostHeadings((headings) => carryRevealedHeading(headings, row.label, label));
    }
    editor.changeCostLabel(key, label);
  };
  const removeCost = (key: string) => {
    const row = editor.costs.find((cost) => cost.key === key);
    if (row && !row.isCustom) {
      setRevealedCostHeadings((headings) => headings.filter((label) => label !== row.label));
    }
    editor.removeCost(key);
  };

  if (editor.isPending) return <LoadingState label="Loading budget" />;
  if (editor.isError) return <ErrorState error={editor.error} title="Couldn't load the budget" />;

  // Every figure on the screen, derived once. The arithmetic is `@showme/shared`'s
  // and the unit boundary is `budgetPlannerView`'s (CLAUDE.md: business logic is
  // plain, framework-agnostic TS) — this screen picks a currency and renders.
  const view = budgetPlannerViewFrom(editor, currency, performingRightsTerritory, peekFormat);
  const splitTargetRow = editor.costs.find((cost) => cost.key === splitTargetKey);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ONE ROW OF CHROME: which book you are in on the left, what currency you
          are reading it in hard right. They were stacked, which made two rows of
          controls out of two one-line questions — and the planner's own title
          under them, naming a screen the tab above already names.

          `marginLeft: auto` rather than `space-between`, because the switch is
          hidden on an event with a single budget and space-between would then
          drag the currency control to the left edge. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {editor.budgets.length > 1 && (
          <BudgetScopeSwitch
            budgets={editor.budgets}
            selectedBudgetId={editor.selectedBudgetId}
            onSelect={(budgetId) => {
              editor.selectBudget(budgetId);
              const chosen = editor.budgets.find((entry) => entry.id === budgetId);
              void navigateFromBudget({
                to: ".",
                search: (prev: { tab?: string; budgetScope?: "mine" }) => ({
                  ...prev,
                  budgetScope: chosen?.scope === "shared" ? undefined : ("mine" as const),
                }),
                replace: true,
              });
            }}
          />
        )}
        <div style={{ marginLeft: "auto" }}>
          <CurrencyPeekControl preview={preview} />
        </div>
      </div>
      {editor.readOnlyReason && <Eyebrow>{editor.readOnlyReason}</Eyebrow>}
      <BudgetPlanner
        sealedNote={
          budgetIsSealed
            ? "This night is settled. The settlement kept its own copy of this budget the first time it ran, so anything changed here now revises the plan without moving the reconciliation. A cost that arrived late belongs in the settlement's own figures, on the Financials tab."
            : undefined
        }
        currencySymbol={currencySymbol(currency)}
        readMoneyAs={readMoneyAs}
        kpis={view.kpis}
        results={view.results}
        costsIncompleteNote={view.costsIncompleteNote}
        breakEven={view.breakEven}
        revenueSources={view.revenueSources}
        costBreakdown={view.costBreakdown}
        performingRights={view.performingRights}
        dealFigureWarnings={view.dealFigureWarnings}
        participants={editor.participants}
        deals={editor.deals}
        defaultParticipantId={editor.defaultParticipantId}
        barCollectedBy={editor.barCollectedBy}
        merchCollectedBy={editor.merchCollectedBy}
        otherRevenueCollectedBy={editor.otherRevenueCollectedBy}
        onBarCollectedByChange={editor.changeBarCollectedBy}
        onMerchCollectedByChange={editor.changeMerchCollectedBy}
        onOtherRevenueCollectedByChange={editor.changeOtherRevenueCollectedBy}
        onCustomRevenueCollectedByChange={editor.changeCustomRevenueCollectedBy}
        onCostPaidByChange={editor.changeCostPaidBy}
        onCostBearingChange={editor.changeCostBearing}
        onCostDealLinkChange={editor.changeCostDealLink}
        onEditCostSplit={setSplitTargetKey}
        ticketTypes={editor.ticketTiers.map((tier) => ({
          id: tier.id,
          name: tier.name,
          price: tier.price,
          quantity: tier.quantity,
          collectedBy: tier.collectedBy,
        }))}
        ticketRevenueTotal={view.ticketRevenueTotal}
        ticketTierTotals={view.ticketTierTotals}
        ticketsPlannedLabel={view.ticketsPlannedLabel}
        ticketSplit={view.ticketSplit}
        operatorCostSplit={editor.operatorCostSplit}
        isPrivateBook={editor.isPrivateBook}
        onOperatorCostSplitChange={editor.setOperatorCostSplit}
        revenueShares={{
          rows: editor.revenueShares,
          sources: editor.revenueShareSources,
          participants: editor.participants,
          onAdd: editor.addRevenueShare,
          onChange: editor.changeRevenueShare,
          onRemove: editor.removeRevenueShare,
          readOnly: editor.readOnlyReason !== null,
        }}
        capacity={editor.capacity}
        barBasis={editor.barBasis}
        merchBasis={editor.merchBasis}
        otherRevenueBasis={editor.otherRevenueBasis}
        onBarBasisChange={editor.changeBarBasis}
        onMerchBasisChange={editor.changeMerchBasis}
        onOtherRevenueBasisChange={editor.changeOtherRevenueBasis}
        avgBarSpend={editor.averageBarSpend}
        barRevenue={view.barRevenue}
        avgMerchSpend={editor.averageMerchSpend}
        merchRevenue={view.merchRevenue}
        otherRevenue={editor.otherRevenue}
        costs={editor.costs}
        customRevenue={editor.customRevenue}
        toolbar={toolbar.actions}
        processingPercent={editor.processingPercent}
        processingFlatPerTicket={editor.processingFlatPerTicket}
        onTicketChange={editor.changeTier}
        onAddTicketType={editor.addTier}
        onRemoveTicketType={editor.removeTier}
        onCapacityChange={editor.changeCapacity}
        onAvgBarSpendChange={editor.changeAverageBarSpend}
        onAvgMerchSpendChange={editor.changeAverageMerchSpend}
        onOtherRevenueChange={editor.changeOtherRevenue}
        onCostChange={editor.changeCost}
        onCostLabelChange={changeCostLabel}
        onRemoveCost={removeCost}
        revealedCostHeadings={revealedCostHeadings}
        onRevealCost={(heading) => setRevealedCostHeadings((headings) => [...headings, heading])}
        onCustomRevenueChange={editor.changeCustomRevenue}
        onRemoveCustomRevenue={editor.removeCustomRevenue}
        onAddCustomField={setCustomFieldKind}
        onProcessingPercentChange={editor.changeProcessingPercent}
        onProcessingFlatPerTicketChange={editor.changeProcessingFlatPerTicket}
      />
      <BudgetCustomFieldModal
        kind={customFieldKind}
        currencySymbol={currencySymbol(currency)}
        participants={editor.participants}
        deductionBases={editor.deductionBases}
        onClose={() => setCustomFieldKind(null)}
        onSubmit={(kind, label, amount, bearing, paidBy, derivedFrom) =>
          kind === "cost"
            ? editor.addCustomCost(label, amount, bearing, paidBy, derivedFrom)
            : editor.addCustomRevenue(label, amount)
        }
      />
      <CostSplitModal
        target={
          splitTargetRow
            ? {
                key: splitTargetRow.key,
                label: splitTargetRow.label,
                bearing: splitTargetRow.bearing ?? { kind: "shared" },
              }
            : null
        }
        participants={editor.participants}
        onClose={() => setSplitTargetKey(null)}
        onSubmit={editor.changeCostBearing}
      />
      <BudgetTemplateDialogs toolbar={toolbar} />
    </div>
  );
}

/**
 * Which book you are looking at, shown only once there is more than one: an
 * operator's own private budget and the shared ledger a co-hosted event keeps.
 */
function BudgetScopeSwitch({
  budgets,
  selectedBudgetId,
  onSelect,
}: {
  budgets: { id: string; scope: string }[];
  selectedBudgetId: string | null;
  onSelect: (budgetId: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {budgets.map((budget) => (
        <Button
          key={budget.id}
          variant={budget.id === selectedBudgetId ? "primary" : "ghost"}
          onClick={() => onSelect(budget.id)}
        >
          {budget.scope === "shared" ? "Shared ledger" : "My budget"}
        </Button>
      ))}
    </div>
  );
}

function CollaboratorsTab({
  eventId,
  hostProfileId,
  roster,
  isPending,
  isError,
  error,
  canManage,
  fullControlPermissionSetId,
  onInvite,
}: {
  eventId: string;
  /** The event's anchor profile — its participant row is the one the API protects. */
  hostProfileId: string;
  roster: Participant[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** The caller holds `participants.manage` — only they may read the open invites,
   * edit a collaborator, or remove one. */
  canManage: boolean;
  /** The admin-grade set an edit may raise someone to; `null` hides the option. */
  fullControlPermissionSetId: string | null;
  /** Absent when this viewer may not manage the roster — then the tab is read-only. */
  onInvite?: () => void;
}) {
  // The other half of the roster: people who have been ASKED but have not
  // answered. An invitation writes no participant row until it is accepted, so
  // until this list existed an operator who had just invited someone saw a tab
  // that looked exactly as it did before they sent it. Only a roster manager
  // fetches it — it carries the invitees' email addresses.
  const invitations = useGetApiV1EventsIdInvitations(eventId, { query: { enabled: canManage } });
  const pendingInvitations = invitations.data ?? [];
  const collaborators = useEventCollaborators({
    eventId,
    hostProfileId,
    canManage,
    fullControlPermissionSetId,
  });

  if (isPending) return <LoadingState label="Loading collaborators" />;
  if (isError) return <ErrorState error={error} title="Couldn't load collaborators" />;

  // The prototype puts an "+ Invite" beside the tab heading as well as in the
  // header — the same action, reached from where you notice you need it. It opens
  // the SAME modal (one flow, one component) rather than a second divergent one.
  const heading = onInvite ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
        Profiles and parties connected to this event
      </span>
      <Button variant="primary" leftIcon={<Icon name="plus" size={14} />} onClick={onInvite}>
        Invite
      </Button>
    </div>
  ) : null;

  if (roster.length === 0 && pendingInvitations.length === 0) {
    return (
      <>
        {heading}
        <EmptyState
          icon={<Icon name="users" />}
          title="No collaborators yet"
          description="Profiles and parties connected to this event will appear here."
        />
      </>
    );
  }

  const roleTone = (role: string) => {
    if (role === "performer" || role === "support") return "brand" as const;
    if (role === "host" || role === "co_host") return "green" as const;
    if (role === "agent") return "purple" as const;
    return "blue" as const;
  };

  // Laid out like the Team screen's member grid (`routes/Team.tsx`): each person
  // is their own card on the page background, rather than rows inside one big
  // surface. A card inside a card reads as a container the eye has to discount,
  // and the two screens show the same thing — people on a roster — so they should
  // look the same. Geometry is deliberately identical: `minmax(260px, 1fr)` and a
  // 14px gutter.
  return (
    <>
      {heading}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {roster.map((party) => {
          const name = participantName(party);
          return (
            <Card
              key={party.id}
              padding="md"
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                {/* The roster serves `avatarUrl` (`serialize/participant.ts`)
                    and this card used to throw it away, so a room full of people
                    who had all uploaded a picture rendered as a grid of initials.
                    `Avatar` ignores `initials` once `src` is set and falls back
                    to them when the signed URL expires.

                    The face is a door when there is a page behind it.
                    `publicSlug` is null unless the profile is PUBLISHED, so an
                    unpublished act keeps its picture and simply is not a link —
                    the alternative was a door onto a 404. The card is not itself
                    clickable, so this nests nothing. */}
                <ProfileFace
                  avatarUrl={party.avatarUrl}
                  publicSlug={party.publicSlug}
                  name={name}
                  tone={roleTone(party.role)}
                  size={40}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    {eventParticipantRoleLabel(party.role)}
                  </div>
                </div>
                {/* The same overflow menu an event row carries, for the same
                    reason: two actions that must not sit on the card as buttons,
                    one of which is destructive. It renders only for a caller who
                    holds `participants.manage` — `menuItemsFor` returns nothing
                    otherwise — and each entry that is refused says why. */}
                {canManage && (
                  <EventRowMenu
                    label={`Actions for ${name}`}
                    items={collaborators.menuItemsFor(party, name)}
                  />
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Badge status={badgeStatusForParticipant(party.status)} dot>
                  {participantStatusLabel(party.status)}
                </Badge>
              </div>
            </Card>
          );
        })}
        {pendingInvitations.map((invitation) => (
          <PendingInvitationCard key={invitation.id} invitation={invitation} />
        ))}
      </div>

      <EventCollaboratorEditModal editor={collaborators.editor} />
      <ConfirmDialog {...collaborators.confirmDialogProps} />
    </>
  );
}

/**
 * Someone who has been asked and has not answered. Deliberately the same card as
 * a real collaborator — they belong on the same roster, they are simply not on
 * it yet — but never dressed as one: the avatar is neutral, the badge says
 * Pending, and the line underneath says plainly that nothing is granted until
 * they accept. Anything less and an operator reads "invited" as "added".
 */
function PendingInvitationCard({ invitation }: { invitation: EventInvitation }) {
  const label = invitation.recipientName ?? invitation.recipientEmail ?? "Invited collaborator";
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Avatar initials={initials(label)} tone="amber" size={40} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{label}</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {invitation.role ? eventParticipantRoleLabel(invitation.role) : "Collaborator"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge status="pending" dot>
          Invite pending
        </Badge>
      </div>
      <div style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.45 }}>
        {invitation.recipientEmail
          ? `Invited ${formatDay(invitation.createdAt)}: nothing is granted until they accept.`
          : "Nothing is granted until they accept."}
      </div>
    </Card>
  );
}

function badgeStatusForParticipant(raw: string): Status {
  if (raw === "confirmed" || raw === "active" || raw === "accepted") return "confirmed";
  if (raw === "invited" || raw === "pending") return "pending";
  if (raw === "declined" || raw === "removed") return "cancelled";
  return "draft";
}

/**
 * A PARTICIPANT's status, in its own words.
 *
 * `apiStatusToDisplay` translates the EVENT status vocabulary, and the two enums
 * only look alike: `event_participant_status` is
 * `invited | accepted | declined | confirmed | removed`, and `invited` is not in
 * the event enum at all — so it fell through to the default and a crew member
 * who had just been added to the bill was labelled "Draft". The badge TONE was
 * right the whole time, which is exactly how the wrong word survived.
 */
const PARTICIPANT_STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  accepted: "Accepted",
  declined: "Declined",
  confirmed: "Confirmed",
  removed: "Removed",
};

function participantStatusLabel(raw: string): string {
  return PARTICIPANT_STATUS_LABEL[raw] ?? humanizeEnumValue(raw);
}

/**
 * Messages are per-party threads now, not one per-event thread — the screen just
 * hands the roster down so a sender can be named. The rule (who is in which
 * thread) is the server's, in `apps/api/src/lib/message-threads.ts`.
 */
function MessagesTab({ eventId, roster }: { eventId: string; roster: Participant[] }) {
  /**
   * The negotiation belongs where the conversation is (ClickUp 86cbcftg3, Ran:
   * *"such things and UI should also be in the messages box as well"*).
   *
   * Two halves, deliberately different. The RECORD is a real message in the
   * thread, written by the API when a change is proposed and again when it is
   * answered — so scrolling this conversation back in six months shows what was
   * actually agreed, not just "can we move it?" / "sure". The ACTION is this
   * banner, which reads the live proposal.
   *
   * The buttons are not rendered inside a message on purpose: `CommentThread` is
   * shared with the settlement line comments, and teaching it about one screen's
   * controls would put this feature inside a component that has nothing to do
   * with it.
   */
  const changeRequest = useEventChangeRequest(eventId);

  return (
    <>
      {changeRequest.proposal && (
        <EventChangeRequestBanner
          proposal={changeRequest.proposal}
          isAnswering={changeRequest.isAnswering}
          onConfirm={changeRequest.confirm}
          onDecline={changeRequest.decline}
        />
      )}
      <EventMessagesTab
        eventId={eventId}
        roster={roster.map((party) => ({ id: party.id, name: participantName(party) }))}
      />
    </>
  );
}

function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}
