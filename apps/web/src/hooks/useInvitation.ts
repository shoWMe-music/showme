import {
  ApiError,
  type GetApiV1InvitationsToken200,
  getApiV1InvitationsToken,
  postApiV1InvitationsTokenAccept,
  postApiV1InvitationsTokenClaim,
  postApiV1InvitationsTokenClaimOtp,
  postApiV1InvitationsTokenDecline,
} from "@showme/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { sendEmailVerification } from "firebase/auth";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { auth } from "../auth/firebase";

export type InvitationOffer = GetApiV1InvitationsToken200;

/**
 * Every state a person clicking an invitation link can land in, named.
 *
 * This list IS the feature. Before it, all of these were the same experience —
 * the link opened the dashboard and nothing happened — and a silent failure is
 * indistinguishable from a broken product. The old app enumerated eight of them
 * on one page (`docs/old-app-analysis-flows-invite-settle.md` §1.1 step 4);
 * enumerating them is the work, and each one owes the reader a sentence saying
 * what happened and what to do next.
 *
 * - `loading`          — the offer is being read.
 * - `unreadable`       — the API could not be reached at all (not a verdict on the link).
 * - `not_found`        — no invitation by that token or code. Mistyped, or deleted.
 * - `expired`          — it had a date and the date has passed.
 * - `revoked`          — the sender withdrew it.
 * - `already_accepted` — answered yes already, by this account or another.
 * - `already_declined` — answered no already.
 * - `already_used`     — a claim invitation that has been spent.
 * - `signed_out`       — nobody is signed in. Show the offer, then the door.
 * - `wrong_account`    — signed in as someone the invitation was not sent to.
 * - `email_unverified` — the right address, but Firebase has not confirmed it.
 * - `needs_account`    — signed in, but the account has no profile to act as yet.
 * - `ready`            — it can be answered now.
 * - `accepted` / `declined` / `claimed` — answered in this sitting, by this reader.
 */
export type InvitationStage =
  | "loading"
  | "unreadable"
  | "not_found"
  | "expired"
  | "revoked"
  | "already_accepted"
  | "already_declined"
  | "already_used"
  | "signed_out"
  | "wrong_account"
  | "email_unverified"
  | "needs_account"
  | "ready"
  | "accepted"
  | "declined"
  | "claimed";

/** The terminal states of the invitation itself, as the API reports them. */
const STAGE_FOR_STATUS: Record<string, InvitationStage> = {
  expired: "expired",
  revoked: "revoked",
  accepted: "already_accepted",
  declined: "already_declined",
  used: "already_used",
};

/**
 * The redemption page's whole brain: read the offer, decide which of the states
 * above the reader is in, and carry the three answers they can give.
 *
 * The offer is re-read against the CURRENT identity — the query key carries the
 * signed-in uid — because `viewer.emailMatches` is computed server-side from the
 * token that was sent. Signing in, signing out or switching accounts therefore
 * re-decides the stage rather than leaving a stale verdict on screen, which is
 * the difference between "wrong account" being a fact and being a guess.
 */
