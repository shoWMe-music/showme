# shoWMe style guide

The rules a screen is judged against. Where this and a component disagree, the
component is wrong. Where this and the design prototype disagree, ask — the
prototype is the source for layout, this is the source for how surfaces behave.

Tokens live in `src/styles/tokens.css`. **Nothing invents a colour, a radius, a
duration or a height.** If you need one that does not exist, add it there with a
sentence saying why, or say in your report that it is missing — do not write a
literal into a component.

---

## 1 · Light mode is white. Only white.

**A surface is `#FFFFFF`.** Cards, panels, popovers, modals, toasts, inputs,
sheets — all of them. There is no second surface colour, no tinted panel, no
"slightly warmer" inset. A screen in light mode is white shapes on the page
ground, separated by rules and space.

The only exception is the **page ground itself** (`--bg`, a warm beige) and the
grid and glow drawn on it. That is the layer everything sits *on*; it is never
the layer anything sits *in*.

**Why:** a tinted panel inside a white card reads as dirt, not as depth. Every
time this codebase reached for an off-white — `#FFFDF9` for surfaces, `#FFF9EF`
for insets — the result was a box that looked soiled rather than raised. Depth
in light mode comes from a border and from space, never from a fill.

Consequences, all of which are load-bearing:

- **No shadow between two white surfaces.** A card nested in a card drops its
  shadow in light mode (`Card.module.css`); white-on-white shadow is a smudge,
  not depth. Dark keeps its shadows — there, they are most of what separates
  surfaces.
- **A grouped block is a rule, not a box.** When a set of fields belongs together
  inside a card, separate it with a `1px solid var(--border)` and spacing. Do not
  give it a ground of its own.
- **An inset is not a surface.** `--elevated` exists for small *shapes* that must
  be visible against white — a toggle track, a skeleton, a stepper rail, a
  progress trough. It is **never** a panel background. If you are reaching for it
  to fill a region a user reads content in, you want white and a border.

## 2 · Hover and selection are the orange border.

**Interaction is expressed on the edge, not the ground.**

| state | treatment |
|---|---|
| rest | `--control-border` (light: brand coral, tempered) or `--border` for non-controls |
| hover | `--hover-border` — the same hue, one step firmer |
| selected / active | brand border, and brand text where there is text |
| focus | full-strength `--brand-red`, and a second signal that is not colour (weight) |

**No background tint on hover.** A hovered row should look *reachable*, not
*chosen* — and if hover fills the ground, selection has nowhere left to go, so
the two collide. This is why `--hover-surface` is transparent in light mode.

**A hover must promote, never demote.** Hovering walks the edge *toward* the
focus colour, never away from it toward a neutral. Getting this backwards — a
coral rest state hovering to a brown — makes the control look like it switched
off when you approached it.

**Focus cannot rely on colour alone.** Whatever carries focus must also change
weight, thickness or position, so that someone who cannot separate two reds can
still see where they are.

## 3 · One height for every control.

`--control-height` (40px) and `--control-line-height`. Every text field, number
field, select and search input wears it, whatever its content — a `type="number"`
line box and a mono font are both taller than plain text by default, and the
result was three heights for the same component across one form.

**Never set a control height in a component.** If a control needs to be shorter
(an inline editor inside a table row), it is a different control and it says so
by name, not by overriding the token locally.

Fields on one row line up on their **right edge** as well as their height, so a
column of values scans vertically.

## 4 · Motion is felt, not noticed.

`--duration-instant` (90ms, the press) · `--duration-quick` (140ms, a **paint**:
colour, border, a menu opening under its own trigger) · `--duration-base` (200ms,
something **moves**; also the interaction ceiling) · `--duration-slow` (280ms, a
surface arriving: modal, toast, view).

The split is **paint versus movement**, not fast versus slow. When one control
does both — a toggle repaints its track and moves its knob — the whole thing
takes the movement duration so the parts land together.

- Nothing above ~250ms for an interaction response.
- **Motion never gates input.** No `visibility: hidden` on an entering panel; no
  control that is unclickable while it arrives.
- `prefers-reduced-motion` collapses the duration tokens themselves, so anything
  token-built obeys it automatically. **A hand-written `.3s` does not.** That is a
  second reason to use the tokens.

## 5 · Entering an editing state moves nothing.

An inline editor occupies exactly the footprint of the value it replaced — same
height, same baseline, same right edge. The editing affordance is the row's own
hairline **promoted**, not a box drawn around the value.

If a hint, an error or a confirm control has to appear, it **floats**; it does
not push the layout. A card whose rows shift when you click one is the single
most common way inline editing goes wrong.

## 6 · Nothing hand-rolls what the system has.

A local `fieldStyle`, a private clipboard helper, a second money formatter, a
fourth overflow menu — each is a divergence that will drift, and each has drifted
here already. Compose the design-system component. If it genuinely cannot be
composed (a combobox wrapping a bare `<input>`), it must still read its **tokens**
from the system so it follows the theme rather than shadowing it.

## 7 · No dead affordances.

A control that does nothing is worse than an absent one: it spends the reader's
trust. If it cannot be wired in this pass, leave it out and write down why. This
has been reported by real users of this product more than once.

An empty value is not an excuse for an invisible control — an empty editable
field still needs a placeholder that names what is missing and stays clickable.
