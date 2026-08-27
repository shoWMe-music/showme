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

  it("forbids a viewer from managing payout accounts", async () => {
    const issuer = await seedProfile("pay-viewer", "viewer");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/profiles/${issuer.profileId}/payout-accounts`,
      headers: auth("pay-viewer"),
      payload: { type: "swish", identifier: "123" },
    });
    expect(response.statusCode).toBe(403);
  });
});
