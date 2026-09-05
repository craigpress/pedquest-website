import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

const state: { job: any; case: any; calls: string[] } = { job: null, case: null, calls: [] };

mock.module("@/lib/admin-auth", {
  namedExports: {
    requireRole: async (request: NextRequest) => request.headers.get("authorization")
      ? { ok: true, email: "editor@example.com", userId: "u1", role: "editor" }
      : { ok: false, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) },
  },
});
mock.module("@/lib/supabase", {
  namedExports: {
    createServerClient: () => ({
      from(table: string) {
        state.calls.push(table);
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: table === "eeg_case_render_jobs" ? state.job : state.case, error: null }),
        };
        return builder;
      },
    }),
  },
});

let GET: typeof import("../src/app/api/admin/qbank/render/route").GET;
test.before(async () => {
  ({ GET } = await import("../src/app/api/admin/qbank/render/route"));
});

function request(auth = true) {
  return new NextRequest("http://localhost/api/admin/qbank/render?jobId=j1", {
    headers: auth ? { authorization: "Bearer test" } : {},
  });
}

test("unauthorized polling is denied", async () => {
  const response = await GET(request(false));
  assert.equal(response.status, 401);
});

test("current completed job is reported without a write", async () => {
  state.calls.length = 0;
  state.job = { id: "j1", case_id: "c1", status: "done", image_url: "/new.png", sidecar: { width: 1 }, spec: { seed: 2 } };
  state.case = { image_url: "/new.png", spec: { seed: 2 } };
  const response = await GET(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "done");
  assert.deepEqual(state.calls, ["eeg_case_render_jobs", "eeg_cases"]);
});

test("stale completed job is superseded and cannot mutate the newer image", async () => {
  state.calls.length = 0;
  state.job = { id: "j1", case_id: "c1", status: "done", image_url: "/old.png", sidecar: { width: 1 }, spec: { seed: 1 } };
  state.case = { image_url: "/new.png", spec: { seed: 2 } };
  const response = await GET(request());
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.status, "superseded");
  assert.equal(state.case.image_url, "/new.png");
  assert.deepEqual(state.calls, ["eeg_case_render_jobs", "eeg_cases"]);
});
