import type { DealType } from "@/lib/models";
import type { PerformerRoleTag } from "@/components/PerformerFormFields";
import type { OperatorRole } from "@/lib/user-context";

export interface PrefillData {
  artistName?: string;
  date?: string;
  venueName?: string;
  fee?: number;
  contactEmail?: string;
  contactName?: string;
  /** If this event is being created from a booking request, pass its ID so the event can back-reference it. */
  sourceRequestId?: string;
  /** The date the performer originally requested, for detecting counter-proposals. */
  sourceRequestDate?: string;
  dealType?: DealType;
  artistGuarantee?: string;
  artistSplit?: string;
  promoterSplit?: string;
  venueSplit?: string;
  eventStatus?: string;
}

export interface CreateEventDialogProps {
  trigger?: React.ReactNode;
  defaultDate?: Date;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  prefillData?: PrefillData;
  onEventCreated?: (eventId: string) => void;
  defaultStatus?: string;
}

/**
 * Whether to invite the attached collaborator profiles (performer/venue/etc.)
 * when the event is created.
 *
 * - `true`  → add collaborator owner UIDs to `accessUids` so they see the event
 *             in their list (and the existing notification machinery picks it up).
 * - `false` → keep the collaborator profile IDs on `accessProfileIds` but do
 *             NOT add their owner UIDs. The event lives as a draft until the
 *             organizer explicitly clicks "Suggest to performer" / "Invite
 *             collaborators" later.
 *
 * Default: when omitted, behaves as `false` for draft events and `true` for
 * any other status — preserving the per-spec "no auto-invite on draft" rule
 * while keeping legacy behavior for non-draft creates.
 */
export type InviteCollaboratorsChoice = boolean | undefined;

export interface PerformerEntry {
  id: string;
  artistName: string;
  performerProfileId: string;
  performerRoleTag?: PerformerRoleTag;
  dealType: DealType;
  artistGuarantee: string;
  artistSplit: string;
  promoterSplit: string;
  venueSplit: string;
  stageRoom: string;
  stageCapacity: string;
  performerVenue: string;
}

export interface PartyState {
  key: string;
  label: string;
  name: string;
  percentage: string;
}

export const AVAILABLE_PARTIES = [
  { key: "bookerAgent", label: "Booker/Agent", defaultPct: "15" },
  { key: "promoter", label: "Promoter", defaultPct: "20" },
  { key: "management", label: "Management", defaultPct: "10" },
] as const;
