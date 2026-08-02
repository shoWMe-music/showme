# Pull manifest

- **Pulled:** 2026-07-19 20:24:28 (local)
- **Source:** Claude Design project `004a889b-f032-4801-8c67-df58241e9227` ("Validation request", owner: Daniel)
- **Method:** `claude_design` MCP (`DesignSync` → `get_file`), via the shoWMe-2026 repo.
- **Scope of this snapshot:** the **design source** — the interactive `.dc.html` prototypes, the shared CSS/JS runtime, and the project's `CLAUDE.md`. Binary assets (fonts, screenshots) are intentionally **not** duplicated into each dated pull — see "Excluded" and the versioning note in `../README.md`.

## ⚠️ Tool limitation — 5 files are truncated

The `claude_design` MCP's `get_file` **caps every file at 256 KiB**. Five files
in this project exceed that, so they were returned **cut off at ~256 KiB**
(mid-markup, no closing `</x-dc></html>`). They cannot be pulled complete with
the current tool. See the Fidelity column.

## Included (13 files)

| Path | What it is | Fidelity |
|---|---|---|
| `Prototype/shoWMe Agent.dc.html` | Agent persona prototype | **TRUNCATED @ 256 KiB** (tail missing) |
| `Prototype/shoWMe Performer.dc.html` | Performer persona prototype | **TRUNCATED @ 256 KiB** |
| `Prototype/shoWMe Crew.dc.html` | Professional/Crew persona prototype | **TRUNCATED @ 256 KiB** |
| `Prototype/shoWMe All View.dc.html` | Operator ("full app") prototype | **TRUNCATED @ 256 KiB** |
| `_work/template.html` | DC document template scaffold | **TRUNCATED @ 256 KiB** |
| `Prototype/support.js` | Design Composer runtime (dc-runtime) | full (63 KiB) |
| `shoWMe Design System.dc.html` | Token + component catalog page | full |
| `shoWMe Home.dc.html` | Project index / persona launcher | full |
| `support.js` | dc-runtime (root copy) | full (63 KiB) |
| `_work/app.js` | dc-runtime build | full (63 KiB) |
| `_work/theme.css` | App semantic tokens (dark + light) | full |
| `_work/head-style.css` | Landing tokens + base | tokens full; landing-only component CSS + repeated `@font-face` blocks trimmed (noted inline) |
| `CLAUDE.md` | Project context + rebuild blueprint (as stored in the design project) | full |

Because the 4 persona prototypes are truncated, they will **not render** as-is
(the runtime needs the closing tags). Use them for reference/diffing of the
captured portion. The componentized, complete design lives in
`../../design-system/`.

## Excluded from this pull (available on request — re-pull to add)

- **`Prototype/shoWMe Prototype.dc.html`** — the "Original Prototype" backup (a duplicate of the full operator app, kept as a reference backup in the project).
- **Fonts** — 17 `woff2` blobs under `Prototype/` (Inter Tight, JetBrains Mono, Instrument Serif subsets), referenced by UUID from the `.dc.html` `@font-face` rules. Without them the persona prototypes fall back to system fonts; the Design System + Home pages load fonts from the Google/Fontshare CDN and are unaffected.
- **`screenshots/`** — 16 QA capture PNGs (dev artifacts, not design source).
- **`uploads/`** — the project's uploaded docs (`decisions.md`, `story.md`, `payments.md`, etc.) — these already live in this repo's `docs/` — plus `shoWMe App.html` and a few pasted images.

## Notes

- The `.dc.html` files use Design Composer's template syntax (`<x-dc>`, `{{ }}`, `<sc-if>`, `<sc-for>`); they render via `support.js` (which loads React from a CDN). Open `shoWMe Home.dc.html` as the entry point.
- The maintained, componentized version of this design lives in `../../design-system/` (React + Storybook), which is the source of truth for building. This snapshot is an archival copy of the *design*, for version history.

## Re-pulling (to refresh or add the excluded assets)

Ask for a new pull; it lands in a sibling `claude-prototype-<new-timestamp>/` folder (pulls are never overwritten). To include the excluded assets in a pull, say so — e.g. "pull with fonts + backup prototype".
