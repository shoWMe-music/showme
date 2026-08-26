/** Barrel for the operator/venue app's shared composite components. Each is
 * presentational — data comes in via typed props; screens fetch and pass down.
 * Style is DS tokens/atoms only, so both themes work. */

export { AgreementView } from "./AgreementView";
export type { AgreementField, AgreementViewProps } from "./AgreementView";

export { AudienceCard } from "./AudienceCard";
export type { AudienceCardProps } from "./AudienceCard";

export { AvailabilityShareModal } from "./AvailabilityShareModal";
export type { AvailabilityShareModalProps } from "./AvailabilityShareModal";

export { BudgetPlanner } from "./BudgetPlanner";
export type {
  BudgetPlannerProps,
  BudgetToolbarAction,
  CostRow,
  CustomRevenueRow,
  TicketTypeRow,
} from "./BudgetPlanner";
export { BudgetTemplateDialogs } from "./BudgetTemplateDialogs";

export { CalendarMonthGrid } from "./CalendarMonthGrid";
export type { CalendarEvent, CalendarLabelMode, CalendarMonthGridProps } from "./CalendarMonthGrid";

export { CommentThread } from "./CommentThread";
export type { CommentThreadProps, ThreadComment } from "./CommentThread";

export { EventDetailHeader } from "./EventDetailHeader";
export type { EventDetailHeaderProps, EventParty } from "./EventDetailHeader";

export { EventDetailsTab } from "./EventDetailsTab";
export type {
  DetailsEvent,
  DetailsPerformer,
  DetailsRider,
  DetailsScheduleEntry,
  EventDetailsTabProps,
  EventExtras,
  Guest,
  TicketTier,
} from "./EventDetailsTab";

export { EventTodoTab, EventHistoryTab } from "./EventExtraTabs";

export { EventMessagesTab } from "./EventMessagesTab";
export type { MessagesTabParty } from "./EventMessagesTab";
export type { CrewMember } from "./EventExtraTabs";

export { EventStatusTimeline } from "./EventStatusTimeline";
export type { EventStatusStage, EventStatusTimelineProps } from "./EventStatusTimeline";

export { GroupCard } from "./GroupCard";
export type { GroupCardMember, GroupCardProps } from "./GroupCard";

export { HorizontalBarList } from "./HorizontalBarList";
export type { HorizontalBarItem, HorizontalBarListProps } from "./HorizontalBarList";

export { KpiRow } from "./KpiRow";
export type { KpiItem, KpiRowProps, KpiTone } from "./KpiRow";

export { MiniMonthCalendar } from "./MiniMonthCalendar";
export type { MiniMonthCalendarProps } from "./MiniMonthCalendar";

export { NewEventWizard } from "./NewEventWizard";
export type { NewEventWizardProps } from "./NewEventWizard";

export { PerformerSearch } from "./PerformerSearch";
export type { PerformerSearchProps, PerformerSelection } from "./PerformerSearch";

export { ProfileCard } from "./ProfileCard";
export type { ProfileCardProps, ProfileStat } from "./ProfileCard";

export { RequestCard } from "./RequestCard";
export type { RequestCardData, RequestCardProps } from "./RequestCard";

export { RevenueDeductionsEditor } from "./RevenueDeductionsEditor";
export type { EditableFigure, RevenueDeductionsEditorProps } from "./RevenueDeductionsEditor";

export { ScheduleList } from "./ScheduleList";
export type { ScheduleEntry, ScheduleListProps } from "./ScheduleList";

export { SegmentedToggle } from "./SegmentedToggle";
export type { SegmentedOption, SegmentedToggleProps } from "./SegmentedToggle";

export { SettlementStepper } from "./SettlementStepper";
export type {
  SettlementStep,
  SettlementStepperProps,
  SettlementStepState,
} from "./SettlementStepper";

export { WhoOwesWhomBoard } from "./WhoOwesWhomBoard";
export type {
  SettlementLine,
  Transfer,
  TransferState,
  WhoOwesWhomBoardProps,
} from "./WhoOwesWhomBoard";

export { LoadingState, ErrorState } from "./states";
