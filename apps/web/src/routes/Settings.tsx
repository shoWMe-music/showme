import {
  type getApiV1ProfilesIdPayoutAccounts,
  useGetApiV1Me,
  useGetApiV1PlansProfileId,
  useGetApiV1ProfilesId,
  useGetApiV1ProfilesIdPayoutAccounts,
  usePatchApiV1Me,
  usePatchApiV1ProfilesIdBilling,
} from "@showme/api-client";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  type IconName,
  KeyValueRow,
  SectionHeader,
  Select,
  SidebarItem,
  TextField,
  Toggle,
  useToast,
} from "@showme/design-system";
import { useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { TeamAccessPanel } from "../components/TeamAccessPanel";
import { VatSettingsCard } from "../components/VatSettingsCard";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import {
  type NotificationChannel,
  type NotificationPreference,
  useNotificationPreferences,
} from "../hooks/useNotificationPreferences";
import { useTeamAccess } from "../hooks/useTeamAccess";
import { errorMessage } from "../lib/errors";
import { formatDay } from "../lib/format";
import {
  DEFAULT_IDLE_MINUTES,
  IDLE_TIMEOUT_OPTIONS,
  IDLE_TIMEOUT_STORAGE_KEY,
  idleMinutesFromStored,
  storedFromIdleMinutes,
} from "../lib/idleLogout";
import {
  notificationSoundMuted,
  playNotificationSound,
  setNotificationSoundMuted,
} from "../lib/notificationSound";
import { usePageTransition } from "../shell/usePageTransition";
import styles from "./Settings.module.css";

type PayoutAccount = Awaited<ReturnType<typeof getApiV1ProfilesIdPayoutAccounts>>[number];

type SectionKey =
  | "general"
  | "team"
  | "notifications"
  | "security"
  | "appearance"
  | "integrations"
  | "vat"
  | "billing";

const SECTIONS: { key: SectionKey; label: string; icon: IconName }[] = [
  { key: "general", label: "General", icon: "settings" },
  { key: "team", label: "Team Access", icon: "users" },
  { key: "notifications", label: "Notifications", icon: "bell" },
  { key: "security", label: "Security", icon: "eye" },
  { key: "appearance", label: "Appearance", icon: "star" },
  { key: "integrations", label: "Integrations", icon: "link" },
  { key: "vat", label: "VAT", icon: "file" },
  { key: "billing", label: "Billing", icon: "receipt" },
];

const SECTION_KEYS = new Set<string>(SECTIONS.map((item) => item.key));

/** `/settings#vat` opens the VAT tab. Anything unrecognised falls back to General. */
function sectionFromHash(hash: string): SectionKey | null {
  const key = hash.replace(/^#/, "");
  return SECTION_KEYS.has(key) ? (key as SectionKey) : null;
}

const CURRENCIES = ["EUR", "USD", "GBP", "SEK", "NOK", "DKK"];
const TIMEZONES = [
  "Europe/Stockholm",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "UTC",
  "America/New_York",
];

export function Settings() {
  const { session } = useAuth();
  const profileId = session?.memberships[0]?.profileId ?? "";
  // The hash IS the tab, so a tab is linkable — `UpgradeNoticeProvider` sends the
  // user to `/settings#billing`, and "the VAT tab" is now an address someone can
  // paste to a colleague.
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [section, setSection] = useState<SectionKey>(() => sectionFromHash(hash) ?? "general");
  useEffect(() => {
    const fromHash = sectionFromHash(hash);
    if (fromHash) setSection(fromHash);
  }, [hash]);
  // Same fade-and-rise as route changes, keyed on the active tab.
  const panelRef = usePageTransition(section);

  return (
    <>
      <SectionHeader
        eyebrow="Account"
        title="Settings"
        subtitle="Organization, access, and billing."
      />
      <div className={styles.layout}>
        <nav aria-label="Settings sections" className={styles.rail}>
          {SECTIONS.map((item) => (
            <SidebarItem
              key={item.key}
              icon={<Icon name={item.icon} />}
              label={item.label}
              active={section === item.key}
              onClick={() => {
                setSection(item.key);
                window.history.replaceState(null, "", `#${item.key}`);
              }}
            />
          ))}
        </nav>

        <div ref={panelRef} className={styles.panel}>
          {section === "general" && <GeneralPanel profileId={profileId} />}
          {section === "team" && <TeamPanel profileId={profileId} />}
          {section === "notifications" && <NotificationsPanel />}
          {section === "security" && <SecurityPanel />}
          {section === "appearance" && <AppearancePanel />}
          {section === "integrations" && <IntegrationsPanel />}
          {section === "vat" && <VatSettingsCard profileId={profileId} />}
          {section === "billing" && <BillingPanel profileId={profileId} />}
        </div>
      </div>
    </>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {children}
    </Card>
  );
}

// ── General ────────────────────────────────────────────────────────────────
function GeneralPanel({ profileId }: { profileId: string }) {
  const { user, session } = useAuth();
  const me = useGetApiV1Me();
  const profile = useGetApiV1ProfilesId(profileId, { query: { enabled: Boolean(profileId) } });
  const toast = useToast();

  const [orgName, setOrgName] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("");

  // The name comes from the acting profile (falling back to the Firebase display
  // name); currency and timezone come from `GET /me`, which now returns them.
  //
  // It did not until 2026-09-04, and that was the whole of ClickUp 123qy9rnfz0:
  // the write worked, the read did not exist, so these two came up blank on every
  // visit and the screen read as "it didn't save". Seeding them is the fix — if
  // this effect ever stops setting them, that bug is back.
  useEffect(() => {
    setOrgName(profile.data?.name ?? user?.displayName ?? "");
  }, [profile.data?.name, user?.displayName]);

  useEffect(() => {
    // `?? ""` keeps the placeholder for a user who has never chosen. Null means
    // unchosen, and must not be shown as a value they did pick.
    setCurrency(me.data?.currency ?? "");
    setTimezone(me.data?.timezone ?? "");
  }, [me.data?.currency, me.data?.timezone]);

  const patchMe = usePatchApiV1Me({
    mutation: {
      onSuccess: () => toast.success("Organization updated"),
      onError: (mutationError) => toast.error(errorMessage(mutationError, "Couldn't save.")),
    },
  });

  if (me.isPending) return <LoadingState label="Loading account" />;
  if (me.isError) return <ErrorState error={me.error} title="Couldn't load your account" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PanelCard>
        <Eyebrow>Organization</Eyebrow>
        <TextField
          label="Organization name"
          value={orgName}
          placeholder="e.g. Blackbird Presents"
          onChange={(changeEvent) => setOrgName(changeEvent.target.value)}
        />
        <TextField label="Contact email" value={session?.email ?? ""} disabled readOnly />
        <div className={styles.fieldPair}>
          {/*
           * "ACCOUNT CURRENCY", not "Base currency" (QA sweep run 9, QA9-10).
           *
           * `base currency` is taken, and by the authoritative measure: `events.base_currency`
           * and `deals.currency` are what a night settles in and what a party is owed. This
           * control writes `users.currency`, and somebody changing a row labelled "Base
           * currency" has every reason to believe they changed what is owed.
           *
           * It is not merely cosmetic either, which is the half the sweep and
           * `useDisplayCurrency`'s own docstring both get wrong: `Invoices.tsx` writes it onto
           * a new bill as that bill's denomination — deliberately, after QA6-17 stored "a bill
           * for €2,500 that nobody wrote" from a `useState("EUR")`. So the line below names
           * both jobs and the boundary, rather than claiming either one alone.
           */}
          <Select
            label="Account currency"
            value={currency}
            options={CURRENCIES}
            onChange={setCurrency}
          />
          <Select label="Timezone" value={timezone} options={TIMEZONES} onChange={setTimezone} />
        </div>
        <span className="muted" style={{ fontSize: 12, marginTop: -8 }}>
          Your currency: what a new bill is written in, and what screens offer to show figures in.
          An event and a deal keep their own — this never changes what is owed.
        </span>
        <div>
          <Button
            variant="primary"
            onClick={() =>
              patchMe.mutate({
                data: {
                  name: orgName.trim(),
                  ...(currency ? { currency } : {}),
                  ...(timezone ? { timezone } : {}),
                },
              })
            }
            disabled={patchMe.isPending || orgName.trim().length === 0}
          >
            {patchMe.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </PanelCard>

      <LegalCard profileId={profileId} />
    </div>
  );
}

/**
 * The profile's LEGAL identity — who the business is on paper. VAT used to live
 * here too, buried at the bottom of General; it is its own tab now
 * (`VatSettingsCard`), which is where a user looks for it.
 */
function LegalCard({ profileId }: { profileId: string }) {
  const profile = useGetApiV1ProfilesId(profileId, { query: { enabled: Boolean(profileId) } });
  const toast = useToast();
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    const billing = (profile.data?.billing ?? {}) as Record<string, unknown>;
    setLegalName(typeof billing.legalName === "string" ? billing.legalName : "");
    setAddress(typeof billing.address === "string" ? billing.address : "");
  }, [profile.data]);

  const patch = usePatchApiV1ProfilesIdBilling({
    mutation: {
      onSuccess: () => toast.success("Legal details saved"),
      onError: (mutationError) => toast.error(errorMessage(mutationError, "Couldn't save.")),
    },
  });

  if (!profileId) return null;
  if (profile.isPending) return <LoadingState label="Loading legal details" />;
  if (profile.isError)
    return <ErrorState error={profile.error} title="Couldn't load legal details" />;

  return (
    <PanelCard>
      <Eyebrow>Legal identity</Eyebrow>
      <TextField
        label="Legal / registered name"
        value={legalName}
        placeholder="e.g. Blackbird Presents Ltd"
        onChange={(changeEvent) => setLegalName(changeEvent.target.value)}
      />
      <TextField
        label="Registered address"
        value={address}
        placeholder="Street, city, country"
        onChange={(changeEvent) => setAddress(changeEvent.target.value)}
      />
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
        VAT registration, VAT ID and rate live in the VAT tab.
      </span>
      <div>
        <Button
          variant="primary"
          onClick={() =>
            patch.mutate({
              id: profileId,
              data: { legalName: legalName.trim(), address: address.trim() },
            })
          }
          disabled={patch.isPending}
        >
          {patch.isPending ? "Saving…" : "Save legal details"}
        </Button>
      </div>
    </PanelCard>
  );
}

