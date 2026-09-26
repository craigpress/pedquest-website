import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET as reviews } from "./route";
import { GET as corrections, POST as saveCorrection } from "../eeg-features/route";
test("QA reports and correction APIs require authentication before returning data", async () => {
  for (const handler of [reviews,corrections]) {
    const response = await handler(new NextRequest("http://localhost/api/admin/eeg-qa?source=lab"));
    assert.equal(response.status,401);
    assert.equal((await response.json()).error,"Authentication required.");
  }
  const response = await saveCorrection(new NextRequest("http://localhost/api/admin/eeg-features",{method:"POST",body:"{}"}));
  assert.equal(response.status,401);
});
