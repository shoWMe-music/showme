/**
 * How a rider's attached document can be SHOWN. Framework-free so the choice can
 * be reasoned about (and read) on its own: the modal takes the answer and
 * renders it, it never sniffs the file itself.
 *
 * Taken from the prior app's document dialog, which learned two things the hard
 * way and both are kept here:
 *   1. The stored content type is not always trustworthy or even present
 *      (`files.content_type` is nullable, and browsers send
 *      `application/octet-stream` for plenty of real documents), so the
 *      filename's extension is the fallback rather than the first choice.
 *   2. Anything we cannot show gets an honest "unsupported", never a viewer
 *      that paints an empty rectangle and leaves the reader guessing.
 */
export type RiderPreviewKind = "pdf" | "image" | "text" | "unsupported";

/** Extensions we can show, when the content type is missing or too generic. */
const KIND_BY_EXTENSION: Record<string, RiderPreviewKind> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  txt: "text",
  csv: "text",
  md: "text",
  json: "text",
  log: "text",
};

/** `Main_Tech_Rider.PDF` → `pdf`. Empty when the name carries no extension. */
function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 1 || lastDot === fileName.length - 1) return "";
  return fileName.slice(lastDot + 1).toLowerCase();
}

/** The renderer for a rider's file — `unsupported` when we cannot show it. */
export function riderPreviewKind(file: {
  name: string;
  contentType: string | null;
}): RiderPreviewKind {
  const contentType = file.contentType?.toLowerCase() ?? "";
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("text/") || contentType === "application/json") return "text";
  return KIND_BY_EXTENSION[extensionOf(file.name)] ?? "unsupported";
}
