/**
 * Polls until Auth + Firestore emulators accept TCP connections, then exits.
 * Used before `npm run seed:workspace` so seeding runs after emulators are ready.
 */
import net from "node:net";

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

async function waitForPort(port, label, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portOpen(port)) {
      console.log(`[seed-wait] ${label} (127.0.0.1:${port}) is ready`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`[seed-wait] Timed out after ${timeoutMs}ms waiting for ${label} on port ${port}`);
}

await waitForPort(8090, "Firestore");
await waitForPort(9099, "Auth");
