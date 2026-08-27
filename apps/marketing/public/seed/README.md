# Seed artwork

Pictures for the SEEDED profiles (`packages/db/src/seed.ts` and `seed-e2e.ts`), so a
local run of the public profile page shows what the design looks like with a cover,
a logo and a gallery in it — instead of an empty hero.

**These are fixtures, not product assets.** They are drawn here as SVG rather than
photographed for three reasons: they are a few kB, they work with no network, and
nothing on this site may fetch a third-party image (the same rule that self-hosts
the fonts). They are deliberately abstract — light, haze and silhouette — so nobody
mistakes one for a real venue's photograph.

The seed points `profiles.banner_url` / `avatar_url` and the `profile_media` gallery
rows at these files, through `PUBLIC_SITE_URL` (default `http://localhost:5173`).
An owner's REAL picture is an upload: `avatar_file_id` / `banner_file_id`, bytes in
the profile's own storage folder, served through a signed URL. The URL columns are
the other half of that ladder — an address someone else hosts — which is what makes
them usable from a seed at all.
