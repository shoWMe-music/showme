import { Button, Modal, TextField } from "@showme/design-system";
import { formatDay } from "../lib/format";
import { Eyebrow } from "./primitives";
import type { MarkUnavailableView, UnavailabilityBlock } from "./useMarkUnavailable";

/**
 * The last step of marking mode: what "Done marking" is about to write, and the
 * one place a reason is asked for.
 *
 * It is deliberately NOT an editor any more. The nights were picked on the
 * calendar — that is the whole point of the interaction — so this dialog only
 * reads them back and takes the one thing the grid cannot say: why. Dumb by
 * design: every decision lives in `useMarkUnavailable`.
 */

export interface MarkUnavailableModalProps {
  view: MarkUnavailableView;
}

/** "30 Aug 2026" / "30 Aug 2026 – 1 Sept 2026" — a range reads as one phrase. */
function formatBlockRange({ startDate, endDate }: UnavailabilityBlock): string {
  if (startDate === endDate) return formatDay(startDate);
  return `${formatDay(startDate)} – ${formatDay(endDate)}`;
}

function RangeList({
  heading,
  ranges,
}: {
  heading: string;
  ranges: UnavailabilityBlock[];
}) {
  if (ranges.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Eyebrow>{heading}</Eyebrow>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ranges.map((range) => (
          <span
            key={`${range.startDate}-${range.endDate}`}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--card)",
              fontSize: 12.5,
              color: "var(--text)",
            }}
          >
            {formatBlockRange(range)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MarkUnavailableModal({ view }: MarkUnavailableModalProps) {
  const nights = (count: number) => `${count} ${count === 1 ? "night" : "nights"}`;

  return (
    <Modal
      open={view.isConfirmOpen}
      onClose={view.closeConfirm}
      width={520}
      title="Done marking"
      footer={
        <>
          <Button variant="ghost" onClick={view.closeConfirm} disabled={view.isSaving}>
            Keep marking
          </Button>
          <Button variant="primary" onClick={view.commit} disabled={view.isSaving}>
            {view.isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Say plainly whose diary this writes to — an operator and a performer
            mean genuinely different things by "unavailable", and the row is
            profile-scoped either way. */}
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          These dates say <strong style={{ color: "var(--text)" }}>{view.profileName}</strong> can't
          be booked. They belong to this profile only — nobody else's calendar changes.
          {view.isProfilePublic
            ? " This profile is public, so anyone holding a shared availability link will see these days struck out."
            : " This profile isn't public, so the block stays internal."}
        </p>

        <RangeList
          heading={`Blocking ${nights(view.daysToBlockCount)}`}
          ranges={view.blockRanges}
        />
        <RangeList heading={`Freeing ${nights(view.daysToFreeCount)}`} ranges={view.freeRanges} />

        {/* Asked once, for the whole selection — not per block, which is what
            made the old form a chore for a two-week tour. Only the nights being
            BLOCKED can carry it, so it is not offered when there are none. */}
        {view.daysToBlockCount > 0 && (
          <TextField
            label="Reason (optional)"
            value={view.reason}
            placeholder="Touring, holiday, private hire…"
            onChange={(event) => view.setReason(event.target.value)}
          />
        )}

        {view.saveError && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
            {view.saveError}
          </p>
        )}
      </div>
    </Modal>
  );
}
