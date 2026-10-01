import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import trials from "@/data/eeg-muscle-review.json";

const state = { calls: [] as string[], configured: true, signingError: false };

mock.module("@/lib/admin-auth", {
  namedExports: {
    requireRole: async (request: NextRequest, minimum: string) => {
      assert.equal(minimum, "editor");
      const role = request.headers.get("authorization");
      if (role === "Bearer editor") return { ok: true };
      return { ok: false, response: NextResponse.json({ error: "Denied." }, { status: role ? 403 : 401 }) };
    },
  },
});
mock.module("@/lib/supabase", {
  namedExports: {
    createServerClient: () => state.configured ? {
      storage: { from(bucket: string) {
        state.calls.push(bucket);
        return { createSignedUrl: async (path: string, ttl: number, options: { download: string }) => {
          state.calls.push(path);
          assert.equal(ttl, 900);
          assert.equal(options.download, trials[0].file);
          return state.signingError
            ? { data: null, error: { message: "Private internal storage detail" } }
            : { data: { signedUrl: "https://example.test/signed" }, error: null };
        } };
      } },
    } : null,
  },
});

let GET: typeof import("./route").GET;
test.before(async () => { ({ GET } = await import("./route")); });
test.beforeEach(() => { state.calls = []; state.configured = true; state.signingError = false; });

function request(recording = trials[0].id, role: string | null = "editor") {
  return new NextRequest(`https://pedquest.test/api/admin/lab/muscle-review?recording=${encodeURIComponent(recording)}`, {
    headers: role ? { authorization: `Bearer ${role}` } : {},
  });
}

test("anonymous callers cannot sign a recording", async () => {
  assert.equal((await GET(request(trials[0].id, null))).status, 401);
  assert.deepEqual(state.calls, []);
});
test("members cannot sign an editor experiment", async () => {
  assert.equal((await GET(request(trials[0].id, "member"))).status, 403);
  assert.deepEqual(state.calls, []);
});
test("missing recording is rejected without a storage call", async () => {
  assert.equal((await GET(request(""))).status, 404);
  assert.deepEqual(state.calls, []);
});
test("arbitrary storage paths cannot be signed", async () => {
  assert.equal((await GET(request("../../other.edf"))).status, 404);
  assert.deepEqual(state.calls, []);
});
test("editors receive only the selected immutable private recording URL", async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { url: "https://example.test/signed" });
  assert.deepEqual(state.calls, ["eeg-gallery", `experiments/muscle-20261001/${trials[0].sha256}.edf`]);
});
test("storage errors do not expose internal details", async () => {
  state.signingError = true;
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Could not open this recording." });
});
test("an unconfigured server cannot return a signed URL", async () => {
  state.configured = false;
  assert.equal((await GET(request())).status, 503);
  assert.deepEqual(state.calls, []);
});
