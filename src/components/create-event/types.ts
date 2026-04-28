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
