import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { resolveStorageDownloadUrl } from "@/lib/firebaseStorageUpload";

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName?: string;
  fileUrl?: string;
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "";
}

function isPreviewable(name: string): "pdf" | "image" | "text" | null {
  const ext = getFileExtension(name);
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["csv", "txt", "md", "json", "log", "html"].includes(ext)) return "text";
  return null;
}

export default function DocumentPreviewDialog({ open, onOpenChange, fileName, fileUrl }: DocumentPreviewDialogProps) {
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>();
  const [resolveError, setResolveError] = useState<string | null>(null);

  const isLegacyBlob = fileUrl?.startsWith("blob:");
  const previewType = fileName && !isLegacyBlob ? isPreviewable(fileName) : null;

  useEffect(() => {
    if (!fileUrl) {
      setDownloadUrl(undefined);
      setResolveError(null);
      return;
    }
    if (fileUrl.startsWith("http") || fileUrl.startsWith("blob:")) {
      setDownloadUrl(fileUrl);
      setResolveError(null);
      return;
    }
    let cancelled = false;
    setResolveError(null);
    resolveStorageDownloadUrl(fileUrl)
      .then((url) => {
        if (!cancelled) setDownloadUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDownloadUrl(undefined);
          setResolveError(err instanceof Error ? err.message : "Could not resolve file location");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  const openHref = useMemo(() => downloadUrl, [downloadUrl]);
  const loading = !!previewType && !downloadUrl && !resolveError && !isLegacyBlob;
  const error = resolveError;

  if (!fileName || !fileUrl) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <DialogDescription className="sr-only">
            Preview and download options for the selected document.
          </DialogDescription>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium flex items-center gap-2 truncate pr-4">
              <FileText className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{fileName}</span>
            </DialogTitle>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={!openHref} onClick={() => openHref && window.open(openHref, "_blank")}>
                <ExternalLink className="h-3 w-3" /> Open
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild disabled={!openHref}>
                <a href={openHref} download={fileName}>
                  <Download className="h-3 w-3" /> Download
                </a>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-muted/30">
          {loading && (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && error && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <FileText className="h-16 w-16 opacity-30" />
              <p className="text-sm">Failed to load preview: {error}</p>
              <Button variant="outline" size="sm" disabled={!openHref} onClick={() => openHref && window.open(openHref, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open in new tab
              </Button>
            </div>
          )}

          {!loading && !error && previewType === "pdf" && downloadUrl && (
            <div className="w-full h-full relative">
              <object
                data={`${downloadUrl}#toolbar=1`}
                type="application/pdf"
                className="w-full h-full border-0"
                title={`Preview of ${fileName}`}
              >
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <FileText className="h-16 w-16 opacity-30" />
                  <p className="text-sm font-medium">Inline PDF preview is blocked in this browser.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => window.open(downloadUrl, "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View PDF
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a href={downloadUrl} download={fileName}>
                        <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                      </a>
                    </Button>
                  </div>
                </div>
              </object>
            </div>
          )}

          {!loading && !error && previewType === "image" && downloadUrl && (
            <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
              <img src={downloadUrl} alt={fileName} className="max-w-full max-h-full object-contain rounded" />
            </div>
          )}

          {!loading && !error && previewType === "text" && downloadUrl && (
            <iframe
              src={downloadUrl}
              className="w-full h-full border-0 bg-background"
              title={`Preview of ${fileName}`}
              sandbox=""
            />
          )}

          {!loading && !error && !previewType && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <FileText className="h-16 w-16 opacity-30" />
              {isLegacyBlob ? (
                <>
                  <p className="text-sm font-medium">This document was uploaded before file storage was set up.</p>
                  <p className="text-xs">Please re-upload the file via Edit to enable preview.</p>
                </>
              ) : (
                <>
                  <p className="text-sm">Preview not available for this file type.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={!openHref} onClick={() => openHref && window.open(openHref, "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open in new tab
                    </Button>
                    <Button variant="outline" size="sm" asChild disabled={!openHref}>
                      <a href={openHref} download={fileName}>
                        <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                      </a>
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
