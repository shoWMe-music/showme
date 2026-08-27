/**
 * One picture, resolved down the ladder the schema defines.
 *
 * Two things can name a picture — an uploaded FILE (`*_file_id`, bytes in a
 * profile's own storage folder) and a plain external ADDRESS (`*_url`) — and the
 * rule between them is the same wherever the pair appears: the file wins, and an
 * uploaded file whose row has gone resolves to nothing rather than to a bucket
 * path nobody can open.
 *
 * It lives in its own module because that rule now governs three things (a
 * profile's avatar, its banner, and a show's poster) across two serializers. Two
 * copies of a four-line ladder is two chances for them to disagree about what a
 * missing file means — and the day they did, one surface would render a broken
 * image while the other rendered none.
 *
 * `imageUrls` is `fileId → signed URL`, minted per response by the route that
 * loaded the row (`signProfileImageUrls`). It is never stored: a signed URL
 * expires in fifteen minutes.
 */
export function resolveImageUrl(
  fileId: string | null,
  url: string | null,
  imageUrls?: Map<string, string>,
): string | null {
  if (fileId) return imageUrls?.get(fileId) ?? null;
  return url;
}
