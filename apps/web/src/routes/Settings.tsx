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
import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { usePageTransition } from "../shell/usePageTransition";

type PayoutAccount = Awaited<ReturnType<typeof getApiV1ProfilesIdPayoutAccounts>>[number];

type SectionKey =
  | "general"
  | "team"
  | "notifications"
  | "security"
  | "appearance"
  | "integrations"
  | "billing";

const SECTIONS: { key: SectionKey; label: string; icon: IconName }[] = [
  { key: "general", label: "General", icon: "settings" },
  { key: "team", label: "Team Access", icon: "users" },
  { key: "notifications", label: "Notifications", icon: "bell" },
  { key: "security", label: "Security", icon: "eye" },
  { key: "appearance", label: "Appearance", icon: "star" },
  { key: "integrations", label: "Integrations", icon: "link" },
  { key: "billing", label: "Billing", icon: "receipt" },
];

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
  const [section, setSection] = useState<SectionKey>("general");
  // Same fade-and-rise as route changes, keyed on the active tab.
  const panelRef = usePageTransition(section);

  return (
    <>
      <SectionHeader
        eyebrow="Account"
        title="Settings"
        subtitle="Organization, access, and billing."
      />
      <div style={{ display: "flex", gap: 28, alignItems: "flex-start", marginTop: 18 }}>
        <nav
          aria-label="Settings sections"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            width: 210,
            flexShrink: 0,
            paddingLeft: 16,
          }}
        >
          {SECTIONS.map((item) => (
            <SidebarItem
              key={item.key}
              icon={<Icon name={item.icon} />}
              label={item.label}
              active={section === item.key}
              onClick={() => setSection(item.key)}
            />
          ))}
        </nav>

        <div ref={panelRef} style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
          {section === "general" && <GeneralPanel profileId={profileId} />}
          {section === "team" && <TeamPanel />}
          {section === "notifications" && <NotificationsPanel />}
          {section === "security" && <SecurityPanel />}
          {section === "appearance" && <AppearancePanel />}
          {section === "integrations" && <IntegrationsPanel />}
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

  // GET /me carries identity refs, not org display fields — seed the name from
  // the acting profile (falling back to the Firebase display name). Currency and
  // timezone have no read value on /me, so they start unset (placeholder).
  useEffect(() => {
    setOrgName(profile.data?.name ?? user?.displayName ?? "");
  }, [profile.data?.name, user?.displayName]);

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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Select
            label="Base currency"
            value={currency}
            options={CURRENCIES}
            onChange={setCurrency}
          />
          <Select label="Timezone" value={timezone} options={TIMEZONES} onChange={setTimezone} />
        </div>
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

function LegalCard({ profileId }: { profileId: string }) {
  const profile = useGetApiV1ProfilesId(profileId, { query: { enabled: Boolean(profileId) } });
  const toast = useToast();
  const [legalName, setLegalName] = useState("");
  const [vatId, setVatId] = useState("");
  const [address, setAddress] = useState("");
  const [vatRegistered, setVatRegistered] = useState(false);

  useEffect(() => {
    const billing = (profile.data?.billing ?? {}) as Record<string, unknown>;
    setLegalName(typeof billing.legalName === "string" ? billing.legalName : "");
    setVatId(typeof billing.vatId === "string" ? billing.vatId : "");
    setAddress(typeof billing.address === "string" ? billing.address : "");
    setVatRegistered(billing.vatRegistered === true);
  }, [profile.data]);

  const patch = usePatchApiV1ProfilesIdBilling({
    mutation: {
      onSuccess: () => toast.success("Legal & tax details saved"),
      onError: (mutationError) => toast.error(errorMessage(mutationError, "Couldn't save.")),
    },
  });

  if (!profileId) return null;
  if (profile.isPending) return <LoadingState label="Loading legal details" />;
  if (profile.isError)
    return <ErrorState error={profile.error} title="Couldn't load legal details" />;

  return (
    <PanelCard>
      <Eyebrow>Legal &amp; tax</Eyebrow>
      <TextField
        label="Legal / registered name"
        value={legalName}
        placeholder="e.g. Blackbird Presents Ltd"
        onChange={(changeEvent) => setLegalName(changeEvent.target.value)}
      />
      <TextField
        label="VAT ID"
        value={vatId}
        placeholder="e.g. DE123456789"
        onChange={(changeEvent) => setVatId(changeEvent.target.value)}
      />
      <TextField
        label="Registered address"
        value={address}
        placeholder="Street, city, country"
        onChange={(changeEvent) => setAddress(changeEvent.target.value)}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, color: "var(--text)" }}>VAT registered</span>
        <Toggle checked={vatRegistered} onChange={setVatRegistered} label="VAT registered" />
      </div>
      <div>
        <Button
          variant="primary"
          onClick={() =>
            patch.mutate({
              id: profileId,
              data: {
                legalName: legalName.trim(),
                vatId: vatId.trim(),
                address: address.trim(),
                vatRegistered,
              },
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
function TeamPanel() {
  const { session } = useAuth();
  const membership = session?.memberships[0];

  return (
    <PanelCard>
      <Eyebrow>Team Access</Eyebrow>
      {membership && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <KeyValueRow label="Your role" value={titleCase(membership.role)} />
          <KeyValueRow label="Account kind" value={titleCase(membership.kind)} />
        </div>
      )}
      <EmptyState
        icon={<Icon name="users" />}
        title="Inviting teammates isn't available yet"
        description="Member invitations and per-role permission sets will live here."
      />
    </PanelCard>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────
function NotificationsPanel() {
  return (
    <PanelCard>
      <Eyebrow>Notifications</Eyebrow>
      <EmptyState
        icon={<Icon name="bell" />}
        title="No notification preferences yet"
        description="Email and in-app alert controls for bookings, deals and settlements are coming soon."
      />
    </PanelCard>
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
      <EmptyState
        icon={<Icon name="eye" />}
        title="Password &amp; two-factor"
        description="Managed through your identity provider. In-app password change and 2FA aren't available yet."
      />
    </PanelCard>
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
        <KeyValueRow label="Credit balance" value={String(creditBalance)} mono />
        <KeyValueRow label="Renews" value={renewalAt ? formatDate(renewalAt) : "—"} />
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
          description="Add a bank account to receive settlement transfers."
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
