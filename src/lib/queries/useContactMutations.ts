/**
 * Contact mutation hooks — full optimistic implementations.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth-context";
import { upsertContact, deleteContactFromDb } from "@/lib/db";
import type { Contact } from "@/lib/models";
import { toast } from "@/hooks/use-toast";
import { queryKeys } from "./keys";

// ── useAddContact ────────────────────────────────────────────────────────────

export function useAddContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ contact }: { contact: Contact }) => {
      await upsertContact(contact);
    },
    onMutate: async ({ contact }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.contacts(uid) });
      const snapshot = queryClient.getQueryData<Contact[]>(queryKeys.contacts(uid));

      queryClient.setQueryData<Contact[]>(queryKeys.contacts(uid), (old) => {
        if (!old) return old;
        return [contact, ...old];
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.contacts(uid), ctx.snapshot);
      }
      toast({ title: "Failed to save contact", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts(uid) });
    },
  });
}

// ── useUpdateContact ─────────────────────────────────────────────────────────

export function useUpdateContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Contact> }) => {
      const data = queryClient.getQueryData<Contact[]>(queryKeys.contacts(uid));
      const current = data?.find((c) => c.id === id);
      if (!current) return;
      await upsertContact({ ...current, ...updates });
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.contacts(uid) });
      const snapshot = queryClient.getQueryData<Contact[]>(queryKeys.contacts(uid));

      queryClient.setQueryData<Contact[]>(queryKeys.contacts(uid), (old) => {
        if (!old) return old;
        return old.map((c) => (c.id !== id ? c : { ...c, ...updates }));
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.contacts(uid), ctx.snapshot);
      }
      toast({ title: "Failed to update contact", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts(uid) });
    },
  });
}

// ── useDeleteContact ─────────────────────────────────────────────────────────

export function useDeleteContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await deleteContactFromDb(id);
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.contacts(uid) });
      const snapshot = queryClient.getQueryData<Contact[]>(queryKeys.contacts(uid));

      queryClient.setQueryData<Contact[]>(queryKeys.contacts(uid), (old) => {
        if (!old) return old;
        return old.filter((c) => c.id !== id);
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.contacts(uid), ctx.snapshot);
      }
      toast({ title: "Failed to delete contact", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contacts(uid) });
    },
  });
}
