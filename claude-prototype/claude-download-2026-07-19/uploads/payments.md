# shoWMe — Payments architecture

**Status: DEFERRED.** This is the *target* design, not v1. v1 processes **no money** — the settlement is the
source of truth, it shows who-owes-whom + each payee's bank details, parties pay each other directly, and a
user marks a transfer/invoice **paid** by hand ("tracked, not held"). Everything below is what we build *later*,
in phases, on top of that foundation. Captured now so the model stays payment-ready and the schema doesn't need
rework.

Provider: **Stripe Connect** (DECIDED 2026-07 — account: Showme AB, `acct_1Tt7nVGijBqSSnyj`). **Mollie was
evaluated and dropped** (see *Provider*).

---

## The three payment flows (by how much the platform touches the money)

Most shoWMe situations are the *light* end. The charge pattern varies by flow; the **Express connected-account
foundation is shared** across flows 2 and 3 (onboard once, reuse everywhere).

### Flow 1 — Direct bank flow (no Stripe at all)
- **Where:** settlement screen shows "Venue owes Performer €3,000" + the performer's IBAN (payout identity).
- Venue pays from its own bank; performer hits **mark paid**.
- **Stripe:** none. shoWMe is the record-keeper. **This is v1 and likely the majority of cases.**

### Flow 2 — Invoice / get-paid-with-a-receipt (the Fiverr case)
- **Where:** performer hits "Invoice / Get paid" on their settlement slice → shoWMe generates an invoice + pay
  link (prefilled from settlement) → venue pays (card / iDEAL / SEPA) → performer receives money **and a
  receipt/statement they handle themselves** (own VAT/taxes).
- **Stripe:** Express connected account (performer) + a **direct charge** + optional platform fee. Performer is
  merchant of record. (At simplest: Stripe Invoicing / Payment Links.)
- **One payer → one payee. NOT pool-splitting.**

