import { classNames } from "@/lib/classNames";
import { Icon } from "@/icons";
import type { LoadMoreControls, PageControls } from "./usePagination";
import styles from "./DataTable.module.css";

/** The table footer: either a "Load more" button or numbered page controls. */
export function DataTablePager({ loadMore, pages }: { loadMore: LoadMoreControls | null; pages: PageControls | null }) {
  if (loadMore) {
    if (!loadMore.hasMore) return null;
    return (
      <div className={classNames(styles.footer, styles.footerCenter)}>
        <button
          type="button"
          className={classNames(styles.loadMore, "touch-target")}
          onClick={loadMore.onLoadMore}
        >
          {loadMore.label}
          <span className={styles.count}>{loadMore.shownCount} / {loadMore.totalCount}</span>
        </button>
      </div>
    );
  }

  if (pages && pages.pageCount > 1) {
    return (
      <div className={styles.footer}>
        <span className={styles.range}>Showing {pages.rangeStart}–{pages.rangeEnd} of {pages.totalCount}</span>
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.pageArrow}
            aria-label="Previous page"
            disabled={pages.page === 0}
            onClick={() => pages.setPage(pages.page - 1)}
          >
            <Icon name="chevron-right" size={16} style={{ transform: "rotate(180deg)" }} />
          </button>
          {Array.from({ length: pages.pageCount }, (_, index) => (
            <button
              key={index}
              type="button"
              className={classNames(styles.page, index === pages.page && styles.pageActive)}
              aria-current={index === pages.page ? "page" : undefined}
              onClick={() => pages.setPage(index)}
            >
              {index + 1}
            </button>
          ))}
          <button
            type="button"
            className={styles.pageArrow}
            aria-label="Next page"
            disabled={pages.page === pages.pageCount - 1}
            onClick={() => pages.setPage(pages.page + 1)}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
