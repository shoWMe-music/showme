import { Button, EmptyState, Icon, Modal } from "@showme/design-system";
import { useEffect, useState } from "react";
import { formatFileSize } from "../lib/format";
import type { DetailsRider } from "./EventDetailsTab";
import { MonoPill } from "./eventUi";
import { Eyebrow } from "./primitives";
import type { RiderPreviewKind } from "./riderPreview";
import { ErrorState, LoadingState } from "./states";

export interface RiderPreviewModalProps {
  /** The rider being read; `null` closes the modal. */
  rider: DetailsRider | null;
  kind: RiderPreviewKind | null;
  /** The signed URL for the bytes, once the API has issued it. */
  url: string | null;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
}

/**
 * How tall the document pane is. Sized so the whole modal — header, notes, pane
 * AND the footer that holds the escape hatch — fits inside the panel's 90vh cap
 * on a laptop. A viewer whose "open in a new tab" button is below the fold is a
 * viewer with no way out when it fails to draw.
 */
const PANE_HEIGHT = "min(56vh, 560px)";

const paneStyle = {
  position: "relative",
  height: PANE_HEIGHT,
  border: "1px solid var(--border)",
  borderRadius: 12,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

const fillStyle = { width: "100%", height: "100%", border: 0, display: "block" } as const;

const overlayStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "var(--surface)",
} as const;

/**
 * A rider, read in the app instead of downloaded.
 *
 * Purely presentational: `useRiderPreview` decides which rider is open and asks
 * the API for the short-lived URL; this renders the answer. What it will NOT do
 * is decide who may look — that is `scopedEventRiders` on the server (decisions
 * #12), and a rider out of the reader's reach simply 404s into the error state.
 *
 * The bytes are handed to `<object>` / `<img>` / `<iframe>` directly rather than
 * fetched into a blob. The prior app tried the blob route and every preview
 * failed: a cross-origin `fetch` of a storage URL needs CORS headers the bucket
 * does not carry, while these tags need none.
 */
export function RiderPreviewModal({
  rider,
  kind,
  url,
  isPending,
  error,
  onClose,
}: RiderPreviewModalProps) {
  const file = rider?.file ?? null;
  const size = formatFileSize(file?.sizeBytes);

  return (
    <Modal
      open={rider !== null}
      onClose={onClose}
      title={rider?.name ?? "Rider"}
      width={900}
      footer={
        <>
          {url && (
            <Button
              variant="secondary"
              leftIcon={<Icon name="link" size={14} />}
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              Open in a new tab
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {rider && <MonoPill>{rider.type}</MonoPill>}
          {file ? (
            <>
              <span style={{ color: "var(--text)", fontSize: 13 }}>{file.name}</span>
              {size && <Eyebrow>{size}</Eyebrow>}
            </>
          ) : (
            <Eyebrow>No document attached</Eyebrow>
          )}
        </div>

        {rider?.description && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55 }}>
            {rider.description}
          </p>
        )}

        <RiderPreviewPane
          fileName={file?.name ?? null}
          kind={kind}
          url={url}
          isPending={isPending}
          error={error}
        />
      </div>
    </Modal>
  );
}

/** The document itself — or the honest reason it isn't on screen. */
function RiderPreviewPane({
  fileName,
  kind,
  url,
  isPending,
  error,
}: {
  fileName: string | null;
  kind: RiderPreviewKind | null;
  url: string | null;
  isPending: boolean;
  error: unknown;
}) {
  // None of these states are a document, so none of them get the document pane:
  // a tall empty rectangle around one sentence is a frame with nothing in it.
  if (!fileName || kind === null) {
    return (
      <EmptyState
        icon={<Icon name="file" />}
        title="No document attached"
        description="This rider is written down rather than uploaded — its type and notes above are all of it."
      />
    );
  }

  if (isPending) return <LoadingState label="Opening the document" />;

  // The API refused or could not issue a URL — its message is the honest answer,
  // including the 404 a rider outside the reader's reach produces.
  if (error || !url) return <ErrorState error={error} title="Couldn't open this document" />;

  if (kind === "unsupported") {
    return (
      <EmptyState
        icon={<Icon name="file" />}
        title="No preview for this file type"
        description={`${fileName} can be opened in a new tab, but it isn't a format this viewer can draw.`}
      />
    );
  }

  return <RiderDocument key={url} fileName={fileName} kind={kind} url={url} />;
}

/** How long the document gets to appear before we admit it isn't going to. */
const DOCUMENT_LOAD_TIMEOUT_MS = 8000;

/**
 * The loaded document, and the state of loading it.
 *
 * The reason this tracks state at all: a viewer element that fails renders as a
 * BLANK RECTANGLE — no error, no message, nothing to click — which is the worst
 * of the states this modal can be in. `<object>` and `<img>` do fire `error` on a
 * failed fetch (measured in Chromium), so an expired or refused URL becomes a
 * sentence. The timeout catches what fires neither event: a host that never
 * answers, or a browser that will not draw a PDF inline.
 */
function RiderDocument({
  fileName,
  kind,
  url,
}: { fileName: string; kind: RiderPreviewKind; url: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setStatus("failed"), DOCUMENT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const ready = () => setStatus("ready");
  const failed = () => setStatus("failed");

  return (
    <div style={paneStyle}>
      {status !== "failed" &&
        (kind === "image" ? (
          <img
            src={url}
            alt={fileName}
            onLoad={ready}
            onError={failed}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : kind === "text" ? (
          // `sandbox=""` revokes every privilege: a rider is a document someone
          // else uploaded, and an HTML or SVG one must not run in our origin.
          <iframe src={url} title={fileName} sandbox="" onLoad={ready} style={fillStyle} />
        ) : (
          // `#toolbar=1` asks the browser's own PDF viewer for its zoom, page and
          // print controls — the whole viewer UI, free and already familiar.
          <object
            data={`${url}#toolbar=1`}
            type="application/pdf"
            title={fileName}
            onLoad={ready}
            onError={failed}
            style={fillStyle}
          />
        ))}

      {status !== "ready" && (
        <div style={overlayStyle}>
          {status === "loading" ? (
            <LoadingState label="Opening the document" />
          ) : (
            <EmptyState
              icon={<Icon name="alert" />}
              title="The document didn't open here"
              description="It can still be opened in a new tab — the button is below."
            />
          )}
        </div>
      )}
    </div>
  );
}