// ── Team Access ──────────────────────────────────────────────────────────────
/**
 * Who is on the account, who has been asked, and the form for asking somebody
 * new. It used to be the two read-only rows below plus a shipped empty state
 * saying invitations "aren't available yet" — which, next to a working per-EVENT
 * invite flow, read as a broken feature rather than an unbuilt one and was
 * reported as exactly that (ClickUp 86cbaxvqk, "access giving non functional").
 *
 * The routes it drives are the ones that already existed: `POST /invitations`
 * with `type: "profile_member"`, and the `profile_members` pair. `useTeamAccess`
 * holds every decision; this component only picks the profile and the standing.
 */
function TeamPanel({ profileId }: { profileId: string }) {
  const { session } = useAuth();
  const membership =
    session?.memberships.find((one) => one.profileId === profileId) ?? session?.memberships[0];
  // The routes behind every control here are gated on exactly this pair, so the
  // panel offers nothing it cannot carry out.
  const canManage = membership?.role === "owner" || membership?.role === "admin";
  const team = useTeamAccess(profileId, canManage);

  if (team.isPending) return <LoadingState label="Loading the team" />;
  if (team.isError) return <ErrorState error={team.error} title="Couldn't load the team" />;

  return (
    <PanelCard>
      <TeamAccessPanel
        team={team}
        yourRole={membership?.role ?? null}
        accountKind={membership?.kind ?? null}
      />
    </PanelCard>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────
/**
 * One switch per category per channel, saved the moment it moves.
 *
 * The CATEGORIES AND THEIR COPY COME FROM THE API, deliberately — they are a
 * product decision that lives next to the code honouring them (`@showme/db/notify`),
 * and a second list here would be free to offer a switch for something nothing
 * emits, or hide one for something that does.
 */
function NotificationsPanel() {
  const { preferences, isPending, isError, error, setChannel, isSaving, saveError } =
    useNotificationPreferences();
  const toast = useToast();

  useEffect(() => {
    if (saveError) toast.error(errorMessage(saveError, "Couldn't save that preference."));
  }, [saveError, toast]);

  if (isPending) return <LoadingState label="Loading notification preferences" />;
  if (isError) return <ErrorState error={error} title="Couldn't load your notification settings" />;

  return (
    <PanelCard>
      <Eyebrow>Notifications</Eyebrow>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
        Turning a category off in the app means the notification is never written — it will not be
        waiting for you later. Booking requests you have been sent always reach you by email, and so
        does a settlement you are asked to review.
      </span>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 72px 72px",
            gap: 12,
            paddingBottom: 8,
            fontSize: 11.5,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          <span />
          <span style={{ textAlign: "center" }}>In app</span>
          <span style={{ textAlign: "center" }}>Email</span>
        </div>
        {preferences.map((preference) => (
          <NotificationPreferenceRow
            key={preference.category}
            preference={preference}
            disabled={isSaving}
            onChange={setChannel}
          />
        ))}
        <NotificationSoundRow />
      </div>
    </PanelCard>
  );
}

/**
 * The blip, and the switch that silences it (ClickUp `123qy9rnk3k`).
 *
 * Below the category grid rather than inside it, because it is a different KIND
 * of preference and would read as a lie in those columns: the categories decide
 * whether a notification exists at all, and this decides only whether the one you
 * are already getting makes a noise. It is also per-device rather than per-account
 * — see `lib/notificationSound.ts` — and the row says so, because a preference
 * that silently fails to follow you to your phone is worse than one that warns it
 * will not.
 *
 * "Play a sound", not "Mute": a switch reads best when ON means the thing
 * happens. The stored value is the mute, because unmuted is the default and an
 * absent key should mean audible.
 */
function NotificationSoundRow() {
  const [muted, setMuted] = useState(notificationSoundMuted);
  const toast = useToast();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "12px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, color: "var(--text)" }}>Play a sound</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          A short tone when a notification arrives. This one is set per browser, not on your account
          — muting it here leaves your phone alone.
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button
          variant="ghost"
          onClick={() => {
            // The button is the only way to find out whether sound works at all
            // here: a browser refuses audio until the page has been interacted
            // with, and a toggle that cannot be heard is a toggle nobody trusts.
            if (!playNotificationSound()) {
              toast.error(
                muted
                  ? "Sound is off — turn it on to hear it."
                  : "Your browser blocked the sound. Interact with the page and try again.",
              );
            }
          }}
        >
          Test
        </Button>
        <Toggle
          checked={!muted}
          onChange={(next) => {
            setNotificationSoundMuted(!next);
            // Read it BACK rather than trusting the write. Storage can be full or
            // disabled by policy, and the honest toggle shows what was stored.
            setMuted(notificationSoundMuted());
            if (next) playNotificationSound();
          }}
          label="Play a sound when a notification arrives"
        />
      </div>
    </div>
  );
}

function NotificationPreferenceRow({
  preference,
  disabled,
  onChange,
}: {
  preference: NotificationPreference;
  disabled: boolean;
  onChange: (category: string, channel: NotificationChannel, value: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 72px 72px",
        gap: 12,
        alignItems: "center",
        padding: "12px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, color: "var(--text)" }}>{preference.label}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{preference.description}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Toggle
          checked={preference.inApp}
          disabled={disabled}
          onChange={(next) => onChange(preference.category, "inApp", next)}
          label={`${preference.label} — in app`}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Toggle
          checked={preference.email}
          disabled={disabled}
          onChange={(next) => onChange(preference.category, "email", next)}
          label={`${preference.label} — email`}
        />
      </div>
    </div>
  );
}

// ── Security ─────────────────────────────────────────────────────────────────
function SecurityPanel() {
  const { session } = useAuth();

  return (
    <PanelCard>
      <Eyebrow>Security</Eyebrow>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <KeyValueRow label="Signed in as" value={session?.email ?? "—"} />
        <KeyValueRow label="Sign-in method" value="Email & password" />
        <KeyValueRow label="Identity provider" value="Firebase Auth" />
      </div>
      <AutoLogoutField />
      <EmptyState
        icon={<Icon name="eye" />}
        title="Password &amp; two-factor"
        description="Managed through your identity provider. In-app password change and 2FA aren't available yet."
      />
    </PanelCard>
  );
}

/**
 * AUTO LOGOUT (ClickUp `123qy9rnk3m`) — *"Log out from the account If no activity for 1
 * hour (default). Add to security settings and allow changing the time or disabling."*
 *
 * The rule and its storage are in `lib/idleLogout.ts`; the timer is in
 * `hooks/useIdleLogout.ts`, mounted by the shell. This is the control, and the two
 * things it has to say:
 *
 *  - **What counts as activity**, because a user who is reading rather than clicking
 *    needs to know whether they are about to be thrown out mid-sentence.
 *  - **That it is this device.** The setting is in `localStorage`, so it is a statement
 *    about the browser in front of you and not about the account. Saying so is the
 *    difference between a limitation and a lie — and it is what keeps somebody from
 *    believing their phone is covered because they set it on a laptop.
 *
 * Written on change rather than behind a Save button: there is one value, the effect is
 * immediate (the shell re-reads it on its next check), and a security setting that
 * silently needed saving would be the worst kind of half-applied.
 */
function AutoLogoutField() {
  const [minutes, setMinutes] = useState<number | null>(() => {
    try {
      return idleMinutesFromStored(window.localStorage.getItem(IDLE_TIMEOUT_STORAGE_KEY));
    } catch {
      // A private window with site data blocked. The default is the safe end.
      return DEFAULT_IDLE_MINUTES;
    }
  });

  const choose = (value: string) => {
    const next = value === "off" ? null : Number(value);
    setMinutes(next);
    try {
      window.localStorage.setItem(IDLE_TIMEOUT_STORAGE_KEY, storedFromIdleMinutes(next));
    } catch {
      // Nothing to do but keep the in-session choice — the shell reads the same key and
      // falls back to the default, so the protection stays on either way.
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Select
        label="Sign me out when idle"
        value={storedFromIdleMinutes(minutes)}
        options={IDLE_TIMEOUT_OPTIONS.map((option) => ({
          value: storedFromIdleMinutes(option.minutes),
          label: option.label,
        }))}
        onChange={choose}
      />
      <span style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 }}>
        Typing, clicking and scrolling all count as activity. This is set for{" "}
        <strong style={{ color: "var(--text)" }}>this device</strong> — your other browsers and your
        phone keep their own setting.
      </span>
    </div>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────
function AppearancePanel() {
  // Honest client-only control: writes the same [data-theme] attribute on <html>
  // that the app shell's toggle uses. Not persisted (matches current app behaviour).
  const [light, setLight] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "light",
  );

  const setTheme = (nextLight: boolean) => {
    setLight(nextLight);
    const element = document.documentElement;
    if (nextLight) element.setAttribute("data-theme", "light");
    else element.removeAttribute("data-theme");
  };

  return (
    <PanelCard>
      <Eyebrow>Appearance</Eyebrow>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, color: "var(--text)" }}>Light theme</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Switch between the warm dark and light surfaces.
          </span>
        </div>
        <Toggle checked={light} onChange={setTheme} label="Light theme" />
      </div>
    </PanelCard>
  );
}

