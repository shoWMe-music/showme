import { Button, EmptyState, Icon, Spinner } from "@showme/design-system";
import { errorMessage } from "../lib/errors";

/** Centered spinner for the loading phase of a screen or section. */
export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
      <Spinner size={28} label={label} />
    </div>
  );
}

/** Friendly error panel; message is pulled from an ApiError when possible. */
export function ErrorState({
  error,
  title = "Couldn't load this",
}: { error: unknown; title?: string }) {
  return <EmptyState icon={<Icon name="mail" />} title={title} description={errorMessage(error)} />;
}

/**
 * The foot of a keyset-paginated list: the control that reaches the next page.
 * It renders nothing once the cursor is exhausted — the absence of the button is
 * how the screen says "that was all of them", which is only true because the
 * pages behind it were really fetched.
 */
export function LoadMore({
  hasMore,
  isLoading,
  onLoadMore,
}: { hasMore: boolean; isLoading: boolean; onLoadMore: () => void }) {
  if (!hasMore) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
      <Button variant="secondary" onClick={onLoadMore} disabled={isLoading}>
        {isLoading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
