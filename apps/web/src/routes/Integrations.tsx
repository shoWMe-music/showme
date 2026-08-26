import { Badge, Button, Card, EmptyState, Icon, SectionHeader } from "@showme/design-system";
import { useAuth } from "../auth/AuthProvider";
import { Eyebrow } from "../components/primitives";
import { ErrorState, LoadingState } from "../components/states";
import {
  type CalendarConnection,
  type CalendarConnectionsView,
  useCalendarConnections,
} from "../components/useCalendarConnections";
import { usePageTransition } from "../shell/usePageTransition";

/**
 * INTEGRATIONS — the outside services a shoWMe account is wired to. Today that is
 * one: a Google Calendar feeding the acting profile's availability.
 *
 * ITS OWN SCREEN, not a Settings tab. Settings is about the account (name,
 * currency, billing); this is an operational surface with live state — when it
 * last synced, whether it needs reconnecting, a button that does work. It is also
 * where the second and third integrations land, and a tab that grows a sync log
 * has outgrown the tab.
 *
 * THE THREE STATES, and the sentence each one owes the user:
 *   · **not connected** — what connecting would DO, before they authorise it.
 *     "Your busy hours block your availability" is the consequence; the consent
 *     screen will not say it.
 *   · **connected** — which account, when it last synced, and whether the next
 *     sync will be incremental. All three are how a user tells "working" from
 *     "quietly stopped a fortnight ago".
 *   · **needs reconnecting** — Google stopped accepting our token, which usually
 *     means the user revoked it themselves. Said plainly, with the fix, instead of
 *     a silent calendar that never updates again.
 *
 * DISCONNECT IS DESTRUCTIVE AND SAYS SO. It revokes the token at Google AND
 * removes the entries this connection imported, because an entry that can never
 * be refreshed would block nights forever. The button confirms first.
 */
export function Integrations() {
  const { session } = useAuth();
  const view = useCalendarConnections();
  const panelRef = usePageTransition("integrations");

  const googleConnections = view.connections.filter(
    (connection) => connection.provider === "google",
  );

  return (
    <>
      <SectionHeader
        eyebrow="Connections"
        title="Integrations"
        subtitle="Services connected to your shoWMe account."
      />

      <div ref={panelRef} style={{ maxWidth: 720, marginTop: 18 }}>
        {view.isLoading ? (
          <LoadingState label="Loading connections" />
        ) : view.loadError ? (
          <ErrorState error={view.loadError} title="Couldn't load your connections" />
        ) : googleConnections.length === 0 ? (
          <NotConnectedCard view={view} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {googleConnections.map((connection) => (
              <ConnectionCard key={connection.id} connection={connection} view={view} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Eyebrow>More integrations</Eyebrow>
            <EmptyState
              icon={<Icon name="link" />}
              title="Nothing else to connect yet"
              description={`Payment and accounting connections land here. Signed in as ${session?.email ?? "your account"}.`}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function NotConnectedCard({ view }: { view: CalendarConnectionsView }) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Eyebrow>Google Calendar</Eyebrow>
      <h3 style={{ margin: 0, fontSize: 17, color: "var(--text)" }}>Not connected</h3>
      {/* The consequence, stated before the consent screen rather than after it. */}
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
        Bring your calendar in and the hours you are already committed stop being offered as
        available. Entries appear on your shoWMe calendar, marked <strong>External</strong>; you can
        mark any of them "available anyway", or turn one into a show.
      </p>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)", lineHeight: 1.55 }}>
        Only you can see what your entries are called. Everyone else on the profile sees that the
        time is taken and nothing about what it is.
      </p>
      <div>
        <Button onClick={() => void view.connect()} disabled={view.isBusy}>
          <Icon name="link" size={14} />
          {view.isBusy ? "Opening Google…" : "Connect Google Calendar"}
        </Button>
      </div>
    </Card>
  );
}

function ConnectionCard({
  connection,
  view,
}: { connection: CalendarConnection; view: CalendarConnectionsView }) {
  const needsReconnect = connection.reauthorizationRequiredAt !== null;
  const busy = view.busyConnectionId === connection.id;

  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Eyebrow>Google Calendar</Eyebrow>
        {/* The shared palette, used for what it means here: a live connection
            reads as `confirmed`, one Google has stopped accepting as `cancelled`. */}
        <Badge status={needsReconnect ? "cancelled" : "confirmed"} dot>
          {needsReconnect ? "Needs reconnecting" : "Connected"}
        </Badge>
      </span>

      <h3 style={{ margin: 0, fontSize: 17, color: "var(--text)" }}>
        {connection.providerAccountId ??
          (connection.accountWithheld ? "A team member's calendar" : "Google Calendar")}
      </h3>

      {connection.accountWithheld && (
        // The same withholding the imported titles get, said out loud rather than
        // rendered as a blank.
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
          Whose calendar this is stays private to the person who connected it. It still shapes this
          profile's availability.
        </p>
      )}

      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 14,
        }}
      >
        <Fact label="Last synced" value={relativeTime(connection.lastSyncedAt)} />
        <Fact label="Calendar timezone" value={connection.calendarTimeZone ?? "—"} />
        <Fact
          label="Next sync"
          value={connection.incrementalSyncReady ? "Only what changed" : "Full re-listing"}
        />
      </dl>

      {needsReconnect && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: 13, color: "var(--brand-red)", lineHeight: 1.5 }}
        >
          Google stopped accepting our access on{" "}
          {formatMoment(connection.reauthorizationRequiredAt)}, so nothing has synced since. This
          usually means the access was removed at myaccount.google.com — connect again to restore
          it.
          {connection.lastError ? (
            <span style={{ display: "block", color: "var(--dim)", fontSize: 11.5, marginTop: 4 }}>
              Google said: {connection.lastError}
            </span>
          ) : null}
        </p>
      )}

      {connection.manageable ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {needsReconnect ? (
            <Button onClick={() => void view.connect()} disabled={view.isBusy}>
              <Icon name="link" size={14} />
              Reconnect
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => view.sync(connection.id)}
              disabled={view.isBusy}
            >
              <Icon name="download" size={14} />
              {busy && view.isBusy ? "Syncing…" : "Sync now"}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              // Destructive on both sides — the grant at Google AND the entries
              // here — so it asks before doing either.
              const confirmed = window.confirm(
                "Disconnect this calendar? shoWMe will revoke its access at Google and remove the entries it imported. Anything you already turned into a show is kept.",
              );
              if (confirmed) view.disconnect(connection.id);
            }}
            disabled={view.isBusy}
          >
            <Icon name="trash" size={14} />
            Disconnect
          </Button>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
          Only the person who connected this calendar can sync or disconnect it.
        </p>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Eyebrow>{label}</Eyebrow>
      <span style={{ fontSize: 13.5, color: "var(--text)" }}>{value}</span>
    </div>
  );
}

/** "4 minutes ago" — the only form that answers "is this still working?". */
function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatMoment(iso: string | null): string {
  if (!iso) return "—";
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "—";
  return moment.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
