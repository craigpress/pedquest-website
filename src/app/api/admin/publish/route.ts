import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * Trigger a production rebuild so database edits reach the site.
 *
 * Members live in Supabase but render from a generated static module (six of
 * the ten consumers are client components), so publishing = redeploy. The
 * `prebuild` step regenerates src/data/members.generated.ts from the table.
 *
 * Needs VERCEL_DEPLOY_HOOK_URL — create it in the Vercel project under
 * Settings -> Git -> Deploy Hooks, pointed at the production branch.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) {
    return NextResponse.json(
      {
        error:
          "Publishing isn't configured. Add VERCEL_DEPLOY_HOOK_URL (Vercel → Settings → Git → Deploy Hooks) to the project environment.",
      },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(hook, { method: "POST" });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      console.error("[AdminPublish] deploy hook rejected:", res.status, detail);
      return NextResponse.json({ error: `Deploy hook failed (${res.status}).` }, { status: 502 });
    }
    console.log(`[AdminPublish] ${auth.email} triggered a production rebuild`);
    return NextResponse.json({
      success: true,
      message: "Rebuild started. Changes are usually live in a couple of minutes.",
    });
  } catch (e) {
    console.error("[AdminPublish] deploy hook error:", e);
    return NextResponse.json({ error: "Could not reach the deploy hook." }, { status: 502 });
  }
}
