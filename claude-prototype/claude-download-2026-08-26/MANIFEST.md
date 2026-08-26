# Pull — 2026-08-26 11:47

Extracted from `~/Downloads/Showme.zip` (19 MB, 139 files) on 2026-08-26.
**Only the files that were not already in the repo** are kept here, so this folder
stays small and diffable; the full zip stays in Downloads.

## What is here, and why it matters

| File | Why it was kept |
|---|---|
| `Prototype/shoWMe Logged-in UI Handoff.dc.html` | **A written build handoff for the signed-in app** — the shell, the nav matrix by account kind, §5 event workspace, **§6 Settlement detail**, §7 role surfaces, §8 the token table. Nothing like it existed in the repo before. |
| `Prototype/shoWMe Budget Planner Handoff.dc.html` | The same, for the Budget Planner. |
| `Public Profiles.dc.html` | The **source** of the public-profiles design. The copy at `~/Downloads/Public Profiles.html` is a 1.4 MB *bundled render* with no template markup; this one has the real thing. |

## What was NOT kept, and why

The four persona prototypes and `shoWMe All View.dc.html` are in this zip too, but
`shoWMe All View.dc.html` is **byte-identical (649,408 bytes) to the copy already in
`claude-download-2026-07-19/`** — verified before deciding. The design in it has not
moved since July, so a second copy would be 650 KB of noise. If a later pull differs,
keep it then.

## Reading order for the settlement screen

1. `Prototype/shoWMe Logged-in UI Handoff.dc.html` §6 — intent and the five tabs.
2. `../claude-download-2026-07-19/Prototype/shoWMe All View.dc.html` — the concrete
   layout: markup at **2564–2810**, view model at **5665–5740**, the prototype's own
   settlement maths at **4680–4707**, and the event workspace's *mini* settlement tab
   at **2551–2557** (which is what answers "tab or page?" — it is both).

§6 states the rule the API already enforces: *"one settlement row per participant,
each party seeing only their own slice."*
