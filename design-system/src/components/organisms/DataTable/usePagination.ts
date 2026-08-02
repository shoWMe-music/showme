import { useEffect, useState } from "react";

export type DataTablePagination =
  | { mode: "load-more"; pageSize: number; loadMoreLabel?: string }
  | { mode: "pages"; pageSize: number };

export interface LoadMoreControls {
  hasMore: boolean;
  onLoadMore: () => void;
  shownCount: number;
  totalCount: number;
  label: string;
}

export interface PageControls {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  rangeStart: number;
  rangeEnd: number;
  totalCount: number;
}

/** Paging logic for the DataTable — either "load more" (grow the visible slice)
 * or "pages" (numbered, left to right). Returns the visible rows plus whichever
 * set of controls applies. Kept out of the component so it stays presentational. */
export function usePagination<Row>(rows: Row[], pagination?: DataTablePagination) {
  const [visibleCount, setVisibleCount] = useState(pagination?.pageSize ?? rows.length);
  const [page, setPage] = useState(0);

  // reset when the dataset size or config changes
  useEffect(() => {
    setVisibleCount(pagination?.pageSize ?? rows.length);
    setPage(0);
  }, [rows.length, pagination?.pageSize, pagination?.mode]);

  if (!pagination) {
    return { visibleRows: rows, loadMore: null as LoadMoreControls | null, pages: null as PageControls | null };
  }

  if (pagination.mode === "load-more") {
    const shownCount = Math.min(visibleCount, rows.length);
    return {
      visibleRows: rows.slice(0, shownCount),
      loadMore: {
        hasMore: shownCount < rows.length,
        onLoadMore: () => setVisibleCount((count) => count + pagination.pageSize),
        shownCount,
        totalCount: rows.length,
        label: pagination.loadMoreLabel ?? "Load more",
      },
      pages: null,
    };
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / pagination.pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pagination.pageSize;
  const end = Math.min(start + pagination.pageSize, rows.length);
  return {
    visibleRows: rows.slice(start, end),
    loadMore: null,
    pages: {
      page: current,
      pageCount,
      setPage,
      rangeStart: rows.length === 0 ? 0 : start + 1,
      rangeEnd: end,
      totalCount: rows.length,
    },
  };
}
