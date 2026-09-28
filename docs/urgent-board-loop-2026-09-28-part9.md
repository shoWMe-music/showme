# Urgent board loop — 2026-09-28, part 9

Continues `-part8.md`, which crossed midnight. **Dated to today** rather than carrying the
27th forward again: the audit and the sweeps are the 27th's, the work below is the 28th's, and
a file that claims a date it was not written on is the thing `CLAUDE.md` warns about.

Same standing instruction; same rules. Nothing deployed, nothing written to ClickUp.

---

## QA sweep run 6 — all seven verification checks hold

Run 6 (`docs/qa-sweep-2026-09-27-run6.md`, 913 lines) re-drove everything this loop landed
since run 5 and every one of the seven passed, including both halves of QA5-2, all three
statements of QA5-1, the hold-queue rank, and the QA5-4 correction — the venue picker is
there, and the agent placed a hold **4th in a queue of three** with it. It also confirmed
QA5-1's fix on the co-host's own single-line view, where the caption correctly still reads
*"Your own line."*

New: **4 MAJOR · 10 MINOR · 2 NOTE · 4 COSMETIC**. Two are fixed below.

---

## `QA6-17` — every invoice the app writes is denominated in EUR

**Verdict: real, and the same file had already learned this lesson at a surface that only
displayed it.** The file that settles it: `apps/web/src/routes/Invoices.tsx`.

```
select issuer_ref,total,currency from invoices order by issued_at desc limit 1
→ QA6 Sound Rentals AB | 250000 | EUR
```

on an account whose Settings → General reads `BASE CURRENCY SEK` and whose every event, deal,
budget and settlement is SEK. Two lines, twenty apart: `useState("EUR")` and
`currency.trim().toUpperCase() || "EUR"`. It survived a hard reload, because the wrong
currency was never session state — it was the default.

**What makes it a major rather than a default nobody minds.** 190 lines above, the KPI strip
carries the fix for exactly this, made on 2026-09-26:

> **NO INVOICES MEANS NO CURRENCY TO NAME — not EUR.** … *Zero in the wrong currency is a
> statement about their money that happens to be false.*

The tiles were fixed and the create form was not — and unlike the tiles, the form does not
merely show the wrong symbol, it **stores** it.

### Scope, and a second fault found on the way

`invoiceAmountDraft` (pure, in `components/invoiceDocument.ts`, seven tests) owns both rules,
and both **refuse** rather than guess:

- **No currency is not EUR.** `GET /me` carries the account's chosen currency; the field seeds
  from it, and an account that has never chosen one cannot submit — the field says why.
- **An unknown code is not a currency.** `majorToMinor` asks `currencyExponent`, which throws.

The second fault, in the same three lines: `Math.round(Number(amount) * 100)` is a **float
multiplication on money**, which `docs/money.md` forbids, over a **hard-coded exponent of 2** —
so ¥2,500 would have been stored as ¥250,000. `majorToMinor` parses the decimal string and asks
the currency. `isCurrencyCode` is new in `@showme/shared`, beside `currencyExponent` as the
guard that makes it safe to call, mirroring `isCountryCode`.

*The decision it hides:* none — the KPI comment above already settled what to do about an
account with no currency. This is the form catching up with it.

`TextField` gained a `hint` prop for the refusal, copied prop-for-prop from `TagInput`, which
already has one. One caller today, which normally argues against a shared prop — but the
alternative is a hand-rolled 12px muted span in one screen, and the two sibling text atoms
disagreeing is the divergence the review gate names. It is also wired through
`aria-describedby`, so the reason reaches a screen reader rather than only a disabled button.

### Proven on the running stack

Five mutations of `invoiceAmountDraft`, **all red on the first pass** (drop the no-currency
rule, drop the unknown-currency rule, go back to `× 100`, accept any amount, stop normalising
the code). Then in the browser as `operator@`: the CURRENCY field pre-fills **SEK**, typing
`XYZ` disables **Create invoice** and shows *"XYZ isn't a currency we know."*, and the two bills
sit side by side in Postgres:

