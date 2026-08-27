import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/touch.css";

export { Button } from "@/components/atoms/Button/Button";
export type { ButtonProps, ButtonVariant } from "@/components/atoms/Button/Button";

export { Badge } from "@/components/atoms/Badge/Badge";
export type { BadgeProps } from "@/components/atoms/Badge/Badge";

export { Chip } from "@/components/atoms/Chip/Chip";
export type { ChipProps } from "@/components/atoms/Chip/Chip";

export { Avatar } from "@/components/atoms/Avatar/Avatar";
export type { AvatarProps, AvatarTone, AvatarShape } from "@/components/atoms/Avatar/Avatar";

export { Input, SearchInput } from "@/components/atoms/Input/Input";
export type { InputProps } from "@/components/atoms/Input/Input";

export { Card } from "@/components/atoms/Card/Card";
export type { CardProps } from "@/components/atoms/Card/Card";

export { StatusDot } from "@/components/atoms/StatusDot/StatusDot";
export type { StatusDotProps } from "@/components/atoms/StatusDot/StatusDot";

export { Tag } from "@/components/atoms/Tag/Tag";
export type { TagProps } from "@/components/atoms/Tag/Tag";

export { SectionHeader } from "@/components/molecules/SectionHeader/SectionHeader";
export type { SectionHeaderProps } from "@/components/molecules/SectionHeader/SectionHeader";

export { StatCard } from "@/components/molecules/StatCard/StatCard";
export type { StatCardProps } from "@/components/molecules/StatCard/StatCard";

export { ProgressBar } from "@/components/atoms/ProgressBar/ProgressBar";
export type { ProgressBarProps } from "@/components/atoms/ProgressBar/ProgressBar";

export { Toast } from "@/components/molecules/Toast/Toast";
export type { ToastProps } from "@/components/molecules/Toast/Toast";
export { ToastProvider } from "@/components/molecules/Toast/ToastProvider";
export type { ToastProviderProps, ToastOptions, ToastPosition } from "@/components/molecules/Toast/ToastProvider";
export { useToast } from "@/components/molecules/Toast/useToast";

export { ListRow } from "@/components/molecules/ListRow/ListRow";
export type { ListRowProps } from "@/components/molecules/ListRow/ListRow";

export { SidebarItem } from "@/components/molecules/SidebarItem/SidebarItem";
export type { SidebarItemProps } from "@/components/molecules/SidebarItem/SidebarItem";

export { KeyValueRow } from "@/components/molecules/KeyValueRow/KeyValueRow";
export type { KeyValueRowProps } from "@/components/molecules/KeyValueRow/KeyValueRow";

export { EmptyState } from "@/components/molecules/EmptyState/EmptyState";
export type { EmptyStateProps } from "@/components/molecules/EmptyState/EmptyState";

export { Modal } from "@/components/molecules/Modal/Modal";
export type { ModalProps } from "@/components/molecules/Modal/Modal";

export { Tabs } from "@/components/molecules/Tabs/Tabs";
export type { TabsProps, TabItem } from "@/components/molecules/Tabs/Tabs";
export { TabPanels } from "@/components/molecules/Tabs/TabPanels";
export type { TabPanelsProps } from "@/components/molecules/Tabs/TabPanels";
export { useTabPanelMotion } from "@/components/molecules/Tabs/useTabPanelMotion";

export { Toggle } from "@/components/atoms/Toggle/Toggle";
export type { ToggleProps } from "@/components/atoms/Toggle/Toggle";

export { Checkbox } from "@/components/atoms/Checkbox/Checkbox";
export type { CheckboxProps } from "@/components/atoms/Checkbox/Checkbox";

export { TextField } from "@/components/atoms/TextField/TextField";
export type { TextFieldProps } from "@/components/atoms/TextField/TextField";
export { NumberField } from "@/components/atoms/NumberField/NumberField";
export type { NumberFieldProps } from "@/components/atoms/NumberField/NumberField";
export {
  formatNumberFieldValue,
  parseNumberFieldText,
} from "@/components/atoms/NumberField/useNumberField";
export { Select } from "@/components/atoms/Select/Select";
export type { SelectProps, SelectOption } from "@/components/atoms/Select/Select";

export { Stepper } from "@/components/molecules/Stepper/Stepper";
export type { StepperProps } from "@/components/molecules/Stepper/Stepper";

export { SelectCard } from "@/components/molecules/SelectCard/SelectCard";
export type { SelectCardProps } from "@/components/molecules/SelectCard/SelectCard";

export { TodoItem } from "@/components/molecules/TodoItem/TodoItem";
export type { TodoItemProps } from "@/components/molecules/TodoItem/TodoItem";

export { ContactCard } from "@/components/organisms/ContactCard/ContactCard";
export type { ContactCardProps } from "@/components/organisms/ContactCard/ContactCard";

export { DataTable } from "@/components/organisms/DataTable/DataTable";
export type { DataTableProps, DataTableColumn } from "@/components/organisms/DataTable/DataTable";

export { Skeleton } from "@/components/atoms/Skeleton/Skeleton";
export type { SkeletonProps } from "@/components/atoms/Skeleton/Skeleton";

export { Spinner } from "@/components/atoms/Spinner/Spinner";
export type { SpinnerProps } from "@/components/atoms/Spinner/Spinner";

export { Icon } from "@/icons";
export type { IconName, IconProps } from "@/icons";

export { STATUSES, STATUS_LABEL, STATUS_COLOR } from "@/lib/status";
export type { Status } from "@/lib/status";

/* ── Layout ──
   The breakpoint scale, mirroring the `--breakpoint-*` tokens. Values only —
   a media query cannot read a custom property, so JS reads these instead. */
export { BREAKPOINTS, atMost } from "@/lib/breakpoints";

/* ── Motion ──
   The vocabulary every animated surface in the app is built from: the four
   durations + the easings (mirrors of the `--duration-*` / `--ease-*` tokens),
   the reduced-motion reader, and the screen entrance for router outlets. */
export { DURATION, EASE } from "@/lib/motion";
export { useReducedMotion } from "@/lib/useReducedMotion";
export { useViewMotion } from "@/lib/useViewMotion";