// ── Integrations ─────────────────────────────────────────────────────────────
function IntegrationsPanel() {
  return (
    <PanelCard>
      <Eyebrow>Integrations</Eyebrow>
      <EmptyState
        icon={<Icon name="link" />}
        title="No integrations connected"
        description="Connect payment, accounting and calendar services here once integrations ship."
      />
    </PanelCard>
  );
}

// ── Billing ──────────────────────────────────────────────────────────────────
function BillingPanel({ profileId }: { profileId: string }) {
  if (!profileId) {
    return (
      <PanelCard>
        <Eyebrow>Billing</Eyebrow>
        <EmptyState icon={<Icon name="building" />} title="No profile selected" />
      </PanelCard>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PlanCard profileId={profileId} />
      <PayoutCard profileId={profileId} />
    </div>
  );
}

function PlanCard({ profileId }: { profileId: string }) {
  const plan = useGetApiV1PlansProfileId(profileId, { query: { enabled: Boolean(profileId) } });

  if (plan.isPending) return <LoadingState label="Loading plan" />;
  if (plan.isError) return <ErrorState error={plan.error} title="Couldn't load your plan" />;

  const { tier, status, source, seats, renewalAt, creditBalance } = plan.data;

  return (
    <PanelCard>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Eyebrow>Plan</Eyebrow>
        <Badge status={status === "active" ? "confirmed" : "pending"} dot>
          {titleCase(status)}
        </Badge>
      </div>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--text)" }}>
        {titleCase(tier)}
      </span>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <KeyValueRow label="Seats" value={String(seats)} mono />
        <KeyValueRow label="Source" value={source} />
        {/* The number now MEANS something: it moves down on every invitation
            sent off-platform and back up when that person answers. Labelled for
            what it counts rather than as an abstract "credit balance", because
            the only place a user meets it otherwise is the refusal at zero. */}
        <KeyValueRow label="Invitations left" value={String(creditBalance)} mono />
        <KeyValueRow label="Renews" value={renewalAt ? formatDay(renewalAt) : "—"} />
      </div>
    </PanelCard>
  );
}

