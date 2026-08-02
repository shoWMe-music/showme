import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import { Skeleton } from "@/components/atoms/Skeleton/Skeleton";
import { usePagination, type DataTablePagination } from "./usePagination";
import { DataTablePager } from "./DataTablePager";
import styles from "./DataTable.module.css";

export interface DataTableColumn<Row> {
  header: ReactNode;
  /** CSS grid track for this column, e.g. "2.4fr" or "120px". */
  width: string;
  align?: "left" | "right";
  render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  /** Makes rows clickable (button rows with a hover highlight). */
  onRowClick?: (row: Row) => void;
  /** Adds a "Load more" button or numbered pages. Omit to show every row. */
  pagination?: DataTablePagination;
  /** Renders shimmering skeleton rows instead of data. */
  loading?: boolean;
  /** How many skeleton rows to show while loading. Defaults to the page size, or 5. */
  skeletonRows?: number;
  className?: string;
}

/**
 * The operator prototype's list/table: a card wrapping a mono uppercase header
 * row and grid data rows that share one column template. Presentational — pass
 * `columns` (with per-cell `render`) and `rows`. Used for Events and Bills &
 * Invoices.
 */
export function DataTable<Row>({ columns, rows, getRowKey, onRowClick, pagination, loading, skeletonRows, className }: DataTableProps<Row>) {
  const { visibleRows, loadMore, pages } = usePagination(rows, pagination);
  const template = columns.map((column) => column.width).join(" ");
  const cells = (row: Row) =>
    columns.map((column, index) => (
      <span key={index} className={column.align === "right" ? styles.right : undefined}>
        {column.render(row)}
      </span>
    ));

  const skeletonCount = skeletonRows ?? pagination?.pageSize ?? 5;

  return (
    <div className={classNames(styles.table, className)} aria-busy={loading || undefined}>
      <div className={styles.header} style={{ gridTemplateColumns: template }}>
        {columns.map((column, index) => (
          <span key={index} className={column.align === "right" ? styles.right : undefined}>
            {column.header}
          </span>
        ))}
      </div>

      {loading
        ? Array.from({ length: skeletonCount }, (_, rowIndex) => (
            <div key={`skeleton-${rowIndex}`} className={styles.row} style={{ gridTemplateColumns: template }}>
              {columns.map((column, index) => (
                <span key={index} className={column.align === "right" ? styles.right : undefined}>
                  <Skeleton height={12} width={column.align === "right" ? "48px" : "70%"} />
                </span>
              ))}
            </div>
          ))
        : visibleRows.map((row) =>
            onRowClick ? (
              <button
                key={getRowKey(row)}
                type="button"
                className={classNames(styles.row, styles.clickable)}
                style={{ gridTemplateColumns: template }}
                onClick={() => onRowClick(row)}
              >
                {cells(row)}
              </button>
            ) : (
              <div key={getRowKey(row)} className={styles.row} style={{ gridTemplateColumns: template }}>
                {cells(row)}
              </div>
            ),
          )}

      {!loading && <DataTablePager loadMore={loadMore} pages={pages} />}
    </div>
  );
}