### Flow 3 — Platform pools & splits, with optional hold (the marketplace)
- **Where:** shoWMe collects a lump (ticket revenue, or a payer's total) → optionally holds → splits to multiple
  parties per the settlement.
- **Stripe:** **separate charges and transfers** (+ optional hold on the platform balance).
- This is the heaviest setup — right only for pooled/ticketing/festival cases **and** for the Pay-All feature.

---

## Feature: "Pay All" (one payment → everyone paid)

The operator/venue selects settlements, clicks **Pay All**, makes **one payment**, and every party is paid
automatically.

**Mechanics (Flow 3 / separate charges and transfers):**
1. shoWMe sums the selected settlements into one total.
2. Venue makes **one payment** of the total → lands on shoWMe's Stripe **platform balance**.
3. shoWMe fires **N `transfers.create`** — one to each payee's connected account, per settlement line.
4. Each payee's balance pays out to their bank. Optional `application_fee` for shoWMe.

- **Only payees onboard** (Express accounts, to receive). The **venue is just a payer — no account, no KYC.**
- **Use SEPA/bank debit, not card**, for large B2B lumps (card fees on €thousands are punitive).
- `settlement_transfers` map **1:1** to Stripe transfers; each transfer's webhook flips `owed → paid`.

---

## Multi-pay without being an escrow

- **Escrow = *holding* money** (release later on a condition). **Multi-pay routing ≠ escrow** if you distribute
  **immediately**.
- The Pay-All lump pools on the Stripe balance for **seconds**, then fans out — **pass-through, not escrow.** And
  **Stripe is the licensed holder** (funds sit in Stripe's regulated environment, not a bank account shoWMe
  controls), so shoWMe is **not** a money transmitter. This is the standard Connect marketplace pattern.

```
immediate pass-through   →   short hold (until finalize,   →   long / indefinite hold
(fan out on payment)         e.g. days)                        (weeks+, discretionary)
NOT escrow                   still Stripe-held, low concern     escrow / e-money licensing zone
```
- **Ship immediate distribution** → no escrow question at all.
- **Holding until finalize** is the deliberate, later "escrow" step — still Stripe-held, but check Sweden/EU
  e-money rules before shipping any *holding* behavior. (Mechanics here, not legal advice.)

---

## Invoicing & who needs a Stripe account

| Case | Payer (venue) | Payee (performer) |
|---|---|---|
| Invoice as a **document** (bank transfer) | no account | **no account** — shoWMe generates the doc; it *is* the receipt |
| Invoice **paid online** (through Stripe) | **never** — just a checkout page | onboards **once** (Express) to receive |

- **"Connected account" ≠ "sign up for Stripe."** The payee adds payout details **once inside shoWMe**
  (bank + ID); shoWMe creates an **Express connected account** via hosted onboarding; Stripe verifies in the
  background. No Stripe dashboard to manage. This *is* the profile's payout identity.
- **KYC is unavoidable to *receive* money** anywhere — but it's one hosted step, reused across all events.
- If a party never wants to onboard → they use the **document invoice + bank transfer**. Nothing breaks.
- **Rule:** paying online = no account, ever · receiving online = one-time hosted onboarding in shoWMe.

---

## Stripe Connect setup (the recommendation)

Validated against Stripe's own `connect-recommend` skill. Describe by field values, not legacy account-type codes:

- **Charge pattern:** **Separate charges and transfers** (only pattern that supports hold-then-release **and**
  N-way splits; destination charges cannot hold funds).
- **Dashboard:** **Express** — Stripe-hosted onboarding + KYC, light dashboard per party.
- **Fees (`fees_collector`): platform** — platform pays Stripe's processing fees, takes the platform fee via
  `application_fee_amount`.
- **Negative-balance liability (`losses_collector`): platform** — required with separate charges (disputes reverse
  against the platform balance).
- **Onboarding UI:** embedded components — `account_onboarding`, `notification_banner`, `account_management`
  (+ `payouts`, `payments`, `balance_report`).
- **Combination is valid** (Express + separate + platform-owned fees/losses — not blocked).

⚠️ **Margin:** with separate charges the platform pays Stripe's fees, so
`application_fee_amount = platform fee + estimated Stripe fee`, or margin goes negative. Verify EU rates at
stripe.com/pricing; monitor Stripe margin reports.

**Not Managed Payments / Merchant-of-Record.** The 3.5% add-on is prohibitive for B2B settlement, and MoR
contradicts the model where **each party owns their own invoicing/VAT**. For shoWMe's own SaaS subscriptions →
**Stripe Billing** (separate from Connect; enable Stripe Tax à la carte for subscription VAT only).

---

## Accounting for a pooled ("Pay All") payment

- The single payment is **one cash movement, not one expense.** The venue owes several suppliers; each is a
  separate expense backed by **that party's own invoice** with **that party's VAT**.
- shoWMe must supply an **itemized invoice breakdown (one per payee) + a reconciliation** ("this €X payment
  covered invoices #1/#2/#3"). The venue books **supplier** expenses (the performers), **not** "€X to shoWMe."
- shoWMe only invoices its **platform fee** (its own revenue), separately.
- ⚠️ With separate charges the venue's bank statement shows one line to **shoWMe** (the charging entity) — so the
  breakdown docs + a clear statement descriptor are a **shoWMe responsibility** to keep the venue's books correct.

---

## Agent commission (representation) — Flow 2, never escrow

Design in `docs/decisions.md` #14. An agent's commission is a **separate, private representation settlement** — a
second ordinary `settlements` row (scoped to a `representation`, not the event), **not** a line on the event
settlement. Its money movement is deliberately the **light** end — it never routes the operator's gross through the
platform.

- **Event settlement stays Flow 1** (recorded-not-moved): the operator pays the **collector** their full gross —
  **performer** (default) **or** the **agent** when the agent collects on the performer's behalf. Commission never
  appears here.
- **Representation settlement = the commission leg**, direction from who collected:
  - **performer collected** → an owed debt **performer → agent** (the commission).
  - **agent collected** → an owed debt **agent → performer** (`gross − commission`).
- **Closed by** manual mark-paid, or **opt-in auto-pay = a Flow 2 direct charge** (one payer → one payee, immediate,
  not pooled) — reuses Flow 2 wholesale, adds no new payment flow.
- **Collectable only after** the event settlement's transfer to the collector is `paid` (the "waiting to be paid"
  gate) — a read of the source settlement, not a stored state.
- **Rejected: splitting the operator's payment at source.** Fanning the gross into performer + agent legs would
  route the **whole settlement** through the platform (Flow 3 / Pay-All) — heavier, only works when the operator
  pays via Stripe, and pulls the platform into money it otherwise never touches. The owed-debt + Flow 2 model
  achieves the same agent payment **decoupled from how the operator settles**.
- **Currency** = the performance deal's payout currency (no FX of its own).

---

## Provider: Stripe Connect (DECIDED — Mollie dropped)

**Stripe Connect** chosen (2026-07) for its stronger marketplace: smooth Express onboarding, flexible N-way splits,
**hold-then-release** controls, mature API/webhooks — the better fit for the Pay-All / split / escrow vision. Cost
stacks (per-active-account fee + payout fees), accepted. **Mollie was evaluated** (cheaper iDEAL/SEPA, simpler, no
per-account fee) **and dropped** — not worth maintaining two providers; Stripe's marketplace depth wins.
- Still keep the provider behind shoWMe's own transfer/invoice abstraction (v1 is provider-agnostic).
- **Swedish note:** for any *consumer/ticket* money, Swedes expect **Swish** — verify Stripe's Swish support. B2B
  settlement (venue→performer) is SEPA/bank, where Swish matters less.

---

## Mapping to the shoWMe data model

- **`profiles` payout identity** → the party's **Express connected account** (bank + KYC). Onboard once, reuse.
- **`settlement_transfers`** → Flow 1: no Stripe object (just a tracked state) · Flow 2: one direct charge to the
  payee · Flow 3: N transfers. State `owed → paid → handled` flips on the Stripe **webhook**.
- **Invoice** (document over a transfer) → the pay link + receipt hang off it; per-party invoices + reconciliation
  are the venue's accounting pack.
- **Parties own their VAT/invoicing** → matches Express (each account gets its own receipts, owns its tax); Stripe
  is not merchant of record for the parties' money — they are.
- **SaaS plans** → Stripe Billing, entirely separate from Connect.

---

## Build sequence (all deferred; additive on the v1 foundation)

1. **v1 (now):** settlement shows bank details + VAT; manual mark-paid. Payout identity fields on the profile.
2. **Invoicing (light):** generate invoice documents from settlement data (no payments).
3. **Flow 2 (Fiverr):** Express onboarding + direct charges → "performer invoices venue, gets paid, gets receipt."
4. **Flow 3 + Pay-All:** separate charges and transfers → one payment fans out to N payees (immediate = no escrow).
5. **Hold-then-release (escrow):** delay the transfers until settlement finalize — the deliberate, regulated step;
   confirm EU e-money rules first.

Each step reuses the same Express accounts and the same `settlement_transfers` / invoice model — no re-onboarding,
no schema rework.
