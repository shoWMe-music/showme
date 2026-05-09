import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

interface PublicShareWarningModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  pending?: boolean;
}

export function PublicShareWarningModal({ open, onOpenChange, onConfirm, pending }: PublicShareWarningModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset the acknowledgement each time the dialog reopens so a previous
  // confirmation can never silently arm the next public share.
  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Anyone with the link will be able to view this
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            A public link has no recipient list and no sign-in. Anyone who receives the URL —
            forwarded, screenshotted, or shared on social media — can open it and see whatever
            sections you included.
          </p>
          <p>
            This may include financial figures, personal contact details, signed agreements,
            and other information you would not normally publish. Search engines and other
            third parties may also index the page.
          </p>
          <p>
            You alone are responsible for what you choose to expose. shoWMe cannot recall a link
            once it has been shared and is not liable for misuse, leaks, indexing, or any
            consequences that follow from making this data public.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <Checkbox
            id="public-share-ack"
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
          />
          <Label htmlFor="public-share-ack" className="text-xs leading-snug cursor-pointer">
            I take responsibility for the information I am about to share publicly.
          </Label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={!acknowledged || pending}
          >
            {pending ? "Creating..." : "I understand — create public link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
