import { describe, expect, it } from "vitest";
import { isEmbeddableVideoLink, parseVideoLink } from "./video";

/**
 * The forms people actually paste. Each one is a real share-sheet or address-bar
 * output, not an invented shape — the parser exists because the previous regex
 * silently dropped half of them onto a bare link.
 */
describe("parseVideoLink — YouTube", () => {
  const cases: [string, string][] = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc123", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    // No scheme — what a share sheet leaves on the clipboard.
    ["youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ];

  for (const [input, videoId] of cases) {
    it(`reads ${input}`, () => {
      const link = parseVideoLink(input);
      expect(link).not.toBeNull();
      expect(link?.provider).toBe("youtube");
      expect(link?.videoId).toBe(videoId);
    });
  }

  it("embeds through youtube-nocookie and canonicalizes the watch URL", () => {
    const link = parseVideoLink("https://youtu.be/dQw4w9WgXcQ?si=xyz");
    expect(link?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(link?.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("refuses a watch URL with no video id", () => {
    expect(parseVideoLink("https://www.youtube.com/watch")).toBeNull();
    expect(parseVideoLink("https://www.youtube.com/watch?v=")).toBeNull();
  });

  it("refuses a channel page — it is not a video", () => {
    expect(parseVideoLink("https://www.youtube.com/@somebody")).toBeNull();
    expect(parseVideoLink("https://www.youtube.com/results?search_query=x")).toBeNull();
  });
});

describe("parseVideoLink — Vimeo", () => {
  it("reads a plain vimeo.com/<id>", () => {
    const link = parseVideoLink("https://vimeo.com/347119375");
    expect(link?.provider).toBe("vimeo");
    expect(link?.videoId).toBe("347119375");
    expect(link?.embedUrl).toBe("https://player.vimeo.com/video/347119375");
  });

  it("reads the player URL — the form the OLD regex dropped", () => {
    const link = parseVideoLink("https://player.vimeo.com/video/347119375");
    expect(link?.videoId).toBe("347119375");
    expect(link?.embedUrl).toBe("https://player.vimeo.com/video/347119375");
  });

  it("reads a channel URL", () => {
    expect(parseVideoLink("https://vimeo.com/channels/staffpicks/347119375")?.videoId).toBe(
      "347119375",
    );
  });

  it("carries the unlisted privacy hash into the embed", () => {
    const link = parseVideoLink("https://vimeo.com/347119375/a1b2c3d4e5");
    expect(link?.privacyHash).toBe("a1b2c3d4e5");
    expect(link?.embedUrl).toBe("https://player.vimeo.com/video/347119375?h=a1b2c3d4e5");
    expect(link?.canonicalUrl).toBe("https://vimeo.com/347119375/a1b2c3d4e5");
  });

  it("reads the hash from ?h= as the player writes it", () => {
    const link = parseVideoLink("https://player.vimeo.com/video/347119375?h=a1b2c3d4e5");
    expect(link?.embedUrl).toBe("https://player.vimeo.com/video/347119375?h=a1b2c3d4e5");
  });

  it("refuses a vimeo page that names no video", () => {
    expect(parseVideoLink("https://vimeo.com/somebody")).toBeNull();
  });
});

describe("parseVideoLink — what it refuses", () => {
  const refused = [
    "",
    "   ",
    "not a url",
    "https://example.com/video.mp4",
    "https://dailymotion.com/video/x8abcd",
    // The injection the old substring regex allowed: a hostile host that merely
    // CONTAINS the provider's name in its path.
    "https://attacker.example/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
  ];

  for (const input of refused) {
    it(`refuses ${JSON.stringify(input)}`, () => {
      expect(parseVideoLink(input)).toBeNull();
      expect(isEmbeddableVideoLink(input)).toBe(false);
    });
  }

  it("never lets a pasted string reach the embed URL", () => {
    // Whatever survives parsing, the embed is rebuilt from an id that can only
    // contain id characters — so there is nothing left to smuggle.
    const link = parseVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>');
    expect(link).toBeNull();
  });
});
