import { Button, EmptyState, Icon, Spinner } from "@showme/design-system";
import { errorMessage, isPermissionRefusal } from "../lib/errors";

/** Centered spinner for the loading phase of a screen or section. */
export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
      <Spinner size={28} label={label} />
    </div>
  );
}

/**
 * Friendly error panel; message is pulled from an ApiError when possible.
 *
 * A REFUSAL IS NOT A FAILURE. "Couldn't load the deals" over "Missing capability:
 * deal.view.own" tells a co-operator that something broke and names an internal
 * identifier at them; nothing broke, and the part of the event simply is not theirs.
 * The caller's `title` is about the thing that did not load, so it is the wrong
 * sentence for a 403 and is replaced rather than decorated.
 */
export function ErrorState({
  error,
  title = "Couldn't load this",
}: { error: unknown; title?: string }) {
  const refused = isPermissionRefusal(error);
  return (
    <EmptyState
      icon={<Icon name={refused ? "eye-off" : "mail"} />}
      title={refused ? "Not shared with you" : title}
      description={errorMessage(error)}
    />
  );
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
