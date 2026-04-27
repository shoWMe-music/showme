import { useState, useEffect, useMemo } from "react";
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

function isPreviewable(name: string): "pdf" | "image" | null {
  const ext = getFileExtension(name);
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  return null;
}

export default function DocumentPreviewDialog({ open, onOpenChange, fileName, fileUrl }: DocumentPreviewDialogProps) {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>();

  const isLegacyBlob = fileUrl?.startsWith("blob:");
  const previewType = fileName && !isLegacyBlob ? isPreviewable(fileName) : null;

  useEffect(() => {
    if (!fileUrl) {
      setDownloadUrl(undefined);
      return;
    }
    if (fileUrl.startsWith("http") || fileUrl.startsWith("blob:")) {
      setDownloadUrl(fileUrl);
      return;
    }
    let cancelled = false;
    resolveStorageDownloadUrl(fileUrl)
      .then((url) => {
        if (!cancelled) setDownloadUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDownloadUrl(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!open || !previewType || isLegacyBlob) {
      setBlobSrc(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!downloadUrl) {
      setLoading(true);
      setError(null);
      setBlobSrc(null);
      return;
    }

    let cancelled = false;
    let revokeUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobSrc(null);

    const loadFile = async () => {
      try {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const blob = await res.blob();

        const ext = getFileExtension(fileName || "");
        const mimeMap: Record<string, string> = {
          pdf: "application/pdf",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
        };
        const expectedMime = mimeMap[ext] || blob.type;
        const typedBlob = new Blob([blob], { type: expectedMime });

        if (cancelled) return;
        const url = URL.createObjectURL(typedBlob);
        revokeUrl = url;
        setBlobSrc(url);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadFile();

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [open, downloadUrl, previewType, isLegacyBlob, fileName]);

  const openHref = useMemo(() => downloadUrl, [downloadUrl]);

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

          {!loading && !error && previewType === "pdf" && blobSrc && (
            <div className="w-full h-full relative">
              <object
                data={`${blobSrc}#toolbar=1`}
                type="application/pdf"
                className="w-full h-full border-0"
                title={`Preview of ${fileName}`}
              >
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <FileText className="h-16 w-16 opacity-30" />
                  <p className="text-sm font-medium">PDF loaded successfully</p>
                  <p className="text-xs text-muted-foreground">Inline preview may be blocked in this environment.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => window.open(blobSrc, "_blank")}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View PDF
                    </Button>
                    <Button variant="outline" size="sm" disabled={!openHref} onClick={() => openHref && window.open(openHref, "_blank")}>
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                    </Button>
                  </div>
                </div>
              </object>
            </div>
          )}

          {!loading && !error && previewType === "image" && blobSrc && (
            <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
              <img src={blobSrc} alt={fileName} className="max-w-full max-h-full object-contain rounded" />
            </div>
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
