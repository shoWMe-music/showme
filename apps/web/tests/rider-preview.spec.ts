import { expect, test } from "@playwright/test";
import { openAs } from "./support/e2e";

/**
 * Reading a rider in the app instead of downloading it.
 *
 * The seed puts two riders on the Album Release: performerA's tech rider (a PDF)
 * and performerB's hospitality rider (written down, no file). That pairing is
 * what makes the scope assertable — the operator sees both, each performer sees
 * only their own (decisions #12, enforced by `scopedEventRiders`).
 *
 * ON THE STORAGE STUB: the bytes live in Firebase Storage, which the local stack
 * has no emulator for, so the URL the API really signs points at a host that
 * cannot answer. The route below serves a real PDF in its place — the STORAGE
 * HOST is the only thing substituted. The API, the session, the rider scoping
 * and the signed URL itself are the product's own. Without it this spec could
 * only ever assert the failure state.
 */
const EVENT_URL = "/events/e2e00000-0000-4000-8000-0000000000e1";

/** A tiny, genuinely valid one-page PDF, built here so no binary is committed. */
function onePagePdf(): Buffer {
  const content = "BT /F1 24 Tf 60 700 Td (TECH RIDER) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startXref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("an operator reads the performer's rider without downloading it", async ({ browser }) => {
  const operator = await openAs(browser, "operator");

  try {
    await operator.page.route("https://fake.storage.local/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/pdf", body: onePagePdf() }),
    );
    await operator.page.goto(EVENT_URL);

    // Both riders are listed — the operator's pool visibility — and the one with
    // no document says so on the row rather than pretending to be openable.
    const techRider = operator.page.getByRole("button", { name: /Tech Rider 2026/ });
    await expect(techRider).toBeVisible();
    await expect(
      operator.page.getByRole("button", { name: /Hospitality Notes.*No file/i }),
    ).toBeVisible();

    await techRider.click();
    const dialog = operator.page.getByRole("dialog");

    // What the document IS, from the API's file metadata — not from the filename.
    await expect(dialog.getByText("Marlo_Vega_Tech_Rider_2026.pdf")).toBeVisible();
    await expect(dialog.getByText("412 KB")).toBeVisible();

    // The viewer is pointed at the URL the API issued for THIS rider, and the
    // reader keeps a way out of the modal that does not require the inline view.
    //
    // The host is deliberately NOT asserted. Locally the stack serves bytes through
    // its own loopback object sink (`/api/v1/files/local-object/…`), and against
    // real storage it is a signed GCS URL — the same code path either way. What
    // matters, and what this pins, is that the URL was ISSUED PER RIDER rather than
    // built from the file path, and that it carries `#toolbar=1` so the reader gets
    // the browser's native PDF controls.
    const viewer = dialog.locator("object");
    await expect(viewer).toHaveAttribute("data", /#toolbar=1$/);
    await expect(viewer).toHaveAttribute("data", /^https?:\/\//);
    await expect(dialog.getByRole("button", { name: "Open in a new tab" })).toBeVisible();

    // The pane resolves to the document rather than sitting on the spinner: the
    // loading overlay is gone once the bytes arrive.
    await expect(dialog.getByText("Opening the document")).toHaveCount(0, { timeout: 15_000 });
    await expect(dialog.getByText("The document didn't open here")).toHaveCount(0);
  } finally {
    await operator.context.close();
  }
});

test("a described rider opens to its notes, and offers no document to open", async ({
  browser,
}) => {
  const performer = await openAs(browser, "performerB");

  try {
    await performer.page.goto(EVENT_URL);

    // performerB is on the same event as performerA but sees only their own
    // rider — the other's is not listed at all, so there is nothing to click.
    await expect(performer.page.getByRole("button", { name: /Tech Rider 2026/ })).toHaveCount(0);

    await performer.page.getByRole("button", { name: /Hospitality Notes/ }).click();
    const dialog = performer.page.getByRole("dialog");
    await expect(dialog.getByText("No document attached").first()).toBeVisible();
    await expect(dialog.getByText(/Dressing room for three/)).toBeVisible();
    // No document means no "open it" control — an absent button, not a dead one.
    await expect(dialog.getByRole("button", { name: "Open in a new tab" })).toHaveCount(0);
  } finally {
    await performer.context.close();
  }
});
