import { EmptyState, Icon, Spinner } from "@showme/design-system";
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
