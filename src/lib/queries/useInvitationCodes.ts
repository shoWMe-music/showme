/**
 * TanStack Query hooks for the invitation code system.
 *
 * - useValidateInvitationCode  – validate a code during signup (no auth)
 * - useMyInvitationCodes       – codes created by the current user
 * - useRevokeInvitationCode    – revoke an active code
 * - useIsAdmin                 – check admin status of current user
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import {
  fetchInvitationCode,
  fetchInvitationCodesByCreator,
  revokeInvitationCode,
  isUserAdmin,
} from "@/lib/db";
import type { InvitationCode } from "@/lib/db";
import { queryKeys } from "./keys";
import { toast } from "@/hooks/use-toast";

/** Validate a single invitation code (used during signup — no auth required). */
export function useValidateInvitationCode(code: string) {
  return useQuery({
    queryKey: queryKeys.invitationCode(code),
    queryFn: () => fetchInvitationCode(code),
    enabled: code.length >= 14, // SHOW-XXXX-XXXX = 14 chars
    staleTime: 30_000,
  });
}

/** Fetch all invitation codes created by the current user. */
export function useMyInvitationCodes() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  return useQuery({
    queryKey: queryKeys.myInvitationCodes(uid),
    queryFn: () => fetchInvitationCodesByCreator(uid),
    enabled: !!uid,
  });
}

/** Revoke an invitation code. */
export function useRevokeInvitationCode() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: (code: string) => revokeInvitationCode(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myInvitationCodes(uid) });
      toast({ title: "Invitation revoked" });
    },
    onError: () => {
      toast({ title: "Failed to revoke invitation", variant: "destructive" });
    },
  });
}

/** Check if the current user is an admin. */
export function useIsAdmin() {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  return useQuery({
    queryKey: queryKeys.isAdmin(uid),
    queryFn: () => isUserAdmin(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000, // 5 minutes
  });
}
