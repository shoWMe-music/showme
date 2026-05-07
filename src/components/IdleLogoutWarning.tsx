import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface IdleLogoutWarningProps {
  open: boolean;
  /** Seconds remaining until forced logout. The parent counts this down. */
  secondsRemaining: number;
  onStayActive: () => void;
  onLogoutNow: () => void;
}

export function IdleLogoutWarning({
  open,
  secondsRemaining,
  onStayActive,
  onLogoutNow,
}: IdleLogoutWarningProps): JSX.Element {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You'll be signed out soon</AlertDialogTitle>
          <AlertDialogDescription>
            For your security, you'll be signed out after one hour of inactivity. You have{" "}
            <strong className={cn("font-semibold text-foreground")}>{secondsRemaining}</strong>{" "}
            seconds before automatic sign-out.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onLogoutNow}
            className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground")}
          >
            Sign out now
          </AlertDialogCancel>
          <AlertDialogAction onClick={onStayActive}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