```
QA6 Sound Rentals AB     | 250000 | EUR    ← the sweep's, before
QA6-17 Sound Rentals AB  | 250000 | SEK    ← mine, after
```

---

## `QA6-2` — moving the night rang one bell, and it belonged to the person who asked

**Verdict: real, and structural rather than an oversight.** The file that settles it:
`apps/api/src/lib/event-change-requests.ts`.

Changing a show's capacity wrote **five** `event.updated` notifications. Moving its date wrote
**one**, to the proposer. The negotiated fields (`eventDate`, `venueProfileId`, `stageId`) are
stripped out of the ordinary PATCH and applied by `answerChangeRequest` instead, so they never
reach the `eventChangeNotice` call in `routes/events.ts` that tells the bill about an edit —
and the only notifier on that path was a function called `notifyProposer`.

**The sweep's own correction is worth keeping:** the bill *is* told, in the Everyone thread, and
the crew member does see both messages. What was missing is the **bell**, and the finding
survives as the asymmetry — five bells for a capacity, one for the night itself.

### Scope, and who is deliberately left out

`notifyBillChangeApplied` sends the same `eventChangeNotice` the ordinary edit sends, on the
path that applies a negotiated change. Two people do not get it, both because they already hold
a better message:

| | Why |
|---|---|
| the **actor** who confirmed last | `eventParticipantRecipients` drops them, exactly as the ordinary edit drops whoever saved |
| the **proposer** | `notifyProposer` already tells them *"the date moved — everyone agreed"*; a second bell reading *"the date changed"* underneath it is noise on top of the message that mattered, which is the rule `event-change-notice.ts` already applies to a cancellation |

Only on `confirmed`. A declined proposal changed nothing, so there is nothing to announce to a
bill that never saw it — the proposer's own notice carries the no.

*The decision it hides:* whether a crew member hears about a date move at all. They do:
`event-change-requests.ts` already says they *"are still TOLD … their call time depends on the
night"* while having no vote on it, and this is the surface where that was false.

### Proven on the running stack

Three mutations, each red (drop the call site, stop excluding the proposer, announce a declined
change too). Then the real scenario — the operator proposes 29 Oct on the Album Release, and the
co-host, performer B and the agent each confirm:

```
performer.b@   event.change_requested   A change to Marlo Vance — Album Release
co.host@       event.change_requested   …
agent@         event.change_requested   …
operator@      event.change_confirmed   The date moved — Marlo Vance — Album Release
co.host@       event.updated            "…" was updated · The date changed. · by Astra Booking
performer.a@   event.updated            …
performer.b@   event.updated            …
professional@  event.updated            ←  the crew member, whose call time just moved
```

**Five people now know, each with the right message.** Before: one, the operator's own.

---

## Found on the way — a test that went red at midnight with no code change

`integrations.test.ts` → *"falls back to a full re-listing when the cursor has aged out"* was
green all evening and red this morning. Nothing in the tree moved.

The sync window is `now − 30 days … now + 400 days` (`SYNC_WINDOW_PAST_DAYS`,
`lib/calendar-sync.ts`), and the fixture's third event is dated **2026-08-28** — exactly 30 days
behind 2026-09-27 and 31 behind 2026-09-28. It fell out of the window at midnight, so the full
re-listing had two items to reconcile instead of three and `deleted` came back `1`.

`realWorldEvents()` stays absolute, because it carries the DST assertion that only means
anything on fixed dates (August at `+02:00`, November at `+01:00`, same wall clock). The window
test gets its own relative fixture and now asserts all three landed before reconciling — so it
tests the window rather than the calendar.

Worth noting for the same reason the mutation lessons are: **this test had been one day from
failing for weeks, and nothing could have told us.** A fixture pinned to an absolute date
inside a window measured from `now` is a scheduled failure.

---

## Suites

biome **730** clean · api **1368** (no flake this run) · shared **293** · web **383** ·
e2e **112** · `tsc --noEmit` clean in api, web, shared and design-system.
