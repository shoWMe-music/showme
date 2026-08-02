# claude-prototype — dated pulls of the Claude Design project

Each time the shoWMe design is pulled down from the Claude Design project
(`004a889b-f032-4801-8c67-df58241e9227`), it is saved here as a **new,
timestamped folder** — never overwriting a previous pull. This gives a version
history of the design/prototype over time.

## Naming

```
claude-prototype/
  claude-prototype-<YYYY-MM-DD-HHMMSS>/   ← one folder per pull
    MANIFEST.md                           ← what/when/how for that pull
    Prototype/*.dc.html                   ← the persona prototypes + runtime
    _work/*                               ← shared tokens + dc-runtime
    shoWMe Design System.dc.html
    shoWMe Home.dc.html                   ← open this as the entry point
    CLAUDE.md
```

The timestamp is the local time of the pull (e.g. `claude-prototype-2026-07-19-202428`).

## Pulls

| Pulled | Folder | Notes |
|---|---|---|
| 2026-07-19 20:24:28 | `claude-prototype-2026-07-19-202428/` | First pull. Design source (text) only. ⚠️ 4 persona prototypes + `template.html` are **truncated at 256 KiB** (the design MCP's per-file cap — they exceed it). Fonts/screenshots/uploads excluded. See its MANIFEST. |

> **Known limitation:** the `claude_design` `get_file` API caps each file at
> **256 KiB**. The persona prototype `.dc.html` files are larger, so they can't
> be pulled complete through this tool. Each pull's MANIFEST flags which files
> are truncated.

## What a pull contains

The **design source**: the interactive `.dc.html` prototypes for each persona
(Operator / Performer / Crew / Agent), the shared token CSS, and the Design
Composer runtime. Binary assets (fonts, screenshots) are excluded by default to
keep each dated snapshot lean and diffable — they're listed in each pull's
`MANIFEST.md` and can be included on request.

## Comparing pulls

Because each pull is a self-contained folder of text files, you can diff two
pulls directly:

```bash
diff -ru claude-prototype-<old>/ claude-prototype-<new>/
```

## Related

- `../design-system/` — the maintained React + Storybook component library built
  from this design (the source of truth for building the app).
- `../PLAN.md`, `../docs/` — the rebuild blueprint the design serves.
