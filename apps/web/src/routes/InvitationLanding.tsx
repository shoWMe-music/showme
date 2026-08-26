import { Button, Card, Icon, KeyValueRow } from "@showme/design-system";
import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { AuthScreen } from "../auth/AuthScreen";
import { OnboardingFlow } from "../auth/OnboardingFlow";
import { Eyebrow } from "../components/primitives";
import { LoadingState } from "../components/states";
import { type InvitationOffer, type InvitationStage, useInvitation } from "../hooks/useInvitation";
import { errorMessage } from "../lib/errors";

/**
 * WHERE THE INVITATION EMAIL LANDS.
 *
 * Until now it landed nowhere: the mail linked to the app, the app never read
 * the token, and three built redemption routes had no caller. A recipient
 * clicked, arrived, and nothing happened — which is indistinguishable from a
 * product that does not work, and is exactly the failure this page exists to
 * end. So the rule here is that **no state is silent**: every one of the fifteen
 * in `InvitationStage` gets a sentence naming what happened and what to do next,
 * including the ones that are nobody's fault.
 *
 * It is chrome-less and lives outside the route tree, for the same reason
 * `ShareViewer` does (`router.tsx`): the reader is usually signed out, and often
 * has no account at all, so it cannot render inside a shell that assumes both.
 * When they need one, the app's own front doors are composed here rather than
 * copied — `AuthScreen` to sign in or sign up, `OnboardingFlow` to finish the
 * account — and because the token stays in the URL the whole way through, they
 * come back to this page and finish the answer they started.
 *
 * The offer is shown BEFORE the ask. Nobody should have to accept to find out
 * what they accepted.
 */
