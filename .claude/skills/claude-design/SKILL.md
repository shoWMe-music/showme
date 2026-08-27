---
name: claude-design
description: How to get the EXACT UI out of a Claude Design prototype and into the app — render the prototype and read it with your eyes, never parse the HTML or build from a written spec. Use whenever a screen is meant to match the Claude Design prototype, when asked to "build it from the design", or when a build "looks nothing like the prototype". Pairs with app-walkthrough (driving our own app) and ui-testing.
---

# Building from the Claude Design prototype

**The prototype is the ground truth. A description of the prototype is not.** Every serious UI
drift in this project came from breaking that one rule — twice, in two different ways, both
recorded below with what they cost.

The prototype is not a document you read. It is an application you run.

---

## Where it is

| | |
|---|---|
| Claude Design project | `004a889b-f032-4801-8c67-df58241e9227` ("shoWMe") |
| Operator / venue screens | `claude-prototype/claude-download-2026-07-19/Prototype/shoWMe All View.dc.html` — **649,408 bytes, the complete file** |
| Public profiles | `claude-prototype/claude-download-2026-08-26/Public Profiles.dc.html` |
| Runtime | `support.js`, sitting **beside** the html — the page is dead without it |
| Assets | 20-odd UUID-named files in the same folder (fonts, images). Keep the folder intact. |

`shoWMe Home.dc.html` is only a launcher index. It is not a screen.

**There is a truncated decoy.** `claude-prototype/claude-prototype-2026-07-19-202428/Prototype/`
holds a copy of the same file that is *exactly* 262,144 bytes — 256 KiB, the read cap, cut
mid-document. It looks like the real file and opens without complaint. Check the size before you
trust any copy; 262144 exactly means you are holding a fragment.

---

## Render it. Do not read it.

The file is `<x-dc>` custom elements assembled at runtime by `support.js`, with fonts and images
referenced by bare UUID. Opening it as text gets you a font-face block and no design. It is also
2.5× the file-read cap, so you cannot read it whole even if it would help.

Two things bite immediately, and both have one-line fixes:

- **`file://` is blocked** in this Playwright setup. Serve the folder over HTTP.
- **Serve the folder, not the file** — `support.js` and every UUID asset resolve as siblings.

```bash
cd "claude-prototype/claude-download-2026-07-19/Prototype"
python3 -m http.server 8899 &
# then open http://127.0.0.1:8899/shoWMe%20All%20View.dc.html
```

Console errors on load are normal — the Google Fonts preconnects fail offline. The design still
renders correctly; do not go hunting for them.

### Switch screens by clicking the sidebar

There is no route, no hash, no `data-screen` attribute to jump to. The left-hand nav is the only
way through, and each label appears **twice** in the DOM, so click the first leaf match:

```js
const item = [...document.querySelectorAll('*')]
  .filter((el) => el.children.length === 0 && el.textContent.trim() === 'Settlements')[0];
item.click();
```

Verified nav: Dashboard · Calendar · Events · Tasks · Performance Reports · Settlements ·
Financial Projections · Incoming Requests · Bills & Invoices · Team · Contacts · Audience ·
My Profiles · Settings.

### Then take a full-page screenshot and look at it

`fullPage: true`, one per screen. **The screenshot is the specification.** Read proportions,
spacing, type scale, and which controls exist off the image — not off the DOM, and not off
anything anybody wrote down about it.

---

## The two failures this skill exists to prevent

**1. Building from a derived spec.** A subagent was asked to write `screen-specs.md` describing the
prototype, and the screens were built from that. Six came out as the wrong *feature entirely* —
Performance Reports was built as analytics when the prototype shows PRO-royalty filings derived
from setlists; Tasks was built as a to-do list when it is named work-groups; My Profiles is a full
public profile page; Settlements is a KPI row plus a payout table. The Dashboard was invented
outright. A description survives the layout and loses the intent, and the intent is the part you
cannot guess.

**2. Claiming a match without comparing.** A settlement screen was reported as matching and the
owner's reply was *"You think they look the same? To me the prototype is very different."* It was
not close: the stepper was stacked instead of inline and twice the height, connectors flexed
instead of fixed, the party cards were the wrong shape. Enumerating the differences afterwards
found seven.

So the gate is: **screenshot the prototype screen, screenshot ours, and put them side by side
before saying the word "matches".** If you have not looked at both images in the same minute, you
do not know.

---

## What to copy, and what not to

**Copy the layout exactly.** Proportions, order, spacing rhythm, which controls exist, what the
empty states say.

**Take colours and type from our design system**, not the hex the prototype inlines. They are the
same values; sourcing them from the tokens means the screen follows the palette when it moves.
`STATUS_COLOR`, `--font-display`, `--font-mono`, `--border`, `--muted` and friends.

**Never copy the prototype's data.** It is a demo: Ran Kessler, Blackbird Presents, Overmono at
Printworks, €65,000 settled. Wire the real API where the data exists; where it does not, use an
honest empty state or a disabled control. The owner's standing rule — *match the layout, wire real
data, never mock*. A screen that shows invented money is worse than a screen that admits it has
none.

**When the prototype and our design system genuinely conflict, the owner's instruction is to change
our design** rather than bend the prototype — but check that it is a real conflict first, not a
token you have not looked up.

---

## DesignSync is not the tool for this

`mcp__claude_design__*` and the DesignSync flow are for **design-system projects** — component
libraries you push and pull. They cannot fetch a 649 KB persona prototype; the read path is capped
at 256 KiB and the file is two and a half times that. Reaching for it wastes a turn and returns a
truncated file that looks whole.

Use the local download. If a newer prototype is needed, the owner exports it from Claude Design and
drops the folder into `claude-prototype/` — keep the whole folder, `support.js` and UUID assets
included.

---

## The loop, start to finish

1. Serve the Prototype folder on a local port.
2. Open the html, click to the screen you are building.
3. Full-page screenshot. **Look at it.**
4. Build it — layout from the image, colours and type from our design system, data from the real
   API or an honest empty state.
5. Run our app, navigate to the same screen, full-page screenshot.
6. **Compare the two images.** Name every difference you can see. Fix them or say plainly which
   you are leaving and why.
7. Only then is it "built from the design".

Step 6 is the one that gets skipped, and skipping it is what produced both failures above.