export function useInvitation(token: string) {
  const { status: authStatus, user, refreshSession } = useAuth();
  const [answered, setAnswered] = useState<"accepted" | "declined" | "claimed" | null>(null);
  /** Whether a claim code has been sent in this sitting — drives the code step. */
  const [claimCodeSent, setClaimCodeSent] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const offer = useQuery({
    queryKey: ["invitation", token, user?.uid ?? null],
    queryFn: () => getApiV1InvitationsToken(token),
    retry: false,
    // The reader may have just verified their address or been given access in
    // another tab; nothing here is worth caching past the moment it is read.
    staleTime: 0,
  });

  const notFound = offer.isError && offer.error instanceof ApiError && offer.error.status === 404;

  // An answer can add a membership, which is what decides whether this account
  // has anywhere to land — so the session is re-read before the reader is
  // offered the door. A failure to re-read is not a failure to accept: the
  // grant is already written, and the next full load will pick it up.
  const settle = async (next: "accepted" | "declined" | "claimed") => {
    await refreshSession().catch(() => {});
    setAnswered(next);
  };

  const accept = useMutation({
    mutationFn: () => postApiV1InvitationsTokenAccept(token),
    onSuccess: () => settle("accepted"),
  });
  const decline = useMutation({
    mutationFn: () => postApiV1InvitationsTokenDecline(token),
    onSuccess: () => settle("declined"),
  });
  /**
   * Claiming is now TWO steps, because the invited address is proved rather than
   * matched (decisions #18): a code goes to the address on the invitation, and
   * the reader types it back. The reader may be signed in as somebody else
   * entirely — that is the whole point — so the code is the only thing that
   * connects them to the account they are taking over.
   */
  const requestClaimCode = useMutation({
    mutationFn: () => postApiV1InvitationsTokenClaimOtp(token),
    onSuccess: () => setClaimCodeSent(true),
  });
  const claim = useMutation({
    mutationFn: (otp: string) => postApiV1InvitationsTokenClaim(token, { otp }),
    onSuccess: () => settle("claimed"),
  });

  /**
   * Send (or re-send) Firebase's confirmation mail, then let the reader tell us
   * they have clicked it. `user.reload()` alone is not enough — `emailMatches`
   * and `emailVerified` are read off the ID TOKEN by the API, and that token
   * keeps its old claims until it is forced to refresh.
   */
  const sendVerification = useMutation({
    mutationFn: async () => {
      if (!auth.currentUser) throw new Error("Sign in first.");
      await sendEmailVerification(auth.currentUser);
    },
    onSuccess: () => setVerificationSent(true),
  });

  const recheckVerification = useMutation({
    mutationFn: async () => {
      if (!auth.currentUser) throw new Error("Sign in first.");
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
    },
    onSuccess: () => offer.refetch(),
  });

  return {
    offer: offer.data ?? null,
    error: offer.error,
    stage: resolveStage({
      isPending: offer.isPending,
      isError: offer.isError,
      notFound,
      offer: offer.data ?? null,
      authStatus,
      answered,
    }),
    accept,
    decline,
    claim,
    requestClaimCode,
    claimCodeSent,
    sendVerification,
    recheckVerification,
    verificationSent,
  };
}

/**
 * The order of these checks is the order a person meets them, and it is
 * deliberate: identity first (is this yours?), then capacity (do you have an
 * account to answer with?), then evidence (has that address been confirmed?).
 * Asking someone to verify an address the invitation was never sent to would be
 * a dead end dressed up as a step.
 */
function resolveStage(input: {
  isPending: boolean;
  isError: boolean;
  notFound: boolean;
  offer: InvitationOffer | null;
  authStatus: "loading" | "anon" | "onboarding" | "authed";
  answered: "accepted" | "declined" | "claimed" | null;
}): InvitationStage {
  if (input.answered) return input.answered;
  if (input.isPending) return "loading";
  if (input.notFound) return "not_found";
  if (input.isError || !input.offer) return "unreadable";

  const terminal = STAGE_FOR_STATUS[input.offer.status];
  if (terminal) return terminal;

  if (input.authStatus === "anon") return "signed_out";
  // A CLAIM no longer requires signing in as the invited address (decisions #18):
  // the address is proved with a code instead, so being "the wrong account" is
  // the ordinary case rather than a dead end — a venue invited at `info@` is
  // claimed by the person who runs it. Accept and decline still go by address.
  if (!input.offer.claimable && input.offer.boundToEmail && !input.offer.viewer.emailMatches) {
    return "wrong_account";
  }
  if (input.authStatus === "onboarding") return "needs_account";
  // The claiming ACCOUNT must still be verified — its address simply no longer
  // has to be the invited one.
  if ((input.offer.boundToEmail || input.offer.claimable) && !input.offer.viewer.emailVerified) {
    return "email_unverified";
  }
  return "ready";
}
