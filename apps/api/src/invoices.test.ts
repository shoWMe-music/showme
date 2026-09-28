import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { nextInvoiceNumber } from "./lib/invoice-number";
import { invoiceRoutes } from "./routes/invoices";
import { payoutRoutes } from "./routes/payout";
import { buildTestApp } from "./testing";

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    invoiceRoutes,
    payoutRoutes,
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });
const thisYear = new Date().getFullYear();

/** Seed a user + profile + membership with the given profile role. */
async function seedProfile(id: string, role: "owner" | "viewer" = "owner") {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role, status: "active" });
  return { userId: id, profileId: profile.id };
}

async function createDraft(uid: string, profileId: string, direction = "issued") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: auth(uid),
    payload: { ownerProfileId: profileId, direction, currency: "SEK", total: "300000" },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

const issue = (uid: string, invoiceId: string) =>
  app.inject({ method: "POST", url: `/api/v1/invoices/${invoiceId}/issue`, headers: auth(uid) });

describe("invoices — gapless numbering (decisions #5)", () => {
  it("numbers only on issue, sequentially, and a VOID never renumbers history", async () => {
    const issuer = await seedProfile("inv-op");

    // Draft has no number.
    const draft = await createDraft("inv-op", issuer.profileId);
    expect(draft.number).toBeNull();
    expect(draft.state).toBe("draft");

    // Issue #1 → year-prefixed 0001, frozen snapshot, sent.
    const first = await issue("inv-op", draft.id);
    expect(first.statusCode).toBe(200);
    expect(first.json().number).toBe(`${thisYear}-0001`);
    expect(first.json().state).toBe("sent");
    expect(first.json().issuedAt).not.toBeNull();
    expect(first.json().documentSnapshot.number).toBe(`${thisYear}-0001`);

    // Issue #2 → 0002.
    const second = await createDraft("inv-op", issuer.profileId);
    const secondIssued = await issue("inv-op", second.id);
    expect(secondIssued.json().number).toBe(`${thisYear}-0002`);

    // Void #2 — the number is RETAINED, the sequence untouched.
    const voided = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${second.id}`,
      headers: auth("inv-op"),
      payload: { state: "void" },
    });
    expect(voided.json().state).toBe("void");
    expect(voided.json().number).toBe(`${thisYear}-0002`); // NOT cleared

    // Issue #3 → 0003, NOT reusing the voided 0002. Gapless, no renumber.
    const third = await createDraft("inv-op", issuer.profileId);
    const thirdIssued = await issue("inv-op", third.id);
    expect(thirdIssued.json().number).toBe(`${thisYear}-0003`);
  });

  it("the year-prefixed sequence resets per year (gapless within each)", async () => {
    const issuer = await seedProfile("inv-year");
    const numbers = await harness.db.transaction(async (tx) => [
      await nextInvoiceNumber(tx, issuer.profileId, 2026),
      await nextInvoiceNumber(tx, issuer.profileId, 2026),
      await nextInvoiceNumber(tx, issuer.profileId, 2027),
    ]);
    expect(numbers).toEqual(["2026-0001", "2026-0002", "2027-0001"]);
  });

  it("a received bill keeps its external number (not the gapless sequence)", async () => {
    const issuer = await seedProfile("inv-recv");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: auth("inv-recv"),
      payload: {
        ownerProfileId: issuer.profileId,
        direction: "received",
        number: "SUPPLIER-99",
        currency: "SEK",
      },
    });
    const issued = await issue("inv-recv", created.json().id);
    expect(issued.json().number).toBe("SUPPLIER-99"); // external, untouched
  });

  it("freezes the document on issue — content edits are then rejected", async () => {
    const issuer = await seedProfile("inv-frozen");
    const draft = await createDraft("inv-frozen", issuer.profileId);
    await issue("inv-frozen", draft.id);
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${draft.id}`,
      headers: auth("inv-frozen"),
      payload: { total: "999999" },
    });
    expect(edit.statusCode).toBe(400);
  });

  it("404s an invoice for a stranger to the owner profile", async () => {
    const issuer = await seedProfile("inv-owner");
    await seedProfile("inv-stranger");
    const draft = await createDraft("inv-owner", issuer.profileId);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${draft.id}`,
      headers: auth("inv-stranger"),
    });
    expect(response.statusCode).toBe(404);
  });

  it("setting billing identity preserves the gapless counter", async () => {
    const issuer = await seedProfile("inv-billing");
    const first = await issue(
      "inv-billing",
      (await createDraft("inv-billing", issuer.profileId)).id,
    );
    expect(first.json().number).toBe(`${thisYear}-0001`);

    // Editing legal/VAT identity must not wipe invoiceNumberByYear.
    const billing = await app.inject({
      method: "PATCH",
      url: `/api/v1/profiles/${issuer.profileId}/billing`,
      headers: auth("inv-billing"),
      payload: { legalName: "Acme AB", vatId: "SE556677889901", vatRate: 25 },
    });
    expect(billing.statusCode).toBe(200);

    const second = await issue(
      "inv-billing",
      (await createDraft("inv-billing", issuer.profileId)).id,
    );
    expect(second.json().number).toBe(`${thisYear}-0002`); // counter survived
  });
});

describe("payout accounts (decisions #5)", () => {
  it("adds a typed (bankgiro) payout account and lists it", async () => {
    const issuer = await seedProfile("pay-op");
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-op"),
      payload: {
        type: "bankgiro",
        identifier: "5051-6905",
        currency: "SEK",
        holderName: "Acme AB",
        isPrimary: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().type).toBe("bankgiro");
    expect(created.json().identifier).toBe("5051-6905");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-op"),
    });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].holderName).toBe("Acme AB");
  });

  /**
   * A PAYOUT ACCOUNT THAT IDENTIFIES NOTHING IS NOT AN ACCOUNT (QA sweep run 8, QA8-10).
   *
   * `identifier` was optional, so an IBAN account sent with the number under the key `iban`
   * was accepted as 201 and stored with `identifier: null` — Zod stripped the unknown key
   * and the response said "created". Every ingredient of a silent data loss: an optional
   * field, a plausible wrong key, and a success. This is the one table whose entire purpose
   * is to say where money goes.
   */
  it("refuses an account with no number for the money to go to", async () => {
    const issuer = await seedProfile("pay-blank");

    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-blank"),
      // The sweep's exact shape: the number is there, under a key nothing reads.
      payload: {
        type: "iban",
        label: "QA8 bank",
        currency: "SEK",
        iban: "SE4550000000058398257466",
      },
    });
    expect(missing.statusCode).toBe(400);

    // Blank and whitespace are the same absence, and `.trim()` is what makes them so.
    const blank = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-blank"),
      payload: { type: "iban", identifier: "   " },
    });
    expect(blank.statusCode).toBe(400);

    // And nothing was stored by either attempt.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-blank"),
    });
    expect(list.json()).toHaveLength(0);
  });

  it("forbids a viewer from managing payout accounts", async () => {
    const issuer = await seedProfile("pay-viewer", "viewer");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-viewer"),
      /*
       * A body that would otherwise SUCCEED. Fastify validates before `preHandler`, so a
       * malformed payload here answers 400 and the 403 this test exists to prove never
       * happens — the assertion would pass while measuring the wrong refusal. The payload
       * used to be `identifier: "123"`, which was only valid while nothing checked a swish
       * number's shape (QA9-17).
       */
      payload: { type: "swish", identifier: "0701234567" },
    });
    expect(response.statusCode).toBe(403);
  });

  /**
   * AN IDENTIFIER THAT MATCHES ITS OWN METHOD, AND A CURRENCY THAT EXISTS (QA sweep run 9, QA9-17).
   *
   * QA8-10 closed "no number at all"; this closes "a number that is not one". The sweep found
   * `{"type":"iban","identifier":"not-an-iban","currency":"XYZ"}` stored as 201 — an IBAN payout
   * account holding prose, denominated in a currency that does not exist. `payout_accounts` has
   * no caller in either front end yet, which is the argument FOR closing it now: the first caller
   * will be written against whatever this accepts.
   *
   * The shape checks are deliberately loose (no mod-97, no Luhn) — see the route. So these tests
   * assert that PROSE is refused and that a real number in each of the three methods is taken,
   * rather than pinning a strictness the route does not claim.
   */
  it("refuses an identifier that is not the method's kind of number, and an invented currency", async () => {
    const issuer = await seedProfile("pay-shape");
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
        headers: auth("pay-shape"),
        payload,
      });

    // The sweep's exact body.
    expect(
      (await post({ type: "iban", identifier: "not-an-iban", currency: "XYZ" })).statusCode,
    ).toBe(400);
    // Each half on its own, so neither test passes because of the other's defect.
    expect((await post({ type: "iban", identifier: "not-an-iban" })).statusCode).toBe(400);
    expect(
      (await post({ type: "iban", identifier: "SE4550000000058398257466", currency: "XYZ" }))
        .statusCode,
    ).toBe(400);
    // A bankgiro number is not an IBAN and a phone number is not a bankgiro.
    expect((await post({ type: "iban", identifier: "5051-6905" })).statusCode).toBe(400);
    expect((await post({ type: "bankgiro", identifier: "0701234567" })).statusCode).toBe(400);
    expect((await post({ type: "swish", identifier: "SE4550000000058398257466" })).statusCode).toBe(
      400,
    );

    expect(
      await app
        .inject({
          method: "GET",
          url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
          headers: auth("pay-shape"),
        })
        .then((response) => response.json()),
    ).toHaveLength(0);
  });

  it("takes a real number in each of the three methods, however it is spaced", async () => {
    const issuer = await seedProfile("pay-real");
    const post = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
        headers: auth("pay-real"),
        payload,
      });

    // An IBAN as a person writes it, in groups of four. Spacing is stripped, not rejected —
    // refusing a legitimate account is the worse failure of the two.
    expect(
      (await post({ type: "iban", identifier: "SE45 5000 0000 0583 9825 7466" })).statusCode,
    ).toBe(201);
    // The dash prints a bankgiro number; it does not constitute one.
    expect((await post({ type: "bankgiro", identifier: "50516905" })).statusCode).toBe(201);
    expect((await post({ type: "swish", identifier: "+46701234567" })).statusCode).toBe(201);
    // Every currency in the platform's own list, and no currency at all, both stand.
    expect(
      (await post({ type: "swish", identifier: "0701234567", currency: "NOK" })).statusCode,
    ).toBe(201);
  });

  /**
   * THE SAME RULE ON THE WAY IN AND ON THE WAY BACK (QA9-17).
   *
   * `PATCH` takes a `.partial()` of the same object, so the pair `(type, identifier)` is checked
   * only when both arrive together — an identifier sent alone cannot be checked without reading
   * the stored row. What must NOT happen is an account created correctly and then edited into
   * prose, which is exactly what sending the pair does.
   */
  it("refuses an edit that turns a real IBAN into prose", async () => {
    const issuer = await seedProfile("pay-edit");
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-edit"),
      payload: { type: "iban", identifier: "SE4550000000058398257466" },
    });
    expect(created.statusCode).toBe(201);
    const accountId = created.json().id;

    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        // The edit route is FLAT (`/payout-accounts/:pid`) while the create route is nested
        // under the profile — a nested PATCH answers 404, which reads exactly like "no such
        // account" rather than "no such route".
        url: `/api/v1/payout-accounts/${accountId}`,
        headers: auth("pay-edit"),
        payload,
      });

    const prose = await patch({ type: "iban", identifier: "not-an-iban" });
    expect(prose.statusCode).toBe(400);
    // The sentence a person reads, and it has to be English: naming the enum value directly
    // produced "That does not look like a iban number" in the one field that says where money goes.
    expect(prose.json().error.message).toContain("does not look like an IBAN");
    expect((await patch({ currency: "XYZ" })).statusCode).toBe(400);
    /*
     * THE HALF-EDIT, which is the case a schema cannot reach: the body carries no `type`, so the
     * method it must be judged against is the STORED one. A surviving mutation found this — the
     * schema's `type === undefined` guard could be deleted with every test still green, because
     * the request that guard exists for was never sent.
     */
    expect((await patch({ identifier: "not-an-iban" })).statusCode).toBe(400);
    // The same half-edit with a real number of the stored method lands.
    expect((await patch({ identifier: "SE35 5000 0000 0549 1000 3123" })).statusCode).toBe(200);
    // …and a half-edit that changes the METHOD is judged against the new one, not the old.
    expect((await patch({ type: "swish", identifier: "0701234567" })).statusCode).toBe(200);
    expect((await patch({ identifier: "SE3550000000054910003123" })).statusCode).toBe(400);
    expect((await patch({ type: "iban", identifier: "SE4550000000058398257466" })).statusCode).toBe(
      200,
    );
    // And a real edit still lands.
    expect((await patch({ holderName: "Acme AB", currency: "EUR" })).statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-edit"),
    });
    expect(list.json()[0].identifier).toBe("SE4550000000058398257466");
    expect(list.json()[0].holderName).toBe("Acme AB");
  });
});
