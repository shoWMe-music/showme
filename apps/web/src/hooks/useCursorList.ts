import { type QueryKey, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

/**
 * Reading a keyset-paginated list, all of it.
 *
 * Every list endpoint answers `{ items, nextCursor }` and takes `cursor` + `limit`
 * (`apps/api/src/lib/pagination.ts`). The generated single-shot hooks fetch page
 * one and stop, which is why a screen that filtered `data.items` in the browser
 * was filtering whatever happened to be on that page. `useInfiniteQuery` over the
 * returned cursor is the honest fit: the answer is the whole list, reached one
 * keyset page at a time.
 *
 * Two ways to consume it:
 *  - **on demand** (default) — the screen renders a "Load more" control and the
 *    reader walks the pages;
 *  - **drained** (`loadAllPages`) — the hook keeps pulling until the cursor runs
 *    out. That is for screens whose numbers are AGGREGATES over the whole list
 *    (board column counts, "N open", a calendar's marked dates). Such a screen
 *    cannot be honest about a subset, and the API exposes no counts, so the only
 *    truthful option is to hold the complete list.
 */
export interface CursorPage<TItem> {
  items: TItem[];
  nextCursor: string | null;
}

export interface CursorListOptions<TItem> {
  /** Must not collide with the generated single-page key — see `infiniteKey`. */
  queryKey: QueryKey;
  fetchPage: (
    cursor: string | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<CursorPage<TItem>>;
  /** Pull every page instead of waiting to be asked (see the note above). */
  loadAllPages?: boolean;
  enabled?: boolean;
}

export interface CursorList<TItem> {
  /** Every item fetched so far — the complete list when `loadAllPages` is set. */
  items: TItem[];
  /** True until the list can be shown truthfully (a drained list: until the end). */
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** A next page exists and the reader has to ask for it. */
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/** The biggest page the API allows (`PaginationQuery.limit` maxes at 100). */
export const MAX_PAGE_SIZE = 100;

/**
 * The infinite cache entry for a list, kept distinct from the generated
 * single-page entry (which holds one `{ items, nextCursor }`, not `{ pages }`)
 * while staying under the same key prefix, so the realtime stream's
 * invalidate-by-prefix still reaches it.
 */
export function infiniteKey(generatedKey: QueryKey): QueryKey {
  return [...generatedKey, "infinite"];
}

export function useCursorList<TItem>({
  queryKey,
  fetchPage,
  loadAllPages = false,
  enabled = true,
}: CursorListOptions<TItem>): CursorList<TItem> {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    // `null` means "that was the last page"; undefined is how TanStack spells it.
    getNextPageParam: (page: CursorPage<TItem>) => page.nextCursor ?? undefined,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Drain: one page per effect run, re-triggered by `hasNextPage` flipping as each
  // page lands. Sequential by construction — the next cursor only exists once the
  // previous page has arrived.
  useEffect(() => {
    if (!loadAllPages) return;
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [loadAllPages, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const draining = loadAllPages && hasNextPage;

  // Stable identity while the pages are unchanged: `items` is a dependency of
  // downstream memos and per-row query expansions on several screens.
  const pages = query.data?.pages;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);

  return {
    items,
    // A drained list is a claim about ALL the rows, so the loading state stays up
    // until the last page lands rather than flashing a subset that reads as final.
    isPending: query.isPending || draining,
    isError: query.isError,
    error: query.error,
    hasMore: !loadAllPages && hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}
