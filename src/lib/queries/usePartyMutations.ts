/**
 * Party mutation hooks — full optimistic implementations.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { upsertParty, deletePartyFromDb } from "@/lib/db";
import type { Party } from "@/lib/models";
import { toast } from "@/hooks/use-toast";
import { queryKeys } from "./keys";
import type { PrimaryData } from "./useEvents";

// ── useAddParty ────────────────────────────────────────────────────────────────

export function useAddParty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ party }: { party: Party }) => {
      await upsertParty(party);
    },
    onMutate: async ({ party }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.primaryData(uid) });
      const snapshot = queryClient.getQueryData<PrimaryData>(queryKeys.primaryData(uid));

      queryClient.setQueryData<PrimaryData>(queryKeys.primaryData(uid), (old) => {
        if (!old) return old;
        return { ...old, parties: [party, ...old.parties] };
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.primaryData(uid), ctx.snapshot);
      }
      toast({ title: "Failed to save party", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.primaryData(uid) });
    },
  });
}

// ── useUpdateParty ─────────────────────────────────────────────────────────────

export function useUpdateParty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Party> }) => {
      const data = queryClient.getQueryData<PrimaryData>(queryKeys.primaryData(uid));
      const current = data?.parties.find((p) => p.id === id);
      if (!current) return;
      await upsertParty({ ...current, ...updates });
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.primaryData(uid) });
      const snapshot = queryClient.getQueryData<PrimaryData>(queryKeys.primaryData(uid));

      queryClient.setQueryData<PrimaryData>(queryKeys.primaryData(uid), (old) => {
        if (!old) return old;
        return {
          ...old,
          parties: old.parties.map((p) => (p.id !== id ? p : { ...p, ...updates })),
        };
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.primaryData(uid), ctx.snapshot);
      }
      toast({ title: "Failed to update party", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.primaryData(uid) });
    },
  });
}

// ── useDeleteParty ─────────────────────────────────────────────────────────────

export function useDeleteParty() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await deletePartyFromDb(id);
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.primaryData(uid) });
      const snapshot = queryClient.getQueryData<PrimaryData>(queryKeys.primaryData(uid));

      queryClient.setQueryData<PrimaryData>(queryKeys.primaryData(uid), (old) => {
        if (!old) return old;
        return { ...old, parties: old.parties.filter((p) => p.id !== id) };
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.primaryData(uid), ctx.snapshot);
      }
      toast({ title: "Failed to delete party", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.primaryData(uid) });
    },
  });
}
