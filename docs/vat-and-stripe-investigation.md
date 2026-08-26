# shoWMe — VAT and Stripe Tax

**Status: investigation, not a build.** Nothing here has been implemented. The purpose is to answer a question
that `docs/money.md:42` and `docs/payments.md` both defer — "what do we do about VAT?" — by finding out precisely
what Stripe Tax does and does not do, and then deciding which half of the question is actually ours.

The finding, up front: **there are two different VAT questions wearing one word, and only one of them is ours.**
VAT on *our subscription revenue* is unambiguously shoWMe's to compute, collect and remit, and Stripe Billing plus
Stripe Tax handles almost all of it. VAT on *an event settlement between an operator and a performer* is a
transaction between two independent businesses that shoWMe is not a party to, and computing it would mean asserting
a tax treatment on someone else's supply. We should not do that. We should carry VAT there as a **declared
attribute of a document**, never as a term of the reconciliation.

Everything below distinguishes what was **verified** in Stripe's documentation (with the page) from what is
**inference** or a question that needs a professional. Stripe's own tax pages repeatedly say "consult a tax
advisor"; so does this document.

---

## 1. The spine: two VATs, one word

| | Our SaaS subscription | An event settlement |
|---|---|---|
| **Who supplies** | Showme AB | the performer (or crew, or agent) |
| **Who buys** | the operator / performer / agent | the operator |
| **Is shoWMe a party?** | **yes — we are the seller** | **no — we are neither buyer nor seller** |
| **Whose VAT number goes on the invoice** | ours | theirs |
| **Whose tax return** | ours | theirs |
| **Who must get it right** | **us** | **them** |
| **What Stripe gives us** | Stripe Billing + Stripe Tax, near-turnkey | nothing that fits, because no money moves through Stripe |

That asymmetry is not a gap to be closed. It is the same boundary `docs/story.md` draws everywhere else: shoWMe is
the place where parties meet and agree, and the **record-keeper** of who owes whom. `docs/payments.md` already
states it twice — "**each party owns their own invoicing/VAT**", and Merchant-of-Record is rejected precisely
because it "contradicts the model where each party owns their own invoicing/VAT". The schema agrees: decisions #5
gives **every profile its own gapless invoice sequence and its own billing identity**, which is only coherent if
the parties are the issuers and shoWMe is not.

**Neither app has ever computed VAT.** `docs/old-app-analysis-data-model.md` establishes this by execution: the old
app stored `VatInfo {rate, mode}` on five line types (deal fee, additional revenue, custom costs, deductions,
settlement adjustments), wrote it from `VatSelector.tsx`, and then **never read it in `calculateSettlement`** —
`included` and `on_top` produced identical output. So this is new work in either direction, and we get to choose
the direction rather than inherit one.

---

## 2. What Stripe Tax actually does (and where it stops)

