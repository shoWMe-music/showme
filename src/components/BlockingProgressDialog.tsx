import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface BlockingProgressDialogProps {
  open: boolean;
  title: string;
  description?: string;
}

export function BlockingProgressDialog({
  open,
  title,
  description,
}: BlockingProgressDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className={cn(
          "sm:max-w-sm [&>button]:hidden",
          "flex flex-col items-center justify-center gap-3 text-center",
          "min-h-[140px]",
        )}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <DialogTitle className="text-base font-medium">{title}</DialogTitle>
        {description ? (
          <DialogDescription className="text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
