/**
 * Contacts query hook and selector helpers.
 *
 * Fetches all contacts for the current user as a standalone TanStack Query.
 */

import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import type { QueryDocumentSnapshot } from "firebase/firestore";

import { useAuth } from "@/lib/auth-context";
import { fetchContacts, fetchContactPage, type ContactPageFilters } from "@/lib/db";
import type { Contact } from "@/lib/models";
import { queryKeys } from "./keys";

// ── Main query ─────────────────────────────────────────────────────────────────

export function useContactsQuery() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";

  return useQuery<Contact[]>({
    queryKey: queryKeys.contacts(uid),
    enabled: !!uid && !authLoading,
    staleTime: 5 * 60 * 1000,
    queryFn: fetchContacts,
  });
}

// ── Selectors ──────────────────────────────────────────────────────────────────

export function useContacts(): Contact[] {
  const { data } = useContactsQuery();
  return data ?? [];
}

export function useContactsLoaded(): boolean {
  const { isSuccess } = useContactsQuery();
  return isSuccess;
}

export function useContact(id: string): Contact | undefined {
  const contacts = useContacts();
  return contacts.find((c) => c.id === id);
}

// ── Paginated query (for ContactsPage) ────────────────────────────────────────

interface ContactPage {
  contacts: Contact[];
  lastDoc: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

/**
 * Firestore cursor-based pagination for the contacts list page.
 * Fetches contacts in batches of `pageSize`, ordered by name ascending.
 * Other pages should keep using `useContacts()` which loads all contacts.
 */
export function usePaginatedContacts(pageSize: number, filters?: ContactPageFilters) {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid ?? "";

  return useInfiniteQuery<ContactPage, Error>({
    queryKey: queryKeys.contactPages(uid, filters as Record<string, unknown>),
    enabled: !!uid && !authLoading,
    staleTime: 5 * 60 * 1000,
    initialPageParam: null as QueryDocumentSnapshot | null,
    queryFn: ({ pageParam }) => fetchContactPage(pageSize, pageParam, filters),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.lastDoc : undefined),
  });
}