export function InvitationLanding({ token }: { token: string }) {
  const invitation = useInvitation(token);
  const { signOut } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  // LIGHT, unconditionally — for the reasons written out in full on the sibling
  // surface, `ShareViewer`. Short version: this page renders outside `AppShell`,
  // which is the only thing that stamps the theme, so without this a recipient
  // would meet shoWMe in dark and land in light the moment they accept. Removed
  // on unmount so this page cannot decide the theme for anything else.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    return () => document.documentElement.removeAttribute("data-theme");
  }, []);

  // The two full-screen flows the app already owns. Rendering them in place —
  // rather than navigating away — is what makes the link survive a signup: the
  // URL never changes, so finishing either one drops the reader back here with
  // the invitation still in hand.
  if (invitation.stage === "needs_account") return <OnboardingFlow />;
  if (invitation.stage === "signed_out" && signingIn) return <AuthScreen />;

  return (
    <div style={pageStyle}>
      <div style={columnStyle}>
        <Header offer={invitation.offer} />
        {invitation.stage === "loading" ? (
          <LoadingState label="Opening your invitation" />
        ) : (
          <>
            {invitation.offer && <OfferCard offer={invitation.offer} />}
            <AnswerCard
              stage={invitation.stage}
              offer={invitation.offer}
              error={invitation.error}
              invitation={invitation}
              onSignIn={() => setSigningIn(true)}
              onSignOut={() => signOut()}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The heading only claims an invitation exists when one does. "You have been
 * invited to shoWMe" over a dead link is a small lie that sends the reader
 * looking for a button that is not there.
 */
function Header({ offer }: { offer: InvitationOffer | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Eyebrow>Invitation</Eyebrow>
      <h1 style={headingStyle}>
        {offer?.targetName
          ? `${offer.inviterName ?? "Someone"} invited you to ${offer.targetName}`
          : offer
            ? "You have been invited to shoWMe"
            : "This invitation link"}
      </h1>
    </div>
  );
}

/**
 * What is actually being offered, in the words the invitation was written in.
 * Deliberately short: who, to what, as what, and to which address — the same
 * four facts the email carries, and nothing the sender did not choose to say.
 */
function OfferCard({ offer }: { offer: InvitationOffer }) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={fieldGridStyle}>
        <KeyValueRow label="From" value={offer.inviterName ?? "A shoWMe account"} />
        <KeyValueRow
          label={offer.targetKind === "event" ? "Event" : "Account"}
          value={offer.targetName ?? "—"}
        />
        <KeyValueRow label="Role" value={offer.role ? roleLabel(offer.role) : "—"} />
        <KeyValueRow label="Sent to" value={offer.recipientEmail ?? "Anyone with the link"} />
      </div>
      {offer.claimable && (
        // Deliberately unnamed. On a handoff the invitation points at BOTH an
        // event and the unclaimed profile behind it, and `targetName` is the
        // event — so naming anything here would name the wrong thing.
        <p style={noteStyle}>
          An account was set up for you by someone else, and this hands it over. Everything already
          booked on it comes with it.
        </p>
      )}
    </Card>
  );
}

/** `co_host` → `Co host`. The role is free text on the invitation, so this only tidies. */
function roleLabel(role: string): string {
  const spaced = role.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The sentence and the act, per state.
 *
 * Two things are load-bearing here and easy to lose. The first is that a refusal
 * still says what to DO — "sign out and sign in with the invited address" is a
 * next step; "wrong account" alone is a wall. The second is that **declining is
 * offered as plainly as accepting**: it is a real answer, it is already a route,
 * and an invitation you can only say yes to is a trap rather than an ask.
 */
function AnswerCard({
  stage,
  offer,
  error,
  invitation,
  onSignIn,
  onSignOut,
}: {
  stage: InvitationStage;
  offer: InvitationOffer | null;
  error: unknown;
  invitation: ReturnType<typeof useInvitation>;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const eventLink = offer?.targetEventId ? `/events/${offer.targetEventId}` : "/";
  const busy =
    invitation.accept.isPending || invitation.decline.isPending || invitation.claim.isPending;
  const answerFailed =
    invitation.accept.error ?? invitation.decline.error ?? invitation.claim.error;

  switch (stage) {
    case "unreadable":
      return (
        <Panel title="We could not open this invitation">
          <p style={bodyStyle}>
            Something went wrong on our side, not with your link: {errorMessage(error)}. Try again
            in a moment — the invitation is unaffected.
          </p>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </Panel>
      );

    case "not_found":
      return (
        <Panel title="This invitation does not exist">
          <p style={bodyStyle}>
            The link may have been mistyped or cut short by an email client, or the invitation may
            have been deleted. Ask whoever invited you to send it again.
          </p>
        </Panel>
      );

    case "expired":
      return (
        <Panel title="This invitation has expired">
          <p style={bodyStyle}>
            It was only good until a certain date, and that date has passed. Ask{" "}
            {offer?.inviterName ?? "whoever invited you"} for a fresh link — nothing you did caused
            this.
          </p>
        </Panel>
      );

    case "revoked":
      return (
        <Panel title="This invitation was withdrawn">
          <p style={bodyStyle}>
            {offer?.inviterName ?? "The sender"} took it back before you got here. If that looks
            like a mistake, the fastest fix is to ask them directly.
          </p>
        </Panel>
      );

    case "already_accepted":
      return (
        <Panel title="This invitation has already been accepted">
          <p style={bodyStyle}>
            Nothing more to do — whoever it was sent to said yes. If that was you, sign in and it
            will be waiting.
          </p>
          <Button onClick={() => window.location.assign(eventLink)}>Open shoWMe</Button>
        </Panel>
      );

    case "already_declined":
      return (
        <Panel title="This invitation was declined">
          <p style={bodyStyle}>
            The answer has already been given, and an invitation can only be answered once. Ask{" "}
            {offer?.inviterName ?? "the sender"} to invite you again if that was not what you meant.
          </p>
        </Panel>
      );

    case "already_used":
      return (
        <Panel title="This invitation has already been used">
          <p style={bodyStyle}>
            The profile it was holding has been claimed. If that was you, sign in — it is on your
            account now.
          </p>
          <Button onClick={() => window.location.assign("/")}>Open shoWMe</Button>
        </Panel>
      );

    case "signed_out":
      return (
        <Panel title="Sign in to answer">
          <p style={bodyStyle}>
            {offer?.boundToEmail
              ? `This was sent to ${offer.recipientEmail}. Sign in with that address — or create an account with it, if you do not have one yet — and this invitation will be here waiting.`
              : "Sign in, or create an account, and this invitation will be here waiting."}
          </p>
          <Button onClick={onSignIn}>Sign in or create an account</Button>
        </Panel>
      );

    case "wrong_account":
      return (
        <Panel title="This invitation is not for this account">
          <p style={bodyStyle}>
            It was sent to {offer?.recipientEmail ?? "a different address"}, and you are signed in
            as someone else. Sign out and sign back in with the invited address, and this page will
            let you answer.
          </p>
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
        </Panel>
      );

    case "email_unverified":
      return (
        <Panel title="Confirm your email address first">
          <p style={bodyStyle}>
            An invitation can only be answered by the address it was sent to, so we need proof that{" "}
            {offer?.recipientEmail ?? "this address"} is yours. We will send a confirmation link —
            open it, then come back here.
          </p>
          <div style={actionsStyle}>
            <Button
              onClick={() => invitation.sendVerification.mutate()}
              disabled={invitation.sendVerification.isPending}
            >
              {invitation.verificationSent ? "Send it again" : "Send the confirmation email"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => invitation.recheckVerification.mutate()}
              disabled={invitation.recheckVerification.isPending}
            >
              I have confirmed it
            </Button>
          </div>
          {invitation.verificationSent && (
            <p style={noteStyle}>Sent. It can take a minute, and it may be in your spam folder.</p>
          )}
        </Panel>
      );

    case "ready":
      return (
        <Panel title={offer?.claimable ? "Take this account over?" : "Do you accept?"}>
          <p style={bodyStyle}>
            {offer?.claimable
              ? "Claiming makes that account yours, with everything already booked on it. Declining leaves it exactly as it is."
              : "Accepting adds you to it straight away. Declining is a real answer too, and closes the invitation."}
          </p>
          {answerFailed && <p style={errorStyle}>{errorMessage(answerFailed)}</p>}
          <div style={actionsStyle}>
            <Button
              onClick={() =>
                offer?.claimable ? invitation.claim.mutate() : invitation.accept.mutate()
              }
              disabled={busy}
            >
              {busy ? "One moment…" : offer?.claimable ? "Claim it" : "Accept"}
            </Button>
            <Button variant="secondary" onClick={() => invitation.decline.mutate()} disabled={busy}>
              Decline
            </Button>
          </div>
        </Panel>
      );

    // Two outcomes, two different true sentences. Only ACCEPT notifies the
    // sender (`notifyUsers` in `routes/invitations.ts`); a claim tells nobody,
    // so saying it did would be the kind of small lie this page exists to stop.
    case "accepted":
      return (
        <Panel title="You are in">
          <p style={bodyStyle}>
            {offer?.targetName
              ? `${offer.targetName} is on your shoWMe account now.`
              : "This is on your shoWMe account now."}{" "}
            {offer?.inviterName ?? "Whoever invited you"} has been told you accepted.
          </p>
          <Button onClick={() => window.location.assign(eventLink)}>
            {offer?.targetKind === "event" ? "Open the event" : "Open shoWMe"}
          </Button>
        </Panel>
      );

    case "claimed":
      return (
        <Panel title="It is yours">
          <p style={bodyStyle}>
            That account now belongs to you — it is in your profile list, with everything that was
            already on it.
          </p>
          <Button onClick={() => window.location.assign("/profiles")}>Open your profiles</Button>
        </Panel>
      );

    case "declined":
      return (
        <Panel title="Declined">
          <p style={bodyStyle}>
            The invitation is closed and you have not been added to anything. Nothing else is
            expected of you — if you change your mind, ask {offer?.inviterName ?? "the sender"} to
            invite you again.
          </p>
        </Panel>
      );

    default:
      return null;
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="mail" size={15} />
        <span style={{ color: "var(--text)", fontSize: 15, fontWeight: 600 }}>{title}</span>
      </div>
      {children}
    </Card>
  );
}

const pageStyle = {
  minHeight: "100dvh",
  background: "var(--bg)",
  display: "flex",
  justifyContent: "center",
  padding: "48px 20px 80px",
} as const;

const columnStyle = {
  width: "100%",
  maxWidth: 560,
  display: "flex",
  flexDirection: "column",
  gap: 16,
} as const;

const headingStyle = {
  margin: 0,
  fontFamily: "var(--font-display)",
  fontSize: 26,
  lineHeight: 1.2,
  color: "var(--text)",
} as const;

/**
 * One column, not two. `KeyValueRow` is a full-width label↔value LINE, and
 * packing four of them into a 560px card two-abreast wraps the labels ("Sent /
 * to") and pushes long addresses against their neighbour. Four facts stacked
 * read straight down and every value gets its own line.
 */
const fieldGridStyle = { display: "grid", gap: 2 } as const;

const bodyStyle = {
  margin: 0,
  color: "var(--muted)",
  fontSize: 13.5,
  lineHeight: 1.65,
} as const;

const noteStyle = { ...bodyStyle, fontSize: 12.5 } as const;

const errorStyle = { ...bodyStyle, color: "var(--brand-red)" } as const;

const actionsStyle = { display: "flex", flexWrap: "wrap", gap: 10 } as const;