function PayoutCard({ profileId }: { profileId: string }) {
  const accounts = useGetApiV1ProfilesIdPayoutAccounts(profileId, {
    query: { enabled: Boolean(profileId) },
  });

  if (accounts.isPending) return <LoadingState label="Loading payout accounts" />;
  if (accounts.isError)
    return <ErrorState error={accounts.error} title="Couldn't load payout accounts" />;

  const list = accounts.data ?? [];

  return (
    <PanelCard>
      <Eyebrow>Payout accounts</Eyebrow>
      {list.length === 0 ? (
        <EmptyState
          icon={<Icon name="file" />}
          title="No payout accounts yet"
          /*
           * DOES NOT NAME AN ACTION THAT HAS NO CONTROL (QA8-10).
           *
           * This read "Add a bank account to receive settlement transfers" on a panel with
           * no Add — `POST /profiles/:id/payout-accounts` has no caller in either front
           * end. The settlement workspace's own Payout tab is already honest about the same
           * gap ("Paying out through shoWMe is not connected yet. Until it is, mark each
           * transfer on the Settlement tab as you pay it"), so this says the same thing
           * rather than a different one.
           */
          description="Paying out through shoWMe is not connected yet, so there is nothing to add here. Mark each transfer on a settlement as you pay it."
        />
      ) : (
        list.map((account: PayoutAccount) => (
          <Card
            key={account.id}
            padding="md"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--text)" }}
              >
                {account.holderName ?? account.bankName ?? account.type}
              </span>
              {account.isPrimary && (
                <Badge status="confirmed" dot>
                  Primary
                </Badge>
              )}
            </div>
            <KeyValueRow label="Type" value={account.type} />
            {account.identifier && <KeyValueRow label="Account" value={account.identifier} mono />}
            {account.currency && <KeyValueRow label="Currency" value={account.currency} />}
          </Card>
        ))
      )}
    </PanelCard>
  );
}

function titleCase(value: string): string {
  return value.replace(/^\w/, (character) => character.toUpperCase());
}