Stripe frames tax compliance as four steps and is explicit about which ones it owns
([How Stripe Tax works](https://docs.stripe.com/tax/how-tax-works)): *understand where you owe tax · register there ·
calculate and collect · file and remit.*

- **Calculate — yes, and this is the core of the product.** Verified: Stripe calculates using your business
  location, the customer's location, where the activity is performed, your registrations, the product tax code, and
  the customer's status (business vs private person) ([Calculate tax](https://docs.stripe.com/tax/calculating)).
- **Collect — yes, but only in the sense of adding the right amount to a charge Stripe processes.** The money lands
  in your Stripe balance like any other revenue; it is not segregated.
- **Register — partly, and it is not automatic.** Verified: "You must register with the tax authority in a location
  to collect taxes there." Stripe can *start* a registration for you — for US remote-seller registrations via
  Stripe, everywhere else via **Taxually** ([How Stripe Tax works](https://docs.stripe.com/tax/how-tax-works),
  [Use Stripe to register](https://docs.stripe.com/tax/use-stripe-to-register/non-union-oss)). Registration remains
  a legal act by our company, with a start date and back-filing consequences if we are late.
- **File and remit — no, not by itself.** Verified: "You must file and remit the tax you collect for every location
  where you're registered" ([File and remit](https://docs.stripe.com/tax/filing)). Automated filing exists but is a
  **separate, paid add-on**: TaxJar for US filings, and **Taxually / Marosa / Hands-off Sales Tax** for everywhere
  else, with pricing that "varies by partner and filing location". Stripe Tax by itself never files a Swedish VAT
  return.
- **"Stripe Tax reporting" is exports, not filing.** Verified: three report kinds — *itemized* (one row per line
  item per jurisdiction), *summarized* (one row per jurisdiction), and *location reports* (**US and Canada only**,
  view-only in the Dashboard, not downloadable, not in the API)
  ([Tax reporting](https://docs.stripe.com/tax/reports),
  [Choose a report](https://docs.stripe.com/tax/reports/choosing-a-report)). Stripe's own caveat on location
  reports: they "don't account for business-specific adjustments like credits, prepayments, use tax owed on
  purchases, or transactions that happened outside of Stripe. Treat the report as a starting point."

**The single most important operational fact:** verified —
"**Stripe only calculates tax in jurisdictions where you have an active tax registration. Without a registration in
the customer's location, the calculation returns zero tax**" ([Calculate tax](https://docs.stripe.com/tax/calculating)).
Stripe does not error on this; it silently returns zero. A misconfigured integration looks exactly like a
correctly-configured one that owes nothing.

### The marketplace fork

Verified: before anything else, "**determine which entity has the obligation to collect and report taxes**"
([Use Stripe Tax with Connect](https://docs.stripe.com/tax/connect)). Stripe splits the world in two:

- **[Tax for software platforms](https://docs.stripe.com/tax/tax-for-platforms)** — the *connected accounts* are
  liable. The platform's job is plumbing: drive each connected account's Tax Settings API and Tax Registrations
  API, or embed the `tax_settings` / `tax_registrations` Connect components, then verify the account's tax settings
  `status` is `active` before enabling `automatic_tax` on their payments.
- **[Tax for marketplaces](https://docs.stripe.com/tax/tax-for-marketplaces)** — the *platform* is liable (a
  "marketplace facilitator" in the US, a "**deemed seller**" in the EU). Tax is then calculated from the
  **platform's** head office, preset tax code and registrations, and Stripe explicitly notes it does **not** use
  connected-account information at all. The platform withholds the collected tax from payouts.

Stripe adds the sentence that matters most here, verified: "Stripe Connect's distinction between SaaS platforms and
marketplaces **doesn't strictly correspond to the tax definition** of marketplaces that are responsible for tax
collection. Consult with a tax advisor."

---

## 3. Does Stripe settle the rounding question in `money.md:42`? No.

`docs/money.md` defers "**invoice VAT rounding** (per-line vs total) follows the jurisdiction's rules". Stripe has a
documented answer, and it is worth knowing exactly what it is — but it is a *product behaviour*, not a legal ruling.

Verified ([Tax rates — Rounding](https://docs.stripe.com/tax/tax-rates)), Stripe supports both modes:

- **Line-item level** — round each line's tax to the smallest currency unit, then sum. Their example: 90.91 + 4.55
  = **95.46**.
- **Invoice level** — sum the taxable amounts unrounded per tax rate, apply the rate to the subtotal, round once.
  Same inputs: **95.45**.

A one-minor-unit difference on a €1,050 invoice, from the same numbers. That is the whole reason the question exists.

**The configurability is the catch.** Verified, quoting the page: the setting lives on the Dashboard invoice
settings page and "**The rounding configuration is only available for invoices with manual tax rates. Invoices with
automatic Stripe tax always sum up the tax amounts first and then round.**"

So:

- If we use **Stripe Tax (`automatic_tax`)** for our own subscriptions, rounding is decided for us — **invoice
  level, per tax rate group, not configurable.** Fine; it is Stripe's invoice and Stripe's calculation.
- If we ever render **our own** invoice documents for settlement parties, Stripe has told us nothing binding. The
  fact that Stripe ships **both** modes, configurable, is itself evidence that the correct answer is
  jurisdiction-dependent — which is what `money.md:42` already suspected.

**Inference, not a documented fact:** matching Stripe's automatic behaviour (invoice-level, per rate group) for any
document we generate ourselves is the cheapest defensible default, because it keeps a shoWMe-issued document and a
Stripe-issued document arithmetically consistent. **This is not a ruling on Swedish or German invoicing law and an
accountant has to confirm it.** `money.md:42` stays open; Stripe does not close it.

One related mechanic worth recording, verified
([Refunds and credit notes](https://docs.stripe.com/tax/invoicing/refunds)): Stripe splits a refund between net and
tax in proportion to the original rate. And a warning we should heed if we ever use the Tax API directly — verified
([Tax reporting](https://docs.stripe.com/tax/reports)): partial line-item tax refunds make reporting unreliable;
Stripe recommends fully reversing and re-creating instead.

---

## 4. We take no escrow. Does that make Stripe Tax inapplicable?

Two different answers for the two halves.

**For event settlements: effectively yes, and that is the right outcome.** The owner's position is recorded in
`docs/meeting-2026-08-settlements-and-deals.md` ("**No escrow (01:31:39, 01:33:18)**") and encoded in
`docs/payments.md`: v1 "processes **no money**", the settlement shows who-owes-whom plus bank details, and a human
marks a transfer paid. Stripe Tax is transaction-shaped — it hangs off a Checkout Session, an Invoice, a
Subscription, a PaymentIntent, or a `Tax.Calculation` you create deliberately. If no Stripe object exists, nothing
is calculated.

There *is* a technical escape hatch, and it is worth naming so nobody rediscovers it and thinks it is the answer.
Verified: the **standalone Tax API** can "calculate and report tax on payments you process outside of Stripe …
with any third-party payment processor or your in-house payment and invoicing systems"
([Collect tax on off-Stripe payments](https://docs.stripe.com/tax/off-stripe),
[Standalone Tax API](https://docs.stripe.com/tax/standalone-tax-api)). So we *could* call `Tax.Calculation` on a
venue-to-performer bank transfer.

**We should not, and the reason is documented rather than aesthetic.** Combine two verified facts: (a) Stripe only
calculates where **you** hold an active registration, returning zero otherwise; (b) tax registrations and
performance locations are **per Stripe account and cannot be shared across connected accounts** (the Tax-for-tickets
guide lists the exact error: "The performance location ID doesn't belong to a performance location accessible by
the Stripe account. You must create separate performance locations for each connected account and the platform
account"). Our Stripe account carries **Showme AB's** registrations. Pushing a Swedish band's fee to a German venue
through our account would either return zero tax (we are not registered as them) or a number computed from *our*
tax position — a number that is wrong in a way that looks right. **That is inference from those two documented
facts, and it is the strongest practical argument against building it.**

**For our own subscription billing: no, it is fully applicable and unaffected.** Stripe Billing is entirely separate
from Connect, as `docs/payments.md` already says ("SaaS plans → Stripe Billing, entirely separate from Connect"). We
charge, we are the seller, Stripe Tax works exactly as documented. The no-escrow decision has no bearing on it.

---

## 5. VAT on our SaaS subscription — definitely ours

This is the half we must actually build, eventually, and it is small.

**What Stripe gives us**, verified: set `automatic_tax.enabled=true` on the Subscription (or Checkout Session, or
Invoice) ([Set up Stripe Tax](https://docs.stripe.com/tax/set-up),
[Collect taxes for recurring payments](https://docs.stripe.com/tax/subscriptions)); Stripe then handles pricing
models, prorations, discounts and trials. Enabling it does **not** retro-fit existing subscriptions — each must be
updated.

**Product tax code.** Verified ([Tax for digital products](https://docs.stripe.com/tax/digital-products)):
`txcd_10103001` is *Software as a Service (SaaS) — Business Use*, `txcd_10103000` the personal-use variant. Stripe's
own instruction to agents on that page is worth quoting because it applies to us: "Treat `txcd_` identifiers as
opaque, exact strings. Never construct, guess, or infer a code… **Don't make the legal tax classification for the
user.**" Our audience is businesses, so the business-use code is the obvious candidate — **confirm with the
accountant, do not assume.**

**Tax behaviour is a one-way door.** Verified
([Product tax codes and tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior)):
`tax_behavior` is `inclusive` or `exclusive` and **cannot be changed after it is set** — changing it means creating a
new Price and archiving the old one. Stripe's recommended default, `Automatic`, resolves to exclusive for USD/CAD
and **inclusive for every other currency**, which for SEK/EUR pricing means the advertised price would *include*
VAT. For B2B SaaS that is usually the wrong presentation (business buyers expect ex-VAT), so this is a **deliberate
decision to take once, before the first Price exists.**

**Reverse charge for EU B2B customers.** Verified
([Tax in the European Union](https://docs.stripe.com/tax/supported-countries/european-union)): if a customer in
another EU country supplies their VAT number, Stripe treats the sale as reverse charge and calculates no tax — and
"Your business must provide an invoice that specifies the reverse charge instead of including a tax amount."
Two documented limits matter to us: Stripe supports reverse charge **only for cross-border** sales, **not domestic
reverse charge**; and Stripe "assumes that all services sold to customers with a business tax ID are eligible for
reverse charge", ignoring country-specific conditions.

**VAT ID validation.** Verified ([Customer Tax IDs](https://docs.stripe.com/billing/customer/tax-ids)): EU VAT
numbers are validated against **VIES**, GB VAT against **HMRC**, ABN against **ABR** — asynchronously, notified by
the `customer.tax_id.updated` webhook. Two caveats, both verified and both consequential:
"After a tax ID is confirmed as valid or invalid, **it won't be validated again automatically**", and — the sharper
one, from [Account and customer tax IDs](https://docs.stripe.com/tax/invoicing/tax-ids) — "Stripe Tax applies the
reverse charge or zero rate … **as long as the tax ID conforms to the necessary number format, regardless of its
validity**." A well-formed but bogus VAT number will therefore zero-rate a sale. If someone abuses that, the
liability is ours, so the validation verdict is something we should store and act on, not merely display.
(The standalone Tax API is weaker still: verified, it "doesn't automatically validate tax IDs against government
databases".)

**Sweden specifically.** Verified
([Collect tax in Sweden](https://docs.stripe.com/tax/supported-countries/european-union/collect-tax?tax-jurisdiction-european-union=sweden)):
tax type VAT, all product tax codes supported, and the **registration threshold is 1 transaction**. Cross-border
B2C sales elsewhere in the EU have the documented **10,000 EUR "small seller" option**, below which our home
country's VAT applies and above which we must register per-country or via **Union OSS**
([Tax in the EU](https://docs.stripe.com/tax/supported-countries/european-union)).

**Cost.** Verified ([How Stripe Tax works — Pricing](https://docs.stripe.com/tax/how-tax-works)): a fee per
calculation on live transactions in jurisdictions where we are registered, charged **at invoice finalization** —
"based on invoice finalization, not whether, when, or how payment is collected." Zero-amount transactions are free.
`docs/payments.md` already anticipated exactly this shape: "enable Stripe Tax à la carte for subscription VAT only."
That line is correct and this investigation confirms it.

---

## 6. VAT on an event settlement — argued, not assumed, as not ours

An operator books a performer. The performer supplies a service; the operator buys it. If VAT applies, the
**performer** charges it, on the **performer's** invoice, under the **performer's** registration, and declares it on
the **performer's** return. shoWMe is a third party watching and keeping the ledger straight.

**Is that self-serving? Test it against Stripe's own definition of when a platform *does* become liable.** Verified,
the EU deemed-seller test ([Tax in the EU](https://docs.stripe.com/tax/supported-countries/european-union)): a
business qualifies if it "set[s] terms or conditions for the sale, process[es] or enable[s] customer payments, or
handle[s] ordering or delivery of the product" — and, crucially, "**A business isn't considered a deemed seller if
it only processes payments, lists or advertises goods, or redirects customers to other websites or apps without
further involvement in the sale.**" Stripe further notes the obligation "usually applies to" sales of **digital
services** and specific **goods** cases.

Held against v1 shoWMe: we do not set the terms (the parties negotiate them; we record the agreed deal), we do not
process the payment (no escrow, no Stripe object, bank-to-bank), and we do not handle ordering or delivery (the show
happens in a room we have nothing to do with). A live performance is neither a digital service nor goods. Even the
narrower carve-out is instructive — a business that *merely processes payments* is still not a deemed seller, and we
do not even do that. **Inference from the verified test, not legal advice:** shoWMe is not a deemed seller for the
event supply, and computing that VAT would be volunteering for a liability nobody has assigned us.

**The place-of-supply rules are also genuinely hard, which is a second reason not to guess on a user's behalf.**
Verified, from the same page, the sourcing rules diverge sharply by category: "Services related to **admission to
events** and other venues: Taxable in the country where the venue or the event is located", while "Other services…
Taxable in the customer's country when provided to other businesses." A performer's fee charged to a promoter is not
obviously either one, and several EU countries apply a **domestic reverse charge** to exactly this kind of
arrangement — which Stripe explicitly **does not support**. Deciding this for a Swedish band playing Berlin is an
accountant's job, per act, per country. Baking one answer into `reconcile()` would be shoWMe silently making that
call for thousands of users who each have a different correct answer.

**One adjacent Stripe capability worth knowing exists, for the day ticketing appears.** Verified
([Tax location-based sales](https://docs.stripe.com/tax/location-sales),
[Tax ticket sales based on event location](https://docs.stripe.com/tax/tax-for-tickets/integration-guide)): Stripe
supports **performance locations** — a saved venue address attached to line items — and 14 event/admission tax
codes, e.g. `txcd_50010001` *Admission to Amusement, Entertainment and Recreation Venues*, for which a performance
location is **required**. Sweden is a supported country for location-based sales. This is in **public preview** and
needs API version `2026-03-25.preview` or later. It is the right tool for *selling tickets*, which shoWMe does not
do; it is not a tool for reconciling a fee between two businesses.

**And one obligation that is NOT VAT and could still land on us.** Verified
([Platform tax reporting for Connect platforms](https://docs.stripe.com/connect/platform-tax-reporting)): under the
OECD **MRDP** — implemented as **DAC7** in the EU, plus SERR and ITA Part XX — "certain Connect platforms are
required to report income information regarding their connected accounts to tax authorities", covering "economic
activities facilitated by digital platforms", with copies delivered to each seller. Stripe supports all EU countries
except PL, and attaches an explicit limitation of liability. **This is income reporting, not VAT, and it attaches to
*facilitation*, not to *holding money*** — so "we take no escrow" is not automatically a defence. It is a lawyer
question and it belongs on the open list, not in the VAT answer.

**What the old app's dead `VatInfo` was actually asking for.** Someone typed those rates into five line types and
nothing consumed them. The most likely explanation — and this is inference, flagged as an open question in
`docs/old-app-analysis-data-model.md` item 8 — is that users wanted the **number to appear**: a VAT breakdown on the
settlement and on the resulting invoice, so the document is right and a net-of-VAT view exists. That is a display
and document feature. It is not a tax engine, and building the engine would answer a question nobody asked.

---

## 7. What would have to exist in the schema

### Already there (and further along than expected)

- **`profiles.billing` jsonb** (`packages/db/src/schema/identity.ts:74`) — commented as `legal_name, address,
  vat_id, vat_rate, invoice_number_seq`. Written through `PATCH /profiles/:id/billing`
  (`apps/api/src/routes/payout.ts:185`, body at `:46–48`: `vatId`, `vatRegistered`, `vatRate`), read back only for
  owner/admin (`apps/api/src/serialize/profile.ts:135`, `:243`). The **billing identity of a party already exists.**
- **`contacts.vat_id`** (`packages/db/src/schema/invitations.ts:52`) — the counterparty's VAT number in the address
  book, for off-platform parties.
- **`invoices.vat` jsonb** (`packages/db/src/schema/sharing.ts:105`) — the slot exists. It is currently typed
  `z.unknown()` on the way in and out (`apps/api/src/routes/invoices.ts:36,47,66`), so an invoice can be **issued
  and frozen into `document_snapshot` with an unvalidated VAT blob.** This is the single most fixable gap in the
  current schema.
- **`plans`** (`packages/db/src/schema/monetization.ts`) — `profile_id` PK, `tier`, `status`, `source`, `seats`,
  `renewal_at`. The `plan_source` enum already has `stripe` (`packages/db/src/schema/enums.ts:186`).

### Missing, and material

- **There is no Stripe linkage at all.** A repo-wide grep for "stripe" across `packages/db/src/schema/` and
  `apps/api/src/` returns **three hits, all comments or the enum value**. `plans.source = 'stripe'` currently points
  at nothing: no customer id, no subscription id, no period end, no webhook handler. Any subscription VAT work
  starts here, not at tax.
- **`profiles` has no `country`.** Country lives on `users.country` (`identity.ts:47`) and
  `profile_locations.country` (`identity.ts:110`); `events` has none either — an event's country is two joins away
  via `venue_profile_id`. `docs/decisions.md` #17 makes `country` the stamp that "drives **VAT**, PRO codes,
  currency". For the profile that *issues an invoice*, that stamp is currently nullable and indirect.
- **No VAT columns on `budget_lines` or `deals`** (`packages/db/src/schema/settlement.ts:68–95`) — as
  `old-app-analysis` puts it, we cannot even *store* what the old app stored.

### Concretely, for our own subscription (the half that is ours)

1. **`plans.stripe_customer_id`**, **`plans.stripe_subscription_id`**, **`plans.current_period_end`** — or a small
   `billing_customers(profile_id, stripe_customer_id, …)` table if a Stripe customer should outlive a plan row.
   Webhook-driven; `plans` stays the source of truth for entitlements, Stripe is upstream of it.
2. **An authoritative billing country on the paying profile** — promote `profiles.country`, or make the derivation
   from `profile_locations` explicit and non-null at the point of subscribing. Stripe Tax needs the customer address;
   we need to store what we sent, because it determines the rate.
3. **VAT ID round-trip and verdict.** `profiles.billing.vat_id` must be pushed to Stripe as `customer.tax_ids`, and
   the VIES verdict stored back — `vat_id_status` + `vat_id_checked_at` — because Stripe validates **once and never
   again**, and applies reverse charge on *format* alone.
4. **`profiles.billing.vat_registered` should become a real, typed field.** It is accepted by the route today but
   lives in an untyped jsonb. If VAT ever appears on a document, an unregistered sole trader must **not** show it.
5. **Nothing else.** Do not store rates or compute tax for our own sales: the Stripe invoice is the document of
   record. Keep the Stripe invoice id/URL against the plan so support can find it.

### Concretely, for the settlement side (only if we decide to *display* VAT)

6. **`budget_lines.vat_rate integer` (basis points, per `money.md`) + `budget_lines.vat_mode text`**, both nullable —
   the old app's `{rate, mode}` shape with the two states it lacked and the EU needs:
   `inclusive | exclusive | reverse_charge | exempt`. The same pair on `deals` (or on the deal's fee term).
7. **Structure `invoices.vat`.** Replace `z.unknown()` with a validated shape: per rate group
   `{ rate_bp, mode, taxable_base_minor, tax_minor }` plus a `note` for the legally required reverse-charge wording
   that Stripe's EU page says the invoice must carry. Amounts as strings at the JSON boundary, per `money.md`.
8. **A country on the invoice issuer and on the event** (or a documented, non-null derivation). #17 already needs it
   for PRO codes and currency; VAT makes it load-bearing rather than nice-to-have.
9. **Explicitly NOT: VAT inside `packages/settlement`.** The conservation law (`Σ net = 0`) runs on gross amounts.
   VAT is an attribute of a *document issued by one party*, not a term of the reconciliation. Letting it into
   `reconcile()` would make shoWMe assert a tax treatment for a supply it is not party to — and would put a number
   we cannot defend inside the one calculation the whole product is trusted for.

---

## What we recommend

1. **Write the split down as a decision.** Amend `docs/money.md` §VAT and `docs/payments.md` to state plainly:
   *shoWMe computes VAT on its own subscription revenue and never computes VAT for an event settlement; on a
   settlement, VAT is a declared attribute of the issuing party's document.* Right now `money.md:42` reads as though
   a VAT engine is pending. It is not; that is the finding.
2. **Ship subscription VAT on Stripe Billing + `automatic_tax`, when subscriptions ship.** One product with a
   deliberately chosen business-use SaaS tax code, `tax_behavior` decided once (it is immutable), customer address
   and VAT ID pushed to Stripe, Swedish registration added first — the threshold is one transaction. Stripe then
   calculates and collects; **we still register, and we still file** unless we separately buy Taxually or Marosa.
   Schema work is items 1–4 above, and the real prerequisite is that `plan_source='stripe'` currently points at
   nothing.
3. **On settlements, carry VAT as declared, never computed.** Add `{rate, mode}` to `budget_lines` and `deals`, show
   a VAT breakdown on the settlement, structure `invoices.vat`, and print reverse-charge wording when the
   counterparty carries a validated cross-border VAT ID. Label it in the UI as the **issuer's declaration**. This
   answers what the old app's users were reaching for, at a fraction of the cost and none of the liability.
4. **Fix `invoices.vat: z.unknown()` before the invoice document is used in anger** — ahead of everything else on
   this list. An issued invoice freezes into `document_snapshot`; freezing an unvalidated tax blob is the kind of
   bug that is discovered by an auditor.
5. **Defer the rest with payments, and set a tripwire.** If Flow 2/3 or Pay-All or ticketing ever ships, re-run the
   deemed-seller test against Stripe's criteria — "sets terms · processes or enables payments · handles ordering or
   delivery." That is the moment the answer to "is this ours?" can legitimately change, and the moment
   `docs/payments.md` step 4 arrives.
6. **Get an accountant's sign-off before the first VAT number appears on any shoWMe-generated document.** Not before
   we design it — before we render it.

---

## Still needs a human / accountant decision

- **Is Showme AB VAT-registered in Sweden, and do we exceed the 10,000 EUR EU B2C small-seller threshold?** Decides
  whether we register in one country or use **Union OSS** — and Stripe's registration date rules mean this cannot be
  fixed retroactively without voluntary disclosure.
- **`tax_behavior`: inclusive or exclusive for SEK/EUR SaaS prices?** Stripe's `Automatic` default gives *inclusive*
  outside USD/CAD, which is probably wrong for B2B. **Immutable once set.**
- **Which SaaS product tax code.** Business-use vs personal-use is a legal classification. Stripe's docs instruct us
  in as many words not to make it on the user's behalf; the same applies to making it on our own without advice.
- **The place-of-supply rule for a performer's fee to a foreign promoter** — general B2B rule, or the artistic /
  entertainment special rule? — and whether any of our markets apply a **domestic reverse charge**, which Stripe
  explicitly does not support. This is the question that decides whether "VAT is the issuer's declaration" is
  merely conservative or actually the only defensible position.
- **Invoice VAT rounding for documents we generate ourselves** (`money.md:42`). Stripe ships both line-level and
  invoice-level for manual rates and forces invoice-level for automatic tax. It has told us what is *possible*, not
  what is *required* in Sweden or Germany.
- **Does shoWMe qualify as a deemed seller / marketplace facilitator once money moves?** Stripe's own instruction:
  "consult with a tax advisor."
- **DAC7 / MRDP seller-income reporting.** Separate from VAT, attaches to *facilitation* rather than to holding
  funds, and therefore is **not** answered by "we take no escrow". Lawyer question.
- **The open question from `old-app-analysis-data-model.md` item 8** — was VAT ever expected to affect payouts, or
  only to be displayed? This document argues *displayed*. Confirming that with the owner closes the item and turns
  it from a settlement change into a document feature.

---

## Related

- `docs/money.md` — §VAT (line 42) is the deferral this investigates; minor units, `allocate()`, `Money`.
- `docs/payments.md` — the deferred payment layer; already says parties own their own VAT and rejects MoR.
- `docs/decisions.md` #5 (invoices, payout identity, gapless numbering), #17 (country drives VAT / PRO / currency).
- `docs/story.md` — the actor boundaries that make "not ours to compute" a product decision rather than a shortcut.
- `docs/old-app-analysis-data-model.md` — the proof that `VatInfo` was stored and never computed, in either app.
