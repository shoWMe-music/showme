import type { GetApiV1SharesTokenDocument200 } from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ShareApiError,
  fetchShareDocument,
  forgetShareJwt,
  postShareApproval,
  postShareComment,
  requestShareCode,
  storedShareJwt,
  verifyShareCode,
} from "../lib/shareApi";

export type ShareDocument = GetApiV1SharesTokenDocument200;

/**
 * The share viewer's state, which is really one question asked twice: **do we
 * have a credential, and does the API still accept it?**
 *
 * A 401 from the document read is not an error to show — it is the gate. It means
 * "prove the address this was sent to", so the screen swaps to the code form
 * rather than an error panel, and any stale JWT is dropped on the way. Every other
 * failure (404 for revoked/expired, anything else) IS an error, and says so.
 *
 * The document itself is never held in state. It is refetched after every act, so
 * an approval or a comment is confirmed by what the server now says rather than by
 * the client patching its own copy — which is the same "live, not snapshot" rule
 * the whole surface is built on, applied to the client.
 */
export function useShareViewer(token: string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [jwt, setJwt] = useState<string | null>(() => storedShareJwt(token));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const documentKey = ["share-document", token, jwt] as const;
  const document = useQuery({
    queryKey: documentKey,
    queryFn: () => fetchShareDocument<ShareDocument>(token, jwt),
    retry: false,
  });

  const needsVerification =
    document.isError && document.error instanceof ShareApiError && document.error.status === 401;

  // A rejected credential is a dead one — an expired 24h JWT, or a link revoked
  // and reissued. Drop it, or the code form the user is about to fill in would be
  // submitted against a session the API has already refused.
  useEffect(() => {
    if (needsVerification && jwt) {
      forgetShareJwt(token);
      setJwt(null);
    }
  }, [needsVerification, jwt, token]);

  const sendCode = useMutation({
    mutationFn: () => requestShareCode(token, email.trim()),
    onSuccess: () => {
      setCodeSent(true);
      // Deliberately not "we sent it to you" — the API answers the same way for an
      // address that was never invited, so promising delivery would be a lie in
      // exactly the case where the truth matters.
      toast("If that address was invited, a code is on its way.");
    },
    onError: (error) => toast.error(shareErrorMessage(error)),
  });

  const verify = useMutation({
    mutationFn: () => verifyShareCode(token, email.trim(), code.trim()),
    onSuccess: (minted) => {
      setJwt(minted);
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["share-document", token] });
    },
    onError: (error) => toast.error(shareErrorMessage(error)),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["share-document", token] });

  const comment = useMutation({
    mutationFn: (input: { message: string; section?: string }) =>
      postShareComment(token, jwt, input),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(shareErrorMessage(error)),
  });

  const approve = useMutation({
    mutationFn: (input: { subject: "settlement" | "agreement"; dealId?: string }) =>
      postShareApproval(token, jwt, input),
    onSuccess: (_result, input) => {
      toast.success(input.subject === "settlement" ? "Settlement approved" : "Agreement confirmed");
      refresh();
    },
    onError: (error) => toast.error(shareErrorMessage(error)),
  });

  return {
    document: document.data ?? null,
    isPending: document.isPending,
    isError: document.isError && !needsVerification,
    error: document.error,
    needsVerification,
    email,
    setEmail,
    code,
    setCode,
    codeSent,
    sendCode: () => sendCode.mutate(),
    isSendingCode: sendCode.isPending,
    verify: () => verify.mutate(),
    isVerifying: verify.isPending,
    comment: (input: { message: string; section?: string }) => comment.mutate(input),
    isCommenting: comment.isPending,
    approve: (input: { subject: "settlement" | "agreement"; dealId?: string }) =>
      approve.mutate(input),
    isApproving: approve.isPending,
  };
}

/** The API's message when there is one; never the raw URL, which carries the grant. */
export function shareErrorMessage(error: unknown): string {
  if (error instanceof ShareApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
