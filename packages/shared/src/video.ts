/**
 * Video links on a profile — parsed, never trusted.
 *
 * A profile's videos are pasted by their owner and end up as an `<iframe src>`
 * on a page strangers read. That makes the string a security boundary rather
 * than a formatting problem: an arbitrary URL in an iframe is somebody else's
 * document running inside our page. So this module never passes a pasted URL
 * through. It reduces the link to a provider and an id, and BUILDS the embed URL
 * from that id. Anything it cannot reduce is refused — the caller shows the
 * refusal, never a fallback iframe.
 *
 * The same function runs on the server (the profile PATCH validates with it, so
 * what is stored is already canonical) and in both browsers that draw a profile
 * (the app's Preview and the public page). One parser, so a link that saves is a
 * link that plays.
 *
 * WHY ONLY YOUTUBE AND VIMEO: they are the two an act's press kit actually uses,
 * and both publish a stable, id-addressed embed endpoint. A provider without one
 * cannot be embedded safely, and "embed anything" is the vulnerability itself.
 */

export type VideoProvider = "youtube" | "vimeo";

export interface VideoLink {
  provider: VideoProvider;
  /** The provider's own id — the only part of the pasted URL that survives. */
  videoId: string;
  /**
   * Vimeo's unlisted-video hash (`vimeo.com/<id>/<hash>`), when the link carried
   * one. Without it an unlisted video answers 404 to the embed, so an act's
   * private-link showreel would save and then refuse to play.
   */
  privacyHash: string | null;
  /** The page the video lives on — what gets STORED, and where "watch" points. */
  canonicalUrl: string;
  /** The iframe `src`, assembled from the id. Never the pasted string. */
  embedUrl: string;
}

/** What a caller says when `parseVideoLink` refuses: one sentence, one fix. */
export const VIDEO_LINK_REJECTION =
  "Only YouTube and Vimeo links can be embedded — e.g. https://youtube.com/watch?v=… or https://vimeo.com/…";

/** YouTube ids are 11 characters today; the range is loose enough to outlive that. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,24}$/;
const VIMEO_ID = /^\d{5,15}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{4,32}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

/** The paths YouTube addresses one video by, beyond `/watch?v=`. */
const YOUTUBE_PATH_PREFIXES = ["embed", "shorts", "live", "v"];

/**
 * Vimeo's containers — a channel, a group, a showcase, the dashboard. Each one
 * sits IN FRONT of the id in the path and tells us nothing, so they are dropped
 * before the number is read.
 */
const VIMEO_CONTAINER_SEGMENTS = [
  "channels",
  "groups",
  "album",
  "showcase",
  "manage",
  "video",
  "videos",
];

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter((segment) => segment !== "");
}

function youtubeLink(videoId: string): VideoLink {
  return {
    provider: "youtube",
    videoId,
    privacyHash: null,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    // `-nocookie` is the same player without the tracking cookie a visitor to a
    // venue's page never agreed to.
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
}

function vimeoLink(videoId: string, privacyHash: string | null): VideoLink {
  return {
    provider: "vimeo",
    videoId,
    privacyHash,
    canonicalUrl: `https://vimeo.com/${videoId}${privacyHash ? `/${privacyHash}` : ""}`,
    embedUrl: `https://player.vimeo.com/video/${videoId}${privacyHash ? `?h=${privacyHash}` : ""}`,
  };
}

function parseYoutube(url: URL): VideoLink | null {
  const segments = pathSegments(url);
  if (YOUTUBE_SHORT_HOSTS.has(url.hostname.toLowerCase())) {
    const [videoId] = segments;
    return videoId && YOUTUBE_ID.test(videoId) ? youtubeLink(videoId) : null;
  }
  if (segments[0] === "watch") {
    const videoId = url.searchParams.get("v");
    return videoId && YOUTUBE_ID.test(videoId) ? youtubeLink(videoId) : null;
  }
  const [prefix, videoId] = segments;
  if (prefix && videoId && YOUTUBE_PATH_PREFIXES.includes(prefix) && YOUTUBE_ID.test(videoId)) {
    return youtubeLink(videoId);
  }
  return null;
}

function parseVimeo(url: URL): VideoLink | null {
  const segments = pathSegments(url).filter(
    (segment) => !VIMEO_CONTAINER_SEGMENTS.includes(segment),
  );
  const idIndex = segments.findIndex((segment) => VIMEO_ID.test(segment));
  const videoId = idIndex === -1 ? undefined : segments[idIndex];
  if (!videoId) return null;
  const candidateHash = segments[idIndex + 1] ?? url.searchParams.get("h");
  const privacyHash = candidateHash && VIMEO_HASH.test(candidateHash) ? candidateHash : null;
  return vimeoLink(videoId, privacyHash);
}

/**
 * The pasted string reduced to a provider and an id, or `null` when it is
 * neither a YouTube nor a Vimeo video.
 *
 * Host matching is EXACT against a set. A substring or regex test — which is
 * what this replaced — accepts `https://attacker.example/youtube.com/watch?v=x`
 * as a YouTube link.
 */
export function parseVideoLink(value: string): VideoLink | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  // A bare "youtu.be/xyz" is what a share sheet puts on the clipboard; give it
  // the scheme it is missing rather than refusing on a technicality.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host) || YOUTUBE_SHORT_HOSTS.has(host)) return parseYoutube(url);
  if (VIMEO_HOSTS.has(host)) return parseVimeo(url);
  return null;
}

/** True when this link can be embedded — the predicate a Zod `.refine` wants. */
export function isEmbeddableVideoLink(value: string): boolean {
  return parseVideoLink(value) !== null;
}
