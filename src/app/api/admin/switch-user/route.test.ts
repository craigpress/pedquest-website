import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

type Row = { email: string; role: string; is_test: boolean; display_name: string | null };
const state = { rows: new Map<string, Row>(), minted: [] as string[] };

mock.module("@/lib/admin-auth", {
  namedExports: {
    requireRole: async (request: NextRequest, minimum: string) => {
      assert.equal(minimum, "editor");
      const role = (request.headers.get("authorization") ?? "").replace("Bearer ", "");
      if (role === "editor" || role === "admin") return { ok: true, role, email: `${role}@pedquest.test`, userId: role };
      return { ok: false, response: NextResponse.json({ error: "Denied." }, { status: role ? 403 : 401 }) };
    },
  },
});
mock.module("@/lib/roles-server", {
  namedExports: { findAuthUserIdByEmail: async (email: string) => `uid-${email}` },
});
mock.module("@/lib/supabase", {
  namedExports: {
    createServerClient: () => ({
      from: () => ({
        select: () => ({
          eq: (_col: string, email: string) => ({
            maybeSingle: async () => ({ data: state.rows.get(email) ?? null, error: null }),
          }),
        }),
      }),
      auth: { admin: { generateLink: async ({ email }: { email: string }) => {
        state.minted.push(email);
        return { data: { properties: { hashed_token: `hash-${email}` } }, error: null };
      } } },
    }),
  },
});

let POST: typeof import("./route").POST;
test.before(async () => { ({ POST } = await import("./route")); });
test.beforeEach(() => {
  state.minted = [];
  state.rows = new Map([
    ["student@pedquest.test", { email: "student@pedquest.test", role: "member", is_test: true, display_name: "Student" }],
    ["testadmin@pedquest.test", { email: "testadmin@pedquest.test", role: "admin", is_test: true, display_name: null }],
    ["real@pedquest.test", { email: "real@pedquest.test", role: "member", is_test: false, display_name: null }],
  ]);
});

function request(email: string, caller: string) {
  return new NextRequest("https://pedquest.test/api/admin/switch-user", {
    method: "POST",
    headers: { authorization: `Bearer ${caller}`, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

test("an editor can switch into a member test account", async () => {
  const res = await POST(request("student@pedquest.test", "editor"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).role, "member");
  assert.deepEqual(state.minted, ["student@pedquest.test"]);
});

test("a switch never raises the caller's role", async () => {
  assert.equal((await POST(request("testadmin@pedquest.test", "editor"))).status, 403);
  assert.deepEqual(state.minted, []);
  assert.equal((await POST(request("testadmin@pedquest.test", "admin"))).status, 200);
});

test("real accounts are refused for admins too", async () => {
  assert.equal((await POST(request("real@pedquest.test", "admin"))).status, 403);
  assert.deepEqual(state.minted, []);
});
