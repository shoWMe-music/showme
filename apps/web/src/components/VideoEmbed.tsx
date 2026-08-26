import type { VideoLink } from "@showme/shared";

/**
 * A YouTube or Vimeo video, playing where it is written.
 *
 * The `src` is `link.embedUrl` — a string `parseVideoLink` BUILT from a provider
 * and an id, never the address the owner pasted. That is the whole security
 * argument: an iframe whose `src` comes from user input is somebody else's
 * document running inside our page, and this component is only ever handed a
 * parsed link, so there is no path from a pasted string to this attribute.
 *
 * The attributes are the restrictive set on purpose:
 *   `referrerPolicy`  the player learns it was embedded, not by whom — a venue's
 *                     private preview URL is nobody's business but theirs;
 *   `allow`           only what a video needs. No camera, no microphone, no
 *                     geolocation, no payment;
 *   `loading="lazy"`  a gallery of six videos should not be six players' worth
 *                     of network before the page is even scrolled.
 *
 * It exists as one component because these attributes have to be identical in
 * the editor's preview and on the public page. Two copies would drift, and the
 * copy that drifts is the one nobody is looking at.
 */
export function VideoEmbed({ link, title }: { link: VideoLink; title: string }) {
  return (
    <iframe
      src={link.embedUrl}
      title={title}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        display: "block",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
      }}
    />
  );
}
