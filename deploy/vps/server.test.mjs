import assert from "node:assert/strict";
import test from "node:test";
import { createSiteServer } from "./server.mjs";

test("GET /% responde 400 e o processo continua", async () => {
  const server = createSiteServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(base + "/%");
    assert.equal(bad.status, 400);
    const ping = await fetch(base + "/ping");
    assert.equal(ping.status, 200);
    assert.equal((await ping.json()).status, "ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
